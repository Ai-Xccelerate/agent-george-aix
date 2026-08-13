import Link from "next/link";
import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Paperclip, Send } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callAction } from "@/lib/composio/client";
import { Badge } from "@/components/ui/badge";
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
  const supabase = createSupabaseAdmin();

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
          message_id: externalId,
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
        className="inline-flex items-center gap-1.5 text-theme-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white/90"
      >
        <ArrowLeft size={14} /> Mailbox
      </Link>

      <div>
        <h1 className="text-theme-xl font-bold text-gray-800 dark:text-white/90">{subject}</h1>
        <p className="text-theme-xs text-gray-400 dark:text-gray-500">
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
      <header className="flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-800 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-theme-sm font-semibold text-gray-800 dark:text-white/90">{sender}</span>
            <Badge
              withDot={false}
              tone={
                isDraft ? "warning" : m.direction === "outbound" ? "success" : "accent"
              }
            >
              {isDraft ? "Draft — not sent" : m.direction === "outbound" ? "Sent" : "Received"}
            </Badge>
            {m.has_attachments && <Paperclip size={12} className="text-gray-400 dark:text-gray-500" />}
          </div>
          <div className="mt-0.5 truncate text-theme-xs text-gray-400 dark:text-gray-500">
            to {recipients(m.to_recipients)}
          </div>
        </div>
        <span className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500">
          {when ? new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}
        </span>
      </header>
      {isDraft && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] px-5 py-2.5">
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            George prepared this draft. Review the recipients and body, then send when ready.
          </p>
          <form action={sendMailboxDraftAction}>
            <input type="hidden" name="external_id" value={m.external_id} />
            <button
              type="submit"
              className="h-9 px-3 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
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
            className="h-[480px] w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white"
          />
        ) : (
          <p className="px-4 py-4 text-theme-sm text-gray-400 dark:text-gray-500">{m.body_preview ?? "(no body)"}</p>
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
