import Link from "next/link";
import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Paperclip, Send } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callAction } from "@/lib/composio/client";
import { sendMailboxDraftAction } from "../actions";

export const dynamic = "force-dynamic";

type Message = {
  external_id: string;
  folder_external_id: string | null;
  direction: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  to_recipients: unknown;
  cc_recipients: unknown;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  has_attachments: boolean;
  body_preview: string | null;
  body_html: string | null;
};

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = decodeURIComponent(id);

  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const supabase = await createSupabaseServer();

  const { data } = await supabase
    .from("email_messages")
    .select(
      "external_id, folder_external_id, direction, subject, from_name, from_address, to_recipients, cc_recipients, received_at, sent_at, is_read, has_attachments, body_preview, body_html",
    )
    .eq("org_id", user.orgId)
    .eq("conversation_id", conversationId);
  const messages = (data ?? []) as Message[];
  if (messages.length === 0) notFound();

  // Which of these messages are unsent drafts? Those get a human "Send" control
  // — the only path to send an external email George prepared (his own tool
  // refuses external recipients).
  const { data: draftsFolder } = await supabase
    .from("mail_folders")
    .select("external_id")
    .eq("org_id", user.orgId)
    .ilike("display_name", "Drafts")
    .maybeSingle();
  const draftsFolderId = (draftsFolder?.external_id as string | undefined) ?? null;

  // Newest message on top, thread below. Sort by the effective timestamp
  // (received_at for inbound, sent_at for George's outbound) so sent replies
  // interleave correctly instead of sinking on a null received_at.
  const effective = (m: Message) =>
    new Date(m.received_at ?? m.sent_at ?? 0).getTime();
  messages.sort((a, b) => effective(b) - effective(a));

  // Opening the thread marks its inbound messages read — locally (clears the
  // unread dot in the list) and best-effort in Outlook so a re-sync doesn't
  // revert it. Runs after the response so it never slows the render.
  const unreadIds = messages
    .filter((m) => m.direction === "inbound" && !m.is_read)
    .map((m) => m.external_id);
  if (unreadIds.length > 0) {
    after(async () => {
      const admin = createSupabaseAdmin();
      await admin
        .from("email_messages")
        .update({ is_read: true })
        .eq("org_id", user.orgId)
        .eq("conversation_id", conversationId)
        .eq("direction", "inbound");
      for (const externalId of unreadIds) {
        await callAction("OUTLOOK_UPDATE_EMAIL", user.orgId, {
          messageId: externalId,
          is_read: true,
        }).catch(() => {});
      }
    });
  }

  const subject = messages.find((m) => m.subject)?.subject ?? "(no subject)";

  return (
    <div className="w-full space-y-4 px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <Link
        href="/mailbox"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft size={14} /> Mailbox
      </Link>

      <div>
        <h1 className="text-[20px] font-bold text-[var(--color-fg)]">{subject}</h1>
        <p className="text-[12px] text-[var(--color-fg-muted)]">
          {messages.length} message{messages.length === 1 ? "" : "s"} in this thread
        </p>
      </div>

      <div className="space-y-4">
        {messages.map((m) => (
          <MessageCard
            key={m.external_id}
            m={m}
            isDraft={draftsFolderId != null && m.folder_external_id === draftsFolderId}
          />
        ))}
      </div>
    </div>
  );
}

function MessageCard({ m, isDraft }: { m: Message; isDraft: boolean }) {
  const when = m.received_at ?? m.sent_at;
  const sender = m.from_name ?? m.from_address ?? "(unknown)";
  const html = m.body_html;
  return (
    <div className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-[var(--color-fg)]">{sender}</span>
            <span
              className="inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-medium"
              style={
                isDraft
                  ? { background: "var(--color-warning-light, #fef3c7)", color: "var(--color-warning, #92600a)" }
                  : m.direction === "outbound"
                  ? { background: "var(--color-success-light)", color: "var(--color-success)" }
                  : { background: "var(--color-accent-light)", color: "var(--color-accent)" }
              }
            >
              {isDraft ? "Draft — not sent" : m.direction === "outbound" ? "Sent" : "Received"}
            </span>
            {m.has_attachments && <Paperclip size={12} className="text-[var(--color-fg-muted)]" />}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--color-fg-muted)]">
            to {recipients(m.to_recipients)}
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--color-fg-muted)]">
          {when ? new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}
        </span>
      </header>
      {isDraft && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-5 py-2.5">
          <p className="text-[12px] text-[var(--color-fg-secondary)]">
            George prepared this draft. Review the recipients and body, then send when ready.
          </p>
          <form action={sendMailboxDraftAction}>
            <input type="hidden" name="external_id" value={m.external_id} />
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
            >
              <Send size={13} /> Send now
            </button>
          </form>
        </div>
      )}
      <div className="px-1 py-1">
        {html ? (
          // Sandboxed iframe: the email HTML can't reach our DOM/cookies, and
          // scripts/inline handlers are inert (no allow-scripts).
          <iframe
            title="Email body"
            sandbox=""
            srcDoc={wrapHtmlForViewer(html)}
            className="h-[480px] w-full rounded-md border border-[var(--color-border-subtle)] bg-white"
          />
        ) : (
          <p className="px-4 py-4 text-[13px] text-[var(--color-fg-muted)]">{m.body_preview ?? "(no body)"}</p>
        )}
      </div>
    </div>
  );
}

function recipients(to: unknown): string {
  if (!Array.isArray(to) || to.length === 0) return "—";
  const names = to.map((r) => {
    const ea = ((r as Record<string, unknown>)?.emailAddress ?? r) as Record<string, unknown>;
    return (ea?.address as string) ?? (ea?.name as string) ?? "—";
  });
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
}

function wrapHtmlForViewer(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 16px; background: #fff; color: #111; font-family: "Open Sans", Calibri, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; font-size: 14px; line-height: 1.5; }
  img { max-width: 100%; height: auto; }
  a { color: #6D45F5; }
  table { max-width: 100%; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}
