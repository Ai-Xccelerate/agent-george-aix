"use client";

/**
 * Floating Agent George chat bubble.
 *
 * Mounted in the (app) layout so it's available across every authenticated
 * surface EXCEPT the dedicated `/chat` workspace (the main chat surface is
 * already the canonical experience there) and `/settings/*` (settings is
 * configuration, not conversation).
 *
 * Conversation persistence: the active session id is mirrored to
 * sessionStorage so the conversation survives page navigation AND tab
 * refresh. Only two header buttons can clear it — "New chat" wipes the
 * current thread and starts a fresh one (panel stays open); "End" wipes
 * the thread and closes the panel. Clicking outside / navigating does
 * NOT discard the conversation.
 *
 * Sizing: collapsed (launcher button), open (default 420×600, user-
 * resizable via the native bottom-right grip), maximised (90vw × 88vh).
 *
 * Page-context awareness: when the user is on `/customers/<id>`, the
 * bubble fetches that customer's display fields and surfaces a single
 * "Include @Name" chip across the top of the panel. Clicking it
 * dispatches the `george-bubble-insert` window event which the inner
 * `ChatClient` listens for to append the mention into its draft input.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AtSign,
  Maximize2,
  Minimize2,
  PenSquare,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatClient } from "../chat/_chat-client";
import {
  createBubbleSessionAction,
  getCustomerForContextAction,
} from "./actions";

const SESSION_STORAGE_KEY = "george-bubble-session-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageContext =
  | {
      kind: "customer";
      id: string;
      name: string;
      customerKind: "partner" | "end_customer";
      domain: string | null;
    }
  | null;

function shouldHideBubble(pathname: string | null): boolean {
  if (!pathname) return true;
  if (pathname.startsWith("/chat")) return true;
  if (pathname.startsWith("/settings")) return true;
  // /actions has an inline chat column per-item; surface conflict.
  if (pathname.startsWith("/actions")) return true;
  return false;
}

function deriveCustomerIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/customers\/([^/]+)\/?$/);
  if (!m) return null;
  const id = m[1];
  return UUID_RE.test(id) ? id : null;
}

export function FloatingChatBubble() {
  const pathname = usePathname();
  const hidden = shouldHideBubble(pathname);
  const customerIdInPath = deriveCustomerIdFromPath(pathname);

  const [open, setOpen] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [sessionId, setSessionIdRaw] = useState<string | null>(null);
  const [context, setContext] = useState<PageContext>(null);
  // Tracks whether the user has dismissed the context chip for the
  // current customer page so we don't keep re-suggesting it.
  const [contextDismissed, setContextDismissed] = useState<string | null>(
    null,
  );
  // A ref guards against concurrent action calls. We deliberately do
  // NOT use a "loading" state in the effect's dep array — flipping it
  // would re-fire the effect, cancel the in-flight closure via cleanup,
  // and silently discard the resolved sessionId.
  const sessionStartingRef = useRef(false);

  // Mirror sessionId writes to sessionStorage so the conversation
  // survives tab refresh (client-side nav preserves the bubble's state
  // automatically because the (app) layout doesn't unmount).
  function setSessionId(id: string | null) {
    setSessionIdRaw(id);
    if (typeof window === "undefined") return;
    try {
      if (id) window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
      else window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* sessionStorage can be unavailable (private mode); fall back to in-memory only */
    }
  }

  // Restore any persisted session id on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) setSessionIdRaw(saved);
    } catch {
      /* ignore */
    }
  }, []);

  // External deep-link: other surfaces (AI actions, inbox row) can ask the
  // bubble to load a specific session by dispatching:
  //   window.dispatchEvent(new CustomEvent("george:open-session", { detail: { sessionId } }))
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onOpenSession(e: Event) {
      const ce = e as CustomEvent<{ sessionId?: string }>;
      const id = ce.detail?.sessionId;
      if (!id) return;
      setSessionId(id);
      setOpen(true);
    }
    window.addEventListener("george:open-session", onOpenSession);
    return () => window.removeEventListener("george:open-session", onOpenSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the panel → if we don't already have a session, create one.
  // Lazy creation keeps users who never open the bubble from littering
  // the DB with empty session rows.
  useEffect(() => {
    if (!open || sessionId || sessionStartingRef.current) return;
    sessionStartingRef.current = true;
    (async () => {
      try {
        const res = await createBubbleSessionAction();
        if (res?.id) setSessionId(res.id);
      } finally {
        sessionStartingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  // "New chat" — discard current session, immediately create a fresh
  // one, keep the panel open.
  async function startNewConversation() {
    setSessionId(null);
    if (sessionStartingRef.current) return;
    sessionStartingRef.current = true;
    try {
      const res = await createBubbleSessionAction();
      if (res?.id) setSessionId(res.id);
    } finally {
      sessionStartingRef.current = false;
    }
  }

  // "End conversation" — discard the session and close the panel.
  // Next time the user opens the bubble they get a fresh empty state.
  function endConversation() {
    setSessionId(null);
    setOpen(false);
  }

  // Resolve the current page's customer context when relevant.
  useEffect(() => {
    if (!customerIdInPath) {
      setContext(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const row = await getCustomerForContextAction(customerIdInPath);
      if (cancelled) return;
      if (!row) {
        setContext(null);
        return;
      }
      setContext({
        kind: "customer",
        id: row.id,
        name: row.name,
        customerKind: row.kind,
        domain: row.domain,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [customerIdInPath]);

  function insertMention() {
    if (!context) return;
    window.dispatchEvent(
      new CustomEvent("george-bubble-insert", {
        detail: { text: `@${context.name}` },
      }),
    );
    setContextDismissed(context.id);
  }

  const showContextChip = useMemo(() => {
    if (!context) return false;
    if (contextDismissed === context.id) return false;
    return true;
  }, [context, contextDismissed]);

  if (hidden) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Agent George"
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-lg shadow-[var(--color-accent)]/30 transition hover:scale-105 hover:bg-[var(--color-accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface)]"
      >
        <Sparkles size={20} />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Agent George"
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl shadow-black/40",
        maximised
          ? "inset-x-[5vw] inset-y-[6vh]"
          : "bottom-6 right-6 resize",
      )}
      style={
        maximised
          ? undefined
          : {
              width: 420,
              height: 600,
              minWidth: 340,
              minHeight: 440,
              maxWidth: "95vw",
              maxHeight: "92vh",
            }
      }
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles size={14} className="shrink-0 text-[var(--color-accent)]" />
          <span className="truncate text-[13px] font-medium text-[var(--color-fg)]">
            Agent George
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={startNewConversation}
            aria-label="Start new conversation"
            title="Start new conversation"
            className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
          >
            <PenSquare size={14} />
          </button>
          <button
            type="button"
            onClick={() => setMaximised((m) => !m)}
            aria-label={maximised ? "Restore" : "Maximise"}
            title={maximised ? "Restore" : "Maximise"}
            className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
          >
            {maximised ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={endConversation}
            aria-label="End conversation"
            title="End conversation"
            className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {showContextChip && context && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-accent-light)]/30 px-3 py-2 text-[12px]">
          <span className="min-w-0 truncate text-[var(--color-fg-secondary)]">
            Viewing{" "}
            <span className="font-medium text-[var(--color-fg)]">
              {context.name}
            </span>
            {context.customerKind === "partner" ? " (partner)" : " (end customer)"}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={insertMention}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2 py-1 text-[11px] font-medium text-white hover:bg-[var(--color-accent-hover)]"
            >
              <AtSign size={10} />
              Include @{context.name.split(/\s+/)[0]}
            </button>
            <button
              type="button"
              onClick={() => setContextDismissed(context.id)}
              aria-label="Dismiss context"
              className="rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {sessionId ? (
          <ChatClient
            key={sessionId}
            sessionId={sessionId}
            initialMessages={[]}
            embedded
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] text-[var(--color-fg-muted)]">
            Starting conversation…
          </div>
        )}
      </div>
    </div>
  );
}
