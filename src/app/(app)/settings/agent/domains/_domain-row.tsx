"use client";

import { useActionState } from "react";
import { Check, X, Ban } from "lucide-react";
import { decideDomainAction, revokeDomainAction, type ActionResult } from "./actions";

export type DomainRequest = {
  id: string;
  domain: string;
  reason: string | null;
  status: string;
  decision_note?: string | null;
  decided_at?: string | null;
  created_at: string;
};

export function DomainRow({ d, mode }: { d: DomainRequest; mode: "decide" | "revoke" }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    decideDomainAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-4"
    >
      <input type="hidden" name="domain_id" value={d.id} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[14px] font-semibold text-[var(--color-fg)]">
            {d.domain}
          </div>
          {d.reason && (
            <p className="mt-1 text-[12px] text-[var(--color-fg-secondary)]">{d.reason}</p>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-[var(--color-fg-muted)]">
          {new Date(d.created_at).toLocaleDateString()}
        </span>
      </div>

      {mode === "decide" && (
        <>
          <input
            name="note"
            placeholder="Optional note…"
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
              value="approved"
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
            >
              <Check size={14} /> Approve
            </button>
            <button
              type="submit"
              name="decision"
              value="rejected"
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-60"
            >
              <X size={14} /> Reject
            </button>
          </div>
        </>
      )}

      {mode === "revoke" && (
        <div className="mt-3">
          <button
            type="submit"
            formAction={revokeDomainAction}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
          >
            <Ban size={14} /> Revoke access
          </button>
        </div>
      )}
    </form>
  );
}
