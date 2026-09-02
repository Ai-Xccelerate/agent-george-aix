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
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        <MessageSquare size={14} className="text-brand-500 dark:text-brand-400" />
        Conversations
      </h2>

      <button
        type="button"
        onClick={ask}
        disabled={starting}
        // Secondary. This was a filled brand gradient, which made asking a question
        // louder than the page's primary action (Onboard). Outlined keeps it
        // obviously clickable without competing.
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-white/[0.03] px-3 py-2.5 text-theme-sm font-medium text-gray-700 dark:text-gray-200 transition hover:border-brand-500/40 hover:text-brand-500 dark:hover:text-brand-400 disabled:opacity-60"
      >
        {starting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        Ask George about {customerName}
      </button>

      {sessions.length === 0 ? (
        <p className="mt-3 text-theme-xs text-gray-400 dark:text-gray-500">
          No conversations yet. Emails George exchanges and chats you start about
          this account collect here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/chat/${s.id}`}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              >
                <ChannelIcon channel={s.channel} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-theme-sm text-gray-800 dark:text-white/90">
                    {s.title ?? "Untitled conversation"}
                  </div>
                  <div className="text-theme-xs text-gray-400 dark:text-gray-500">
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
  const cls = "shrink-0 text-gray-400 dark:text-gray-500";
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
