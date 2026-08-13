/**
 * Parchment connection panel for Settings → Knowledge.
 *
 * Server component: it reaches Parchment during render, so the page shows the
 * live state rather than a stored flag that drifts from reality. Every call
 * fails open (the client never throws), so a Parchment outage degrades this
 * panel into an explanation and leaves the rest of the page — George's core
 * playbooks — working normally.
 *
 * Why the split is shown so plainly: two knowledge stores exist on purpose.
 * Core playbooks are George's operating instructions and stay in the repo, so
 * they survive a Parchment outage and change only through a reviewed PR.
 * Organisational knowledge lives in Parchment, which understands sections,
 * hierarchy and business function in a way chunked search cannot.
 */
import { Database, ExternalLink } from "lucide-react";
import {
  isParchmentEnabled,
  parchment,
  parchmentConfig,
  parchmentMissingVars,
} from "@/lib/parchment/client";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-[var(--color-fg-secondary)]">{label}</span>
      <span className="text-right text-xs font-medium text-[var(--color-fg)]">{value}</span>
    </div>
  );
}

export default async function ParchmentPanel() {
  if (!isParchmentEnabled()) {
    const missing = parchmentMissingVars();
    return (
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-[var(--color-fg-secondary)]" />
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            Organisation knowledge base
          </h2>
          <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-fg-secondary)]">
            Not connected
          </span>
        </div>
        <p className="mt-2 max-w-[640px] text-xs text-[var(--color-fg-secondary)]">
          George is answering from the core playbooks below and its own supplemental
          docs. Connect Parchment to search the organisation&rsquo;s knowledge base —
          whole sections with their hierarchy, rather than fragments.
        </p>
        <p className="mt-2 text-xs text-[var(--color-fg-secondary)]">
          Missing:{" "}
          {missing.map((m, i) => (
            <span key={m}>
              <code className="rounded bg-[var(--color-bg)] px-1 py-0.5">{m}</code>
              {i < missing.length - 1 ? ", " : ""}
            </span>
          ))}
          . Create an <strong>agent</strong> API key in the Parchment console under
          Connect, then set both on this environment.
        </p>
      </section>
    );
  }

  const cfg = parchmentConfig()!;
  // Parallel, because a panel that takes three sequential round trips to render
  // makes the whole settings page feel broken when Parchment is slow.
  const [health, docs, overview] = await Promise.all([
    parchment.health(),
    parchment.documents(),
    parchment.overview(),
  ]);

  const reachable = health.ok;
  const docCount = docs.ok && Array.isArray(docs.data) ? docs.data.length : null;
  const totals =
    overview.ok && overview.data && typeof overview.data === "object"
      ? (overview.data as Record<string, unknown>)
      : null;
  const sectionCount =
    totals && typeof totals.total_sections === "number" ? totals.total_sections : null;

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
      <div className="flex items-center gap-2">
        <Database className="size-4 text-[var(--color-fg-secondary)]" />
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">
          Organisation knowledge base
        </h2>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            reachable
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          {reachable ? "Connected" : "Unreachable"}
        </span>
      </div>

      <p className="mt-2 max-w-[640px] text-xs text-[var(--color-fg-secondary)]">
        {reachable ? (
          <>
            <code>search_knowledge</code> queries Parchment and gets back whole
            sections with their hierarchy. The core playbooks below stay in this repo
            and are fetched with <code>read_knowledge_doc</code> — they are George&rsquo;s
            operating instructions, so they must work even when Parchment does not.
          </>
        ) : (
          <>
            George is falling back to its own supplemental docs for now. Core playbooks
            are unaffected. The reason is below — this panel reads Parchment live, so
            it reflects the state right now rather than a cached flag.
          </>
        )}
      </p>

      <div className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
        <Row label="Endpoint" value={<code className="text-[11px]">{cfg.base}</code>} />
        {reachable ? (
          <>
            <Row
              label="Database"
              value={
                health.ok && typeof health.data?.database === "string"
                  ? health.data.database
                  : "—"
              }
            />
            <Row label="Documents" value={docCount === null ? "—" : docCount} />
            {sectionCount !== null ? <Row label="Sections" value={sectionCount} /> : null}
          </>
        ) : (
          <Row
            label="Error"
            value={
              <span className="text-amber-600 dark:text-amber-400">
                {!health.ok ? health.error : "Unknown"}
              </span>
            }
          />
        )}
      </div>

      {reachable && docCount === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-fg-secondary)]">
          The workspace is connected but empty, so searches will return nothing. Ingest
          documents from the Parchment console, or upload them there.
        </p>
      ) : null}

      <a
        href={cfg.base.replace(/\/api$/, "")}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline"
      >
        Open Parchment console
        <ExternalLink className="size-3" />
      </a>
    </section>
  );
}
