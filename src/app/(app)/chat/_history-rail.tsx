"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  MessageSquarePlus,
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
};

export function HistoryRail({ sessions }: { sessions: HistoryItem[] }) {
  const pathname = usePathname();
  const activeId = pathname?.match(/^\/chat\/([0-9a-f-]{36})/i)?.[1];
  // Persist collapse state — sticks across navigation/refresh.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  useEffect(() => {
    const v = typeof window === "undefined" ? null : localStorage.getItem("chat-rail-collapsed");
    if (v === "1") setCollapsed(true);
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

      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 && !collapsed && (
          <p className="px-2 py-4 text-[12px] text-[var(--color-fg-muted)]">
            No conversations yet. Start one above.
          </p>
        )}
        <ul className="space-y-0.5">
          {sessions.map((s) => {
            const active = s.id === activeId;
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
                  title={s.title ?? "Untitled chat"}
                >
                  {s.channel === "email" ? (
                    <Mail
                      size={12}
                      className={cn(
                        "shrink-0",
                        active
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-fg-muted)]",
                      )}
                      aria-label="Inbound email"
                    />
                  ) : (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        active
                          ? "bg-[var(--color-accent)]"
                          : "bg-[var(--color-fg-muted)]",
                      )}
                    />
                  )}
                  {!collapsed && (
                    <span className="min-w-0 flex-1 truncate">
                      {s.title?.trim() ||
                        (s.channel === "email" ? "Inbound email" : "New chat")}
                    </span>
                  )}
                  {!collapsed && (
                    <span className="shrink-0 text-[10px] text-[var(--color-fg-muted)] group-hover:invisible">
                      {relative(s.updated_at)}
                    </span>
                  )}
                </Link>

                {/* Delete sits as a sibling of the Link (HTML doesn't allow
                    nested anchors and React-19 was swallowing the form
                    submit when nested). Absolute-positioned on hover. */}
                {!collapsed && (
                  <div className="absolute inset-y-0 right-1 flex items-center opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="Delete chat"
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
            ? `"${deleting.title?.trim() || (deleting.channel === "email" ? "Inbound email" : "New chat")}" will be permanently removed, along with all its messages.`
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
