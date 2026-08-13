import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCheck, Flag, Mail, Paperclip, Search, Trash2 } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { MAILBOX_SYNC_INTERVAL_MS } from "@/lib/agent/mailbox-sync";
import { deleteEmailAction, toggleFlagAction } from "./actions";
import { SyncStatus } from "./_sync-status";

export const dynamic = "force-dynamic";

type Folder = {
  external_id: string;
  display_name: string;
  unread_item_count: number | null;
  total_item_count: number | null;
};

type Message = {
  external_id: string;
  conversation_id: string | null;
  subject: string | null;
  body_preview: string | null;
  from_name: string | null;
  from_address: string | null;
  to_recipients: unknown;
  is_read: boolean;
  has_attachments: boolean;
  received_at: string | null;
  sent_at: string | null;
  flagged: boolean;
  processed_at: string | null;
  processed_session_id: string | null;
};

// Folders Outlook always has, in the order people expect them.
const FOLDER_ORDER = ["Inbox", "Sent Items", "Drafts", "Archive", "Deleted Items", "Junk Email"];
const OUTBOUND = new Set(["Sent Items", "Drafts", "Outbox"]);

export default async function MailboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ folder?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();
  const supabase = createSupabaseAdmin();

  const { data: folderData } = await supabase
    .from("mail_folders")
    .select("external_id, display_name, unread_item_count, total_item_count, synced_at")
    .eq("org_id", user.orgId);
  const folders = (folderData ?? []) as (Folder & { synced_at: string | null })[];
  const lastSyncedAt = folders.reduce<string | null>((latest, f) => {
    if (!f.synced_at) return latest;
    return !latest || f.synced_at > latest ? f.synced_at : latest;
  }, null);
  folders.sort((a, b) => {
    const ai = FOLDER_ORDER.indexOf(a.display_name);
    const bi = FOLDER_ORDER.indexOf(b.display_name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.display_name.localeCompare(b.display_name);
  });

  if (folders.length === 0) return <EmptyMailbox />;

  const selected =
    folders.find((f) => f.external_id === sp.folder) ??
    folders.find((f) => f.display_name === "Inbox") ??
    folders[0];
  const isOutbound = OUTBOUND.has(selected.display_name);

  let msgQuery = supabase
    .from("email_messages")
    .select(
      "external_id, conversation_id, subject, body_preview, from_name, from_address, to_recipients, is_read, has_attachments, received_at, sent_at, flagged, processed_at, processed_session_id",
    )
    .eq("org_id", user.orgId)
    .eq("folder_external_id", selected.external_id);
  if (q) {
    // Sanitize before interpolating into the .or() filter grammar — commas and
    // parens are separators there, so strip them rather than risk a broken query.
    const safe = q.replace(/[,()%*]/g, " ").trim();
    if (safe) {
      msgQuery = msgQuery.or(
        `subject.ilike.%${safe}%,from_name.ilike.%${safe}%,from_address.ilike.%${safe}%,body_preview.ilike.%${safe}%`,
      );
    }
  }
  const { data: msgData } = await msgQuery
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(100);
  const messages = (msgData ?? []) as Message[];

  return (
    <div className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Mailbox</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            George&apos;s Microsoft 365 mailbox (agent.george@getonyx.ai), mirrored locally.
          </p>
        </div>
        <SyncStatus lastSyncedAt={lastSyncedAt} intervalMs={MAILBOX_SYNC_INTERVAL_MS} />
      </header>

      <div className="flex flex-col gap-5 md:flex-row">
        {/* Folder rail */}
        <nav className="md:w-56 md:shrink-0">
          <ul className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-1 md:flex-col md:gap-0.5">
            {folders.map((f) => {
              const active = f.external_id === selected.external_id;
              return (
                <li key={f.external_id} className="shrink-0">
                  <Link
                    href={`/mailbox?folder=${encodeURIComponent(f.external_id)}`}
                    className={
                      active
                        ? "flex items-center justify-between gap-2 rounded-md bg-brand-50 dark:bg-brand-500/15 px-3 py-2 text-theme-sm font-semibold text-brand-500 dark:text-brand-400"
                        : "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-theme-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-white/90"
                    }
                  >
                    <span className="truncate">{f.display_name}</span>
                    {f.unread_item_count ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-theme-xs font-medium text-white">
                        {f.unread_item_count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Message list */}
        <div className="min-w-0 flex-1">
          {/* Search within the current folder (server-side, no JS needed) */}
          <form method="GET" action="/mailbox" className="mb-3">
            <input type="hidden" name="folder" value={selected.external_id} />
            <div className="flex h-9 items-center gap-2 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3">
              <Search size={15} className="shrink-0 text-gray-400 dark:text-gray-500" />
              <input
                name="q"
                defaultValue={q}
                placeholder={`Search ${selected.display_name}…`}
                className="w-full min-w-0 bg-transparent text-theme-sm text-gray-800 dark:text-white/90 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
              />
              {q ? (
                <Link
                  href={`/mailbox?folder=${encodeURIComponent(selected.external_id)}`}
                  className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500 hover:text-gray-800 dark:hover:text-white/90"
                >
                  Clear
                </Link>
              ) : null}
            </div>
          </form>

          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-16 text-center text-theme-sm text-gray-400 dark:text-gray-500">
              {q ? `No matches for “${q}” in ${selected.display_name}.` : `Nothing in ${selected.display_name}.`}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
              {messages.map((m) => (
                <MessageRow key={m.external_id} m={m} outbound={isOutbound} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageRow({ m, outbound }: { m: Message; outbound: boolean }) {
  const who = outbound
    ? `To ${firstRecipient(m.to_recipients) ?? "—"}`
    : m.from_name ?? m.from_address ?? "(unknown sender)";
  const when = m.received_at ?? m.sent_at;
  const href = m.conversation_id ? `/mailbox/${encodeURIComponent(m.conversation_id)}` : "#";
  const unread = !m.is_read && !outbound;

  return (
    <li
      className={`group flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 ${
        m.flagged ? "bg-brand-50 dark:bg-brand-500/15/40" : ""
      }`}
    >
      {/* Flag toggle */}
      <form action={toggleFlagAction} className="shrink-0">
        <input type="hidden" name="external_id" value={m.external_id} />
        <input type="hidden" name="flagged" value={(!m.flagged).toString()} />
        <button
          type="submit"
          aria-label={m.flagged ? "Unflag" : "Flag for George"}
          title={m.flagged ? "Flagged — click to clear" : "Flag as a signal for George"}
          className={`flex h-6 w-6 items-center justify-center rounded ${
            m.flagged
              ? "text-brand-500 dark:text-brand-400"
              : "text-gray-400 dark:text-gray-500 opacity-0 hover:bg-gray-50 dark:hover:bg-white/[0.03] group-hover:opacity-100"
          }`}
        >
          <Flag size={13} fill={m.flagged ? "currentColor" : "none"} />
        </button>
      </form>

      {/* Unread dot */}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${unread ? "bg-brand-500" : "bg-transparent"}`}
        aria-hidden
      />

      {/* Content (single compact line) */}
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 text-theme-sm">
        <span
          className={`w-44 shrink-0 truncate ${
            unread ? "font-semibold text-gray-800 dark:text-white/90" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {who}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className={unread ? "font-semibold text-gray-800 dark:text-white/90" : "text-gray-800 dark:text-white/90"}>
            {m.subject || "(no subject)"}
          </span>
          {m.body_preview && (
            <span className="text-gray-400 dark:text-gray-500"> — {m.body_preview}</span>
          )}
        </span>
      </Link>

      {/* Badges */}
      {m.has_attachments && <Paperclip size={12} className="shrink-0 text-gray-400 dark:text-gray-500" />}
      {m.processed_at && (
        <Link
          href={m.processed_session_id ? `/chat/${m.processed_session_id}` : "#"}
          title={`George reviewed ${relative(m.processed_at)} ago`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-50 dark:bg-success-500/15 px-1.5 py-0.5 text-theme-xs font-medium text-success-500"
        >
          <CheckCheck size={11} /> George
        </Link>
      )}

      <span className="w-12 shrink-0 text-right text-theme-xs text-gray-400 dark:text-gray-500">
        {when ? relative(when) : ""}
      </span>

      {/* Delete */}
      <form action={deleteEmailAction} className="shrink-0">
        <input type="hidden" name="external_id" value={m.external_id} />
        <button
          type="submit"
          aria-label="Delete"
          title="Move to Deleted Items"
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 dark:text-gray-500 opacity-0 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:text-error-500 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </form>
    </li>
  );
}

function firstRecipient(to: unknown): string | null {
  if (!Array.isArray(to) || to.length === 0) return null;
  const r = to[0] as Record<string, unknown>;
  const ea = (r?.emailAddress ?? r) as Record<string, unknown>;
  const extra = to.length > 1 ? ` +${to.length - 1}` : "";
  return `${(ea?.name as string) ?? (ea?.address as string) ?? "—"}${extra}`;
}

function EmptyMailbox() {
  return (
    <div className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Mailbox</h1>
      </header>
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
          <Mail size={20} />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Mailbox not synced yet</h2>
        <p className="max-w-[440px] text-sm text-gray-500 dark:text-gray-400">
          Once the mailbox mirror runs (it syncs on a schedule, or run{" "}
          <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1 py-0.5 text-theme-xs">pnpm sync:mailbox</code>), George&apos;s
          folders and messages appear here.
        </p>
      </div>
    </div>
  );
}

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
