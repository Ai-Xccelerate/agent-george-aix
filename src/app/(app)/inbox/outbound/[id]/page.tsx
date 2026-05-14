import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MessageSquare, Send } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { callAction } from "@/lib/composio/client";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  session_id: string | null;
  created_at: string;
};

export default async function OutboundEmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("audit_log")
    .select("id, action, payload, session_id, created_at")
    .eq("id", id)
    .eq("org_id", user.orgId)
    .in("action", ["email.drafted", "email.reply_drafted", "email.sent"])
    .maybeSingle();
  if (!data) notFound();
  const row = data as AuditRow;

  const auditPayload = (row.payload ?? {}) as Record<string, unknown>;
  const draftId = (auditPayload.draft_id as string | undefined) ?? null;

  // Pull the current state of the draft / sent message straight from Outlook.
  // Drafts can be edited or deleted upstream, so we always re-fetch rather
  // than relying solely on what we logged at draft time.
  let fetched: Record<string, unknown> | null = null;
  let fetchError: string | null = null;
  if (draftId) {
    const res = await callAction<Record<string, unknown>>(
      "OUTLOOK_GET_MESSAGE",
      user.orgId,
      { messageId: draftId },
    );
    if (res.ok) {
      fetched = res.data;
    } else {
      fetchError = res.error;
    }
  }

  const subject =
    (fetched?.subject as string | undefined) ??
    (auditPayload.subject as string | undefined) ??
    null;
  const toList = extractRecipients(fetched, auditPayload);
  const rawHtml = extractHtmlBody(fetched);
  const bodyPreview = (fetched?.bodyPreview as string | undefined) ?? null;
  const actionLabel =
    row.action === "email.sent"
      ? "Sent"
      : row.action === "email.reply_drafted"
        ? "Draft reply"
        : "Draft";

  return (
    <div className="mx-auto max-w-[1080px] space-y-5 px-8 py-7">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/inbox?filter=outbound"
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
        >
          <ArrowLeft size={14} />
          Back to inbox
        </Link>
        {row.session_id && (
          <Link
            href={`/chat/${row.session_id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-[13px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            <MessageSquare size={14} />
            Open chat
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
        <header className="space-y-2 border-b border-[var(--color-border-subtle)] px-6 py-5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium"
              style={{
                background:
                  row.action === "email.sent"
                    ? "var(--color-success-light)"
                    : "var(--color-accent-light)",
                color:
                  row.action === "email.sent"
                    ? "var(--color-success)"
                    : "var(--color-accent)",
              }}
            >
              <Send size={10} />
              {actionLabel}
            </span>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              {new Date(row.created_at).toLocaleString()}
            </span>
          </div>
          <h1 className="text-[22px] font-semibold text-[var(--color-fg)]">
            {subject ?? "(no subject)"}
          </h1>
          <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-[13px]">
            {toList.length > 0 && (
              <>
                <dt className="text-[var(--color-fg-muted)]">To</dt>
                <dd className="text-[var(--color-fg)]">{toList.join(", ")}</dd>
              </>
            )}
          </dl>
        </header>

        <div className="px-6 py-5">
          {rawHtml ? (
            <iframe
              title="Email body"
              sandbox=""
              srcDoc={wrapHtmlForViewer(rawHtml)}
              className="h-[720px] w-full rounded-md border border-[var(--color-border-subtle)] bg-white"
            />
          ) : bodyPreview ? (
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--color-fg)]">
              {bodyPreview}
            </pre>
          ) : fetchError ? (
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              Couldn&apos;t fetch the draft from Outlook: {fetchError}. The
              draft may have been deleted or sent.
            </p>
          ) : (
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              (no body captured)
            </p>
          )}
        </div>
      </div>

      <details className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] text-[12px]">
        <summary className="cursor-pointer select-none px-4 py-3 text-[var(--color-fg-secondary)]">
          Debug: audit row + fetched draft
        </summary>
        <pre className="overflow-auto border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-fg-secondary)]">
          {JSON.stringify({ audit: row, fetched }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function extractRecipients(
  fetched: Record<string, unknown> | null,
  auditPayload: Record<string, unknown>,
): string[] {
  // Prefer the upstream draft's toRecipients (Graph shape).
  const graphRecipients = fetched?.toRecipients;
  if (Array.isArray(graphRecipients)) {
    const out = graphRecipients
      .map((r) => {
        if (typeof r === "string") return r;
        if (r && typeof r === "object") {
          const ea = (r as { emailAddress?: { address?: string } }).emailAddress;
          return ea?.address ?? null;
        }
        return null;
      })
      .filter((s): s is string => !!s);
    if (out.length > 0) return out;
  }
  // Fall back to what we logged at draft time.
  const auditTo = auditPayload.to;
  if (Array.isArray(auditTo)) {
    return auditTo.filter((s): s is string => typeof s === "string");
  }
  return [];
}

function extractHtmlBody(
  fetched: Record<string, unknown> | null,
): string | null {
  if (!fetched) return null;
  const body = fetched.body;
  if (!body || typeof body !== "object") return null;
  const ct = (body as { contentType?: string }).contentType?.toLowerCase();
  const content = (body as { content?: string }).content ?? null;
  if (!content) return null;
  if (ct === "html") return content;
  // Sniff if contentType is missing.
  if (!ct && /<\/?[a-z][\s\S]*>/i.test(content)) return content;
  return null;
}

function wrapHtmlForViewer(html: string): string {
  const isFullDoc = /<html[\s>]/i.test(html);
  if (isFullDoc) return html;
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
