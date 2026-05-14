import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, MessageSquare } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { extractOutlookMessage } from "@/lib/agent/process-event";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  event_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  session_id: string | null;
  created_at: string;
};

export default async function InboundEmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("agent_events")
    .select("id, event_type, status, payload, session_id, created_at")
    .eq("id", id)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (!data) notFound();
  const row = data as EventRow;

  const email = extractOutlookMessage(row.payload);

  // Pull the raw HTML body when present. Composio stores the fetched
  // Microsoft Graph message under payload.fetched.data; the body is
  // either `body.content` (HTML/text + contentType) or a plain string.
  const rawHtml = extractHtmlBody(row.payload);
  const fromLabel = email.from
    ? email.from.name && email.from.address
      ? `${email.from.name} <${email.from.address}>`
      : email.from.address ?? email.from.name ?? "(unknown)"
    : "(unknown)";

  return (
    <div className="mx-auto max-w-[1080px] space-y-5 px-8 py-7">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/inbox?filter=inbound"
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
            Review George&apos;s take
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
        <header className="space-y-2 border-b border-[var(--color-border-subtle)] px-6 py-5">
          <h1 className="text-[22px] font-semibold text-[var(--color-fg)]">
            {email.subject ?? "(no subject)"}
          </h1>
          <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-[13px]">
            <dt className="text-[var(--color-fg-muted)]">From</dt>
            <dd className="text-[var(--color-fg)]">{fromLabel}</dd>
            {email.to.length > 0 && (
              <>
                <dt className="text-[var(--color-fg-muted)]">To</dt>
                <dd className="text-[var(--color-fg)]">{email.to.join(", ")}</dd>
              </>
            )}
            {email.received_at && (
              <>
                <dt className="text-[var(--color-fg-muted)]">Received</dt>
                <dd className="text-[var(--color-fg-secondary)]">
                  {new Date(email.received_at).toLocaleString()}
                </dd>
              </>
            )}
          </dl>
        </header>

        <div className="px-6 py-5">
          {rawHtml ? (
            // Iframe srcdoc with `sandbox` strips scripts and same-origin
            // access — the email's HTML can't reach our DOM/cookies. We
            // intentionally do not allow-scripts; inline event handlers
            // and <script> tags are inert. Images still load via the
            // browser's default networking.
            <iframe
              title="Email body"
              sandbox=""
              srcDoc={wrapHtmlForViewer(rawHtml)}
              className="h-[720px] w-full rounded-md border border-[var(--color-border-subtle)] bg-white"
            />
          ) : email.body_text ? (
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--color-fg)]">
              {email.body_text}
            </pre>
          ) : (
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              (no body captured)
            </p>
          )}
        </div>
      </div>

      <details className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] text-[12px]">
        <summary className="cursor-pointer select-none px-4 py-3 text-[var(--color-fg-secondary)]">
          Debug: raw event payload
        </summary>
        <pre className="overflow-auto border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-fg-secondary)]">
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      </details>

      {row.session_id && (
        <div className="rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 text-[13px] text-[var(--color-fg-secondary)]">
          George generated an autonomous response for this email. Click{" "}
          <Link
            href={`/chat/${row.session_id}`}
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
          >
            Review George&apos;s take <ExternalLink size={11} />
          </Link>{" "}
          above to read it and approve/edit the draft reply.
        </div>
      )}
    </div>
  );
}

/**
 * Drill into the event payload to find the email's raw HTML body. Composio
 * stores the fetched Microsoft Graph message under payload.fetched.data
 * (we set that key explicitly in process-event.ts). Graph itself uses
 * `body: { contentType: 'HTML'|'Text', content: '...' }`.
 */
function extractHtmlBody(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) return null;
  const fetched = payload.fetched as Record<string, unknown> | undefined;
  const candidates: Array<Record<string, unknown>> = [];
  const push = (v: unknown) => {
    if (v && typeof v === "object") candidates.push(v as Record<string, unknown>);
  };
  if (fetched) {
    push(fetched);
    push(fetched.data);
    push(fetched.response_data);
  }
  push(payload);
  push(payload.data);
  const inner = payload.payload as Record<string, unknown> | undefined;
  if (inner) {
    push(inner);
    push(inner.data);
  }

  for (const c of candidates) {
    const body = c.body;
    if (!body) continue;
    if (typeof body === "object") {
      const ct = (body as { contentType?: string }).contentType?.toLowerCase();
      const content = (body as { content?: string }).content ?? null;
      if (content && (ct === "html" || ct === undefined)) {
        // If contentType is missing, sniff for tags.
        if (ct === "html" || /<\/?[a-z][\s\S]*>/i.test(content)) {
          return content;
        }
      }
    }
  }
  return null;
}

/**
 * Wrap the email's HTML in a minimal document so it renders cleanly in
 * the sandboxed iframe. The email may or may not be a full HTML document;
 * either way we provide its own <html><head> with a baseline style and
 * UTF-8 declaration, and force a white background so dark-themed apps
 * don't bleed in.
 */
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
