"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/dialog";
import { deleteChatAction, newChatAction } from "./actions";

export type HistoryItem = {
  id: string;
  title: string | null;
  updated_at: string;
  /** 'chat' for human-initiated, 'email' for inbound-event sessions, etc. */
  channel?: string | null;
  /** Partner/customer this conversation is about, when scoped. */
  accountName?: string | null;
};

export function HistoryRail({ sessions }: { sessions: HistoryItem[] }) {
  const pathname = usePathname();
  const activeId = pathname?.match(/^\/chat\/([0-9a-f-]{36})/i)?.[1];
  // Persist collapse state — sticks across navigation/refresh.
  // Default collapsed on small screens so chat content gets the full viewport.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = localStorage.getItem("chat-rail-collapsed");
    if (v === "1") {
      setCollapsed(true);
    } else if (v === null && window.matchMedia("(max-width: 767px)").matches) {
      setCollapsed(true);
    }
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("chat-rail-collapsed", collapsed ? "1" : "0");
    }
  }, [collapsed]);

  // In-app confirmation for delete — replaces the native window.confirm
  // that surfaces "localhost:3002 says".
  const [deleting, setDeleting] = useState<HistoryItem | null>(null);
  const [pendingDelete, startDelete] = useTransition();
  const [query, setQuery] = useState("");

  const filtered = sessions.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (s.title ?? "").toLowerCase().includes(q) ||
      (s.accountName ?? "").toLowerCase().includes(q)
    );
  });
  const groups = groupByRecency(filtered);

  function confirmDelete() {
    if (!deleting) return;
    const fd = new FormData();
    fd.set("session_id", deleting.id);
    startDelete(async () => {
      await deleteChatAction(fd);
    });
    // deleteChatAction redirects on success; the modal disappears with the
    // page navigation. If it doesn't, drop the dialog defensively.
    setDeleting(null);
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] transition-[width] duration-150",
        collapsed ? "w-[52px]" : "w-[260px]",
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 pt-3 pb-2", collapsed && "justify-center")}>
        {!collapsed && (
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
            Conversations
          </span>
        )}
        <button
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <form action={newChatAction} className="px-2">
        <button
          type="submit"
          className={cn(
            "flex w-full items-center gap-2 rounded-md bg-[var(--color-accent)] text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]",
            collapsed ? "h-9 justify-center" : "h-9 px-3 text-sm font-semibold",
          )}
        >
          <MessageSquarePlus size={14} />
          {!collapsed && <span>New chat</span>}
        </button>
      </form>

      {!collapsed && (
        <div className="relative mb-1 px-2">
          <Search
            size={13}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-1.5 pl-8 pr-2 text-[12px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      )}

      <nav className="mt-1 flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && !collapsed && (
          <p className="px-2 py-4 text-[12px] text-[var(--color-fg-muted)]">
            {query ? "No matches." : "No conversations yet. Start one above."}
          </p>
        )}
        {groups.map((g) =>
          g.items.length === 0 ? null : (
            <div key={g.label} className="mb-1.5">
              {!collapsed && (
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
                  {g.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {g.items.map((s) => {
                  const active = s.id === activeId;
                  const fallback =
                    s.channel === "email"
                      ? "Email thread"
                      : s.channel === "cron"
                        ? "Autonomous run"
                        : "Untitled chat";
                  return (
                    <li key={s.id} className="group relative">
                      <Link
                        href={`/chat/${s.id}`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-2 text-sm",
                          active
                            ? "bg-[var(--color-accent-light)] text-[var(--color-fg)]"
                            : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]",
                          collapsed && "justify-center",
                        )}
                        title={s.title ?? fallback}
                      >
                        <ChannelIcon channel={s.channel} active={active} />
                        {!collapsed && (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{s.title?.trim() || fallback}</span>
                            {s.accountName && (
                              <span className="block truncate text-[10px] text-[var(--color-fg-muted)]">
                                {s.accountName}
                              </span>
                            )}
                          </span>
                        )}
                        {!collapsed && (
                          <span className="shrink-0 self-start text-[10px] text-[var(--color-fg-muted)] group-hover:invisible">
                            {relative(s.updated_at)}
                          </span>
                        )}
                      </Link>

                      {!collapsed && (
                        <div className="absolute inset-y-0 right-1 flex items-center opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            aria-label="Delete conversation"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleting(s);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-surface-card)] text-[var(--color-fg-muted)] shadow-sm hover:bg-[var(--color-surface-2)] hover:text-[var(--color-error)]"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
      </nav>

      <Dialog
        open={!!deleting}
        onClose={() => {
          if (pendingDelete) return;
          setDeleting(null);
        }}
        title="Delete this conversation?"
        description={
          deleting
            ? `"${deleting.title?.trim() || (deleting.channel === "email" ? "Inbound email" : "Untitled chat")}" will be permanently removed, along with all its messages.`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleting(null)}
              disabled={pendingDelete}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={pendingDelete}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-error)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {pendingDelete ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Delete
            </button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--color-fg-secondary)]">
          This action can&apos;t be undone. George won&apos;t remember anything
          from this thread after it&apos;s deleted.
        </p>
      </Dialog>
    </aside>
  );
}

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function ChannelIcon({ channel, active }: { channel?: string | null; active: boolean }) {
  const tone = active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]";
  if (channel === "email")
    return <Mail size={13} className={cn("mt-0.5 shrink-0", tone)} aria-label="Email" />;
  if (channel === "cron")
    return <Clock size={13} className={cn("mt-0.5 shrink-0", tone)} aria-label="Autonomous" />;
  return (
    <MessageSquare size={13} className={cn("mt-0.5 shrink-0", tone)} aria-label="Chat" />
  );
}

// Bucket already-desc-sorted sessions into recency groups for the rail.
function groupByRecency(
  items: HistoryItem[],
): Array<{ label: string; items: HistoryItem[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const weekAgo = startOfToday - 6 * 86400000;

  const today: HistoryItem[] = [];
  const yesterday: HistoryItem[] = [];
  const week: HistoryItem[] = [];
  const earlier: HistoryItem[] = [];
  for (const s of items) {
    const t = new Date(s.updated_at).getTime();
    if (t >= startOfToday) today.push(s);
    else if (t >= startOfYesterday) yesterday.push(s);
    else if (t >= weekAgo) week.push(s);
    else earlier.push(s);
  }
  return [
    { label: "Today", items: today },
    { label: "Yesterday", items: yesterday },
    { label: "Previous 7 days", items: week },
    { label: "Earlier", items: earlier },
  ];
}
