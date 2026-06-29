import Link from "next/link";
import { redirect } from "next/navigation";
import { Mail, Paperclip } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";

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
};

// Folders Outlook always has, in the order people expect them.
const FOLDER_ORDER = ["Inbox", "Sent Items", "Drafts", "Archive", "Deleted Items", "Junk Email"];
const OUTBOUND = new Set(["Sent Items", "Drafts", "Outbox"]);

export default async function MailboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ folder?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServer();

  const { data: folderData } = await supabase
    .from("mail_folders")
    .select("external_id, display_name, unread_item_count, total_item_count")
    .eq("org_id", user.orgId);
  const folders = (folderData ?? []) as Folder[];
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

  const { data: msgData } = await supabase
    .from("email_messages")
    .select(
      "external_id, conversation_id, subject, body_preview, from_name, from_address, to_recipients, is_read, has_attachments, received_at, sent_at",
    )
    .eq("org_id", user.orgId)
    .eq("folder_external_id", selected.external_id)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(100);
  const messages = (msgData ?? []) as Message[];

  return (
    <div className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <header className="mb-5">
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Mailbox</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          George&apos;s Microsoft 365 mailbox (agent.george@getonyx.ai), mirrored locally.
        </p>
      </header>

      <div className="flex flex-col gap-5 md:flex-row">
        {/* Folder rail */}
        <nav className="md:w-56 md:shrink-0">
          <ul className="flex gap-1 overflow-x-auto rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-1 md:flex-col md:gap-0.5">
            {folders.map((f) => {
              const active = f.external_id === selected.external_id;
              return (
                <li key={f.external_id} className="shrink-0">
                  <Link
                    href={`/mailbox?folder=${encodeURIComponent(f.external_id)}`}
                    className={
                      active
                        ? "flex items-center justify-between gap-2 rounded-md bg-[var(--color-accent-light)] px-3 py-2 text-[13px] font-semibold text-[var(--color-accent)]"
                        : "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-[13px] text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                    }
                  >
                    <span className="truncate">{f.display_name}</span>
                    {f.unread_item_count ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[11px] font-medium text-[var(--color-fg-inverse)]">
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
          {messages.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center text-[13px] text-[var(--color-fg-muted)]">
              Nothing in {selected.display_name}.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
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
  const who = outbound ? `To ${firstRecipient(m.to_recipients) ?? "—"}` : (m.from_name ?? m.from_address ?? "(unknown sender)");
  const when = m.received_at ?? m.sent_at;
  const href = m.conversation_id ? `/mailbox/${encodeURIComponent(m.conversation_id)}` : "#";
  return (
    <li>
      <Link href={href} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-surface-3)]">
        {!m.is_read && !outbound && (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" aria-label="unread" />
        )}
        <div className={`min-w-0 flex-1 ${m.is_read || outbound ? "pl-[20px]" : ""}`}>
          <div className="flex items-center gap-2">
            <span className={`truncate text-[13px] ${m.is_read ? "text-[var(--color-fg)]" : "font-semibold text-[var(--color-fg)]"}`}>
              {m.subject || "(no subject)"}
            </span>
            {m.has_attachments && <Paperclip size={12} className="shrink-0 text-[var(--color-fg-muted)]" />}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--color-fg-secondary)]">{who}</div>
          {m.body_preview && (
            <div className="mt-1 line-clamp-1 text-[12px] text-[var(--color-fg-muted)]">{m.body_preview}</div>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-[var(--color-fg-muted)]">{when ? relative(when) : ""}</span>
      </Link>
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
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Mailbox</h1>
      </header>
      <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <Mail size={20} />
        </div>
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">Mailbox not synced yet</h2>
        <p className="max-w-[440px] text-sm text-[var(--color-fg-secondary)]">
          Once the mailbox mirror runs (it syncs on a schedule, or run{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">pnpm sync:mailbox</code>), George&apos;s
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
