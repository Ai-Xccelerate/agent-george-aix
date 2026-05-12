"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowUp,
  Check,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Sparkles,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageMarkdown } from "./_markdown";
import {
  clearAndStartNewChatAction,
  searchCustomersAction,
} from "./actions";
import {
  CommandPopover,
  detectTrigger,
  HELP_MESSAGE,
  SLASH_COMMANDS,
  type MentionItem,
  type PopoverItem,
  type SlashItem,
} from "./_commands";
import {
  getAttachmentDownloadUrl,
  uploadAttachmentAction,
} from "./upload-actions";

export type AttachmentMeta = {
  document_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size: number;
};

type ToolEvent = {
  id: string;
  name: string;
  input?: unknown;
  status: "running" | "ok" | "error";
};
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ToolEvent[];
  attachments?: AttachmentMeta[];
  /** True between the assistant placeholder being inserted and the SSE
   *  `done` event. Drives the "George is working…" indicator. */
  streaming?: boolean;
};

export type InitialMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: AttachmentMeta[];
};

export function ChatClient({
  sessionId,
  initialMessages,
}: {
  sessionId: string;
  initialMessages: InitialMessage[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [uploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Slash + @-mention popover state.
  const [trigger, setTrigger] = useState<
    | { kind: "slash"; query: string }
    | { kind: "mention"; query: string; start: number; end: number }
    | null
  >(null);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [popoverIndex, setPopoverIndex] = useState(0);

  const slashItems: SlashItem[] = (() => {
    if (trigger?.kind !== "slash") return [];
    const q = trigger.query.toLowerCase();
    return SLASH_COMMANDS.filter((c) =>
      q ? c.name.slice(1).toLowerCase().startsWith(q) : true,
    ).map((c) => ({ ...c, kind: "slash" as const }));
  })();

  const popoverItems: PopoverItem[] =
    trigger?.kind === "slash"
      ? slashItems
      : trigger?.kind === "mention"
        ? mentionItems
        : [];

  // Reset highlighted index whenever the popover items change so a fresh
  // popover always starts at the top of its list.
  useEffect(() => {
    setPopoverIndex(0);
  }, [trigger?.kind, trigger?.query, mentionItems.length]);

  // Fetch customer matches when the @-mention query changes.
  useEffect(() => {
    if (trigger?.kind !== "mention") {
      setMentionItems([]);
      return;
    }
    let cancelled = false;
    const q = trigger.query;
    (async () => {
      const rows = await searchCustomersAction(q, 8);
      if (cancelled) return;
      setMentionItems(
        rows.map((r) => ({
          kind: "mention" as const,
          id: r.id,
          name: r.name,
          customerKind: r.kind,
          domain: r.domain,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [trigger?.kind, trigger?.kind === "mention" ? trigger.query : null]);

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setInput(v);
    setTrigger(detectTrigger(v, e.target.selectionStart ?? v.length));
  }

  function onSelectionChange() {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    setTrigger(detectTrigger(el.value, el.selectionStart ?? el.value.length));
  }

  function dismissPopover() {
    setTrigger(null);
  }

  function handleSlashCommand(id: "clear" | "help") {
    setInput("");
    dismissPopover();
    if (id === "clear") {
      void clearAndStartNewChatAction(sessionId);
    } else if (id === "help") {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: HELP_MESSAGE,
        },
      ]);
    }
  }

  function applyMention(name: string, start: number, end: number) {
    const before = input.slice(0, start);
    const after = input.slice(end);
    const replaced = `${before}@${name}${after}`;
    setInput(replaced);
    dismissPopover();
    // Move the cursor right after the mention so typing continues naturally.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = (before + "@" + name).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onPopoverSelect(it: PopoverItem) {
    if (it.kind === "slash") {
      handleSlashCommand(it.id);
    } else if (trigger?.kind === "mention") {
      applyMention(it.name, trigger.start, trigger.end);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    // Handle bare slash commands (no popover selection) — typing "/clear"
    // and hitting Enter should fire the command, not send to George.
    if (text.startsWith("/")) {
      const cmd = SLASH_COMMANDS.find((c) => c.name === text);
      if (cmd) {
        handleSlashCommand(cmd.id);
        return;
      }
    }

    setInput("");
    dismissPopover();

    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const baseMessages = [...messages, userMsg];

    setMessages([
      ...baseMessages,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: baseMessages.map(({ role, content }) => ({ role, content })),
          sessionId,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const eventLine = raw.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim());

          if (event === "text") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + data.text } : m,
              ),
            );
          } else if (event === "tool_use") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      tools: [
                        ...(m.tools ?? []),
                        { id: data.id, name: data.name, input: data.input, status: "running" },
                      ],
                    }
                  : m,
              ),
            );
          } else if (event === "tool_result") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      tools: (m.tools ?? []).map((t) =>
                        t.id === data.id
                          ? { ...t, status: data.is_error ? "error" : "ok" }
                          : t,
                      ),
                    }
                  : m,
              ),
            );
          } else if (event === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m,
              ),
            );
            void data;
          } else if (event === "system") {
            // sessionId is fixed by the URL — nothing to update here.
            void data;
          } else if (event === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: `⚠ ${data.message || "Something went wrong."}` }
                  : m,
              ),
            );
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `⚠ ${(err as Error).message}` }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function onAttachClick() {
    if (uploading || streaming) return;
    setUploadError(null);
    fileInputRef.current?.click();
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-picked
    if (!file) return;

    const fd = new FormData();
    fd.set("session_id", sessionId);
    fd.set("file", file);

    startUpload(async () => {
      const res = await uploadAttachmentAction(fd);
      if (!res.ok) {
        setUploadError(res.error);
        return;
      }
      // Show the upload in the chat as a user message with the attachment
      // chip — same shape the server-rendered initial messages use.
      setMessages((prev) => [
        ...prev,
        {
          id: res.attachment.message_id,
          role: "user",
          content: `[Attached file: ${res.attachment.original_name}]`,
          attachments: [res.attachment],
        },
      ]);
    });
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-[760px]">
          {messages.length === 0 ? (
            <EmptyChat onPick={(p) => setInput(p)} />
          ) : (
            <div className="space-y-6">
              {messages.map((m) => (
                <Bubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  tools={m.tools}
                  attachments={m.attachments}
                  streaming={m.streaming}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-6 py-4">
        <div className="mx-auto max-w-[760px]">
          {uploadError && (
            <div className="mb-2 flex items-start justify-between gap-3 rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[12px] text-[var(--color-error)]">
              <span>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                aria-label="Dismiss"
                className="text-[var(--color-error)] hover:opacity-80"
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-card)] p-2 pl-3 shadow-sm focus-within:border-[var(--color-accent)]">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,text/markdown"
              onChange={onFilePicked}
            />
            <button
              type="button"
              onClick={onAttachClick}
              disabled={uploading || streaming}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-50",
              )}
              aria-label="Attach file"
              title="Attach file"
            >
              {uploading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Paperclip size={16} />
              )}
            </button>
            <div className="relative flex-1">
              {trigger && (
                <CommandPopover
                  items={popoverItems}
                  activeIndex={popoverIndex}
                  onSelect={onPopoverSelect}
                  onHover={setPopoverIndex}
                  emptyLabel={
                    trigger.kind === "mention"
                      ? trigger.query
                        ? `No matches for “${trigger.query}”`
                        : "Type a customer name…"
                      : "No matching commands"
                  }
                />
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={onInputChange}
                onSelect={onSelectionChange}
                onKeyDown={(e) => {
                  // Popover keyboard nav takes priority when the palette
                  // has items.
                  if (trigger && popoverItems.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setPopoverIndex(
                        (i) => (i + 1) % popoverItems.length,
                      );
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setPopoverIndex(
                        (i) =>
                          (i - 1 + popoverItems.length) %
                          popoverItems.length,
                      );
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onPopoverSelect(popoverItems[popoverIndex]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      dismissPopover();
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Drop a contract, type / for commands, or @ a customer…"
                className="block max-h-[180px] w-full resize-none bg-transparent py-2 text-sm leading-6 text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] outline-none"
              />
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
              aria-label="Voice"
            >
              <Mic size={16} />
            </button>
            {streaming ? (
              <button
                onClick={stop}
                className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-fg)] text-[var(--color-fg-inverse)] hover:bg-black"
                aria-label="Stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] transition",
                  input.trim()
                    ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                    : "bg-[var(--color-fg-muted)] opacity-60",
                )}
                aria-label="Send"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--color-fg-muted)]">
            George can act on customers, draft emails, and schedule meetings. He’ll
            confirm before anything externally visible.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  tools,
  attachments,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  tools?: ToolEvent[];
  attachments?: AttachmentMeta[];
  streaming?: boolean;
}) {
  const isUser = role === "user";
  // For attachment-only messages, hide the bracketed marker text — the chip
  // carries the info. Anything richer (user typed text alongside an
  // attachment) we keep showing.
  const hasAttachments = (attachments?.length ?? 0) > 0;
  const isAttachmentMarker =
    hasAttachments && /^\[Attached file:[\s\S]+\]$/.test(content.trim());
  const hasContent = !!content && !isAttachmentMarker;
  const showText = !isAttachmentMarker && (content || (!isUser && !streaming));
  // While streaming with no visible content yet, show a thinking pill that
  // names the in-flight tool (if any) instead of an empty bubble.
  const showThinking = !isUser && streaming && !hasContent;
  const runningTool = tools?.find((t) => t.status === "running") ?? null;

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-fg-inverse)] text-xs font-bold">
          G
        </div>
      )}
      <div className="flex max-w-[680px] flex-col gap-2">
        {tools && tools.length > 0 && (
          <div className="space-y-1">
            {tools.map((t) => (
              <ToolRow key={t.id} tool={t} />
            ))}
          </div>
        )}
        {hasAttachments && (
          <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
            {attachments!.map((a) => (
              <AttachmentChip key={a.document_id} attachment={a} />
            ))}
          </div>
        )}
        {showThinking && <ThinkingPill toolName={runningTool?.name} />}
        {showText && (
          <div
            className={cn(
              "rounded-[12px] px-4 py-3 text-sm leading-[1.6]",
              isUser
                ? "whitespace-pre-wrap bg-[var(--color-accent)] text-[var(--color-fg-inverse)]"
                : "bg-[var(--color-surface-card)] text-[var(--color-fg)] border border-[var(--color-border-subtle)]",
            )}
          >
            {isUser ? (
              content
            ) : hasContent ? (
              <MessageMarkdown content={content} />
            ) : (
              <span className="text-[var(--color-fg-muted)]">…</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingPill({ toolName }: { toolName?: string | null }) {
  const label = toolName
    ? `Running ${toolName.replace(/^mcp__george__/, "").replace(/_/g, " ")}…`
    : "George is working…";
  return (
    <div className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-1.5 text-[12px] text-[var(--color-fg-secondary)]">
      <Sparkles size={12} className="animate-pulse text-[var(--color-accent)]" />
      <span>{label}</span>
      <span className="flex items-center gap-0.5">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1 w-1 animate-pulse rounded-full bg-[var(--color-fg-muted)]"
      style={{ animationDelay: delay }}
    />
  );
}

function AttachmentChip({ attachment }: { attachment: AttachmentMeta }) {
  const [opening, setOpening] = useState(false);
  const Icon = attachment.mime_type.startsWith("image/") ? ImageIcon : FileText;

  async function open() {
    if (opening) return;
    setOpening(true);
    try {
      const res = await getAttachmentDownloadUrl(attachment.document_id);
      if (res.ok) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        alert(`Could not open file: ${res.error}`);
      }
    } finally {
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex max-w-[420px] items-center gap-2.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2 text-left text-[13px] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[var(--color-fg)]">
          {attachment.original_name}
        </span>
        <span className="block text-[11px] text-[var(--color-fg-muted)]">
          {prettyBytes(attachment.file_size)} · {attachment.mime_type}
        </span>
      </span>
      <span className="shrink-0 text-[var(--color-fg-muted)]">
        {opening ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      </span>
    </button>
  );
}

function ToolRow({ tool }: { tool: ToolEvent }) {
  const label = tool.name.replace(/^mcp__george__/, "").replace(/_/g, " ");
  const Icon =
    tool.status === "ok" ? Check : tool.status === "error" ? X : Wrench;
  const toneClass =
    tool.status === "ok"
      ? "text-[var(--color-success)]"
      : tool.status === "error"
        ? "text-[var(--color-error)]"
        : "text-[var(--color-fg-muted)]";
  return (
    <details className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2 text-[12px]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className={cn("flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-2)]", toneClass)}>
          <Icon size={12} className={tool.status === "running" ? "animate-pulse" : undefined} />
        </span>
        <span className="font-medium text-[var(--color-fg)]">{label}</span>
        <span className="text-[var(--color-fg-muted)]">
          {tool.status === "running" ? "running…" : tool.status === "ok" ? "done" : "failed"}
        </span>
      </summary>
      <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--color-surface-2)] p-2 text-[11px] text-[var(--color-fg-secondary)]">
        {JSON.stringify(tool.input ?? {}, null, 2)}
      </pre>
    </details>
  );
}

function EmptyChat({ onPick }: { onPick: (s: string) => void }) {
  const prompts = [
    "I just signed a new customer — here’s the contract.",
    "Give me the health snapshot across all active customers.",
    "Draft a kickoff meeting agenda for the new account.",
    "What did the Onyx onboarding meeting from yesterday cover?",
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient text-white shadow-[var(--shadow-cta)]">
        <Sparkles size={24} />
      </div>
      <h1 className="text-[22px] font-bold text-[var(--color-fg)]">
        How can I help, today?
      </h1>
      <p className="mt-1 max-w-[480px] text-sm text-[var(--color-fg-secondary)]">
        I’m George — your customer success teammate. Drop a contract, forward an
        email, or ask me anything about your customers.
      </p>
      <div className="mt-7 grid w-full max-w-[640px] grid-cols-2 gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 text-left text-[13px] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-light)]"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
