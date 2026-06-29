"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { reviewProposalAction, type ActionResult } from "./actions";

export type Proposal = {
  id: string;
  path: string;
  kind: string;
  concept_type: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  links: string[] | null;
  content_md: string;
  source: string;
  rationale: string | null;
  created_at: string;
};

export function ReviewCard({ p }: { p: Proposal }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    reviewProposalAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-4"
    >
      <input type="hidden" name="proposal_id" value={p.id} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-[var(--color-fg)]">
              {p.title ?? p.path}
            </span>
            <Pill>{p.kind === "update" ? "edit" : "new"}</Pill>
            {p.concept_type && <Pill>{p.concept_type}</Pill>}
            <Pill>from {p.source}</Pill>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
            {p.path}
          </div>
        </div>
      </div>

      {p.description && (
        <p className="mt-2 text-[13px] text-[var(--color-fg-secondary)]">{p.description}</p>
      )}

      {p.rationale && (
        <p className="mt-2 text-[12px] text-[var(--color-fg-muted)]">
          <span className="font-medium text-[var(--color-fg-secondary)]">Why George proposed it: </span>
          {p.rationale}
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] font-medium text-[var(--color-accent)]">
          Preview content
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--color-surface)] p-3 text-[12px] text-[var(--color-fg-secondary)]">
          {p.content_md}
        </pre>
      </details>

      {((p.tags?.length ?? 0) > 0 || (p.links?.length ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.tags?.map((t) => (
            <span key={t} className="text-[11px] text-[var(--color-fg-muted)]">#{t}</span>
          ))}
          {p.links?.map((l) => (
            <span key={l} className="font-mono text-[11px] text-[var(--color-fg-muted)]">→ {l}</span>
          ))}
        </div>
      )}

      <input
        name="note"
        placeholder="Optional review note…"
        className="mt-3 h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-[13px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
      />

      {state.error && (
        <div className="mt-2 rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-1.5 text-[12px] text-[var(--color-error)]">
          {state.error}
        </div>
      )}
      {state.info && (
        <div className="mt-2 rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success-light)] px-3 py-1.5 text-[12px] text-[var(--color-success)]">
          {state.info}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          <Check size={14} /> Approve & publish
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-60"
        >
          <X size={14} /> Reject
        </button>
      </div>
    </form>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
      {children}
    </span>
  );
}
