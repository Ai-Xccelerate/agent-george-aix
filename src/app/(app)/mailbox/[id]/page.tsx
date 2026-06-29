import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Paperclip } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Message = {
  external_id: string;
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
      "external_id, direction, subject, from_name, from_address, to_recipients, cc_recipients, received_at, sent_at, is_read, has_attachments, body_preview, body_html",
    )
    .eq("org_id", user.orgId)
    .eq("conversation_id", conversationId)
    .order("received_at", { ascending: true, nullsFirst: true });
  const messages = (data ?? []) as Message[];
  if (messages.length === 0) notFound();

  const subject = messages.find((m) => m.subject)?.subject ?? "(no subject)";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6 md:px-8 md:py-7">
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
          <MessageCard key={m.external_id} m={m} />
        ))}
      </div>
    </div>
  );
}

function MessageCard({ m }: { m: Message }) {
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
                m.direction === "outbound"
                  ? { background: "var(--color-success-light)", color: "var(--color-success)" }
                  : { background: "var(--color-accent-light)", color: "var(--color-accent)" }
              }
            >
              {m.direction === "outbound" ? "Sent" : "Received"}
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
  html, body { margin: 0; padding: 16px; background: #fff; color: #111; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.5; }
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
