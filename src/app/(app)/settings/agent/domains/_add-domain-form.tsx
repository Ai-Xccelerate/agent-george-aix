"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { proposeDomainAction, type ActionResult } from "./actions";

export function AddDomainForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    proposeDomainAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="domain"
          placeholder="acmecorp.com"
          required
          className="h-10 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
        <input
          name="reason"
          placeholder="Why George needs this (optional)"
          className="h-10 flex-[2] rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {state.error && (
        <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-1.5 text-[12px] text-[var(--color-error)]">
          {state.error}
        </div>
      )}
      {state.info && (
        <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success-light)] px-3 py-1.5 text-[12px] text-[var(--color-success)]">
          {state.info}
        </div>
      )}
    </form>
  );
}
