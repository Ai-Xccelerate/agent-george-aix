"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Clock, Loader2, Mail, MessageSquare, Sparkles } from "lucide-react";
import { startAccountChatAction } from "../../chat/actions";

type Session = {
  id: string;
  title: string | null;
  channel: string | null;
  updated_at: string;
};

// Account conversations: lists every thread about this partner and starts new
// ones. There's one chat surface in the app — the floating bubble — so "Ask
// George about <partner>" creates an account-scoped session and opens the
// bubble with it (George is account-aware via the chat prompt's account block).
// Past threads open in the full chat view, which carries their history.
export function AccountConversations({
  customerId,
  customerName,
  sessions,
}: {
  customerId: string;
  customerName: string;
  sessions: Session[];
}) {
  const [starting, startTransition] = useTransition();

  function ask() {
    startTransition(async () => {
      const id = await startAccountChatAction(customerId);
      window.dispatchEvent(
        new CustomEvent("george:open-session", { detail: { sessionId: id } }),
      );
    });
  }

  return (
    <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-[var(--color-fg)]">
        <MessageSquare size={14} className="text-[var(--color-accent)]" />
        Conversations
      </h2>

      <button
        type="button"
        onClick={ask}
        disabled={starting}
        className="flex w-full items-center justify-center gap-2 rounded-md brand-gradient px-3 py-2.5 text-[13px] font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-70"
      >
        {starting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        Ask George about {customerName}
      </button>

      {sessions.length === 0 ? (
        <p className="mt-3 text-[12px] text-[var(--color-fg-muted)]">
          No conversations yet. Emails George exchanges and chats you start about
          this account collect here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/chat/${s.id}`}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-[var(--color-surface-2)]"
              >
                <ChannelIcon channel={s.channel} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-[var(--color-fg)]">
                    {s.title ?? "Untitled conversation"}
                  </div>
                  <div className="text-[11px] text-[var(--color-fg-muted)]">
                    {channelLabel(s.channel)} · {timeAgo(s.updated_at)}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChannelIcon({ channel }: { channel: string | null }) {
  const cls = "shrink-0 text-[var(--color-fg-muted)]";
  if (channel === "email") return <Mail size={14} className={cls} />;
  if (channel === "cron") return <Clock size={14} className={cls} />;
  return <MessageSquare size={14} className={cls} />;
}

function channelLabel(channel: string | null) {
  if (channel === "email") return "Email";
  if (channel === "cron") return "Autonomous";
  if (channel === "voice") return "Voice";
  return "Chat";
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) {
    const hrs = Math.floor(ms / 3600000);
    return hrs <= 0 ? "just now" : `${hrs}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
