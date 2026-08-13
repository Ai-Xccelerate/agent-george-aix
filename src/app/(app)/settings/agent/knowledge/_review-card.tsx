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
      className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4"
    >
      <input type="hidden" name="proposal_id" value={p.id} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-gray-800 dark:text-white/90">
              {p.title ?? p.path}
            </span>
            <Pill>{p.kind === "update" ? "edit" : "new"}</Pill>
            {p.concept_type && <Pill>{p.concept_type}</Pill>}
            <Pill>from {p.source}</Pill>
          </div>
          <div className="mt-0.5 font-mono text-theme-xs text-gray-400 dark:text-gray-500">
            {p.path}
          </div>
        </div>
      </div>

      {p.description && (
        <p className="mt-2 text-theme-sm text-gray-500 dark:text-gray-400">{p.description}</p>
      )}

      {p.rationale && (
        <p className="mt-2 text-theme-xs text-gray-400 dark:text-gray-500">
          <span className="font-medium text-gray-500 dark:text-gray-400">Why George proposed it: </span>
          {p.rationale}
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-theme-xs font-medium text-brand-500 dark:text-brand-400">
          Preview content
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 dark:bg-gray-900 p-3 text-theme-xs text-gray-500 dark:text-gray-400">
          {p.content_md}
        </pre>
      </details>

      {((p.tags?.length ?? 0) > 0 || (p.links?.length ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.tags?.map((t) => (
            <span key={t} className="text-theme-xs text-gray-400 dark:text-gray-500">#{t}</span>
          ))}
          {p.links?.map((l) => (
            <span key={l} className="font-mono text-theme-xs text-gray-400 dark:text-gray-500">→ {l}</span>
          ))}
        </div>
      )}

      <input
        name="note"
        placeholder="Optional review note…"
        className="mt-3 h-9 w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-theme-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400"
      />

      {state.error && (
        <div className="mt-2 rounded-md border border-error-500/30 bg-error-500/10 px-3 py-1.5 text-theme-xs text-error-500">
          {state.error}
        </div>
      )}
      {state.info && (
        <div className="mt-2 rounded-md border border-success-500/30 bg-success-50 dark:bg-success-500/15 px-3 py-1.5 text-theme-xs text-success-500">
          {state.info}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60"
        >
          <Check size={14} /> Approve & publish
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm font-medium text-gray-800 dark:text-white/90 hover:border-error-500 hover:text-error-500 disabled:opacity-60"
        >
          <X size={14} /> Reject
        </button>
      </div>
    </form>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-gray-50 dark:bg-white/[0.03] px-2 py-0.5 text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
      {children}
    </span>
  );
}
