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

  const rowPayload = (row.payload ?? {}) as Record<string, unknown>;
  const draftId = (rowPayload.draft_id as string | undefined) ?? null;

  // For email.sent rows the payload usually only contains draft_id. Pull
  // the originating draft row's payload (subject / to / cc / body_html)
  // so we can render the same clean preview we'd show before send.
  let draftPayload: Record<string, unknown> = {};
  if (row.action === "email.sent" && draftId) {
    const draftLookup = await supabase
      .from("audit_log")
      .select("payload")
      .eq("org_id", user.orgId)
      .in("action", ["email.drafted", "email.reply_drafted"])
      .contains("payload", { draft_id: draftId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draftLookup.data) {
      draftPayload =
        ((draftLookup.data.payload ?? {}) as Record<string, unknown>) ?? {};
    }
  }

  // Best-source merge: audit row first, then the matching draft row.
  const merged: Record<string, unknown> = { ...draftPayload, ...rowPayload };
  // Body html: prefer the merged value (always the latest snapshot).
  let bodyHtml = (merged.body_html as string | undefined) ?? null;

  // Optional live re-fetch — only useful for fresh drafts. Skip for sent
  // rows (the draft id moves and we already have the snapshot we need).
  let liveFetchError: string | null = null;
  if (!bodyHtml && draftId && row.action !== "email.sent") {
    const res = await callAction<Record<string, unknown>>(
      "OUTLOOK_GET_MESSAGE",
      user.orgId,
      { messageId: draftId },
    );
    if (res.ok) {
      const fetched = res.data;
      const body = (fetched as { body?: { contentType?: string; content?: string } })
        .body;
      if (body?.content) {
        bodyHtml = body.content;
      }
    } else {
      liveFetchError = res.error;
    }
  }

  const subject = (merged.subject as string | undefined) ?? null;
  const toList = Array.isArray(merged.to)
    ? (merged.to as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const ccList = Array.isArray(merged.cc)
    ? (merged.cc as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const attachments = Array.isArray(merged.attachments)
    ? (merged.attachments as Array<Record<string, unknown>>)
    : [];

  const actionLabel =
    row.action === "email.sent"
      ? "Sent"
      : row.action === "email.reply_drafted"
        ? "Draft reply"
        : "Draft";

  return (
    <div className="mx-auto max-w-[1080px] space-y-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
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
            {ccList.length > 0 && (
              <>
                <dt className="text-[var(--color-fg-muted)]">Cc</dt>
                <dd className="text-[var(--color-fg)]">{ccList.join(", ")}</dd>
              </>
            )}
            {attachments.length > 0 && (
              <>
                <dt className="text-[var(--color-fg-muted)]">Attachments</dt>
                <dd className="text-[var(--color-fg)]">
                  <ul className="space-y-0.5">
                    {attachments.map((a, i) => (
                      <li key={i} className="text-[12px]">
                        {(a.original_name as string) ??
                          (a.name as string) ??
                          "(unnamed)"}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        </header>

        <div className="px-6 py-5">
          {bodyHtml ? (
            // Sandboxed iframe — same pattern as the inbound viewer. Strips
            // scripts/same-origin so anything in the email can't reach our
            // DOM or cookies. Forces a white background.
            <iframe
              title="Email body"
              sandbox=""
              srcDoc={wrapHtmlForViewer(bodyHtml)}
              className="h-[720px] w-full rounded-md border border-[var(--color-border-subtle)] bg-white"
            />
          ) : liveFetchError ? (
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              No body was captured at draft time, and Outlook returned:{" "}
              {liveFetchError}. New drafts will render here automatically.
            </p>
          ) : (
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              No body was captured at draft time. This row was created
              before body snapshots were enabled — new drafts will render
              their HTML here automatically.
            </p>
          )}
        </div>
      </div>

      <details className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] text-[12px]">
        <summary className="cursor-pointer select-none px-4 py-3 text-[var(--color-fg-secondary)]">
          Debug: audit row + merged payload
        </summary>
        <pre className="overflow-auto border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-fg-secondary)]">
          {JSON.stringify(
            {
              row,
              draftPayload,
              merged,
              liveFetchError,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
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
