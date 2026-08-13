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
      className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4"
    >
      <input type="hidden" name="domain_id" value={d.id} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            {d.domain}
          </div>
          {d.reason && (
            <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{d.reason}</p>
          )}
        </div>
        <span className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500">
          {new Date(d.created_at).toLocaleDateString()}
        </span>
      </div>

      {mode === "decide" && (
        <>
          <input
            name="note"
            placeholder="Optional note…"
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
              value="approved"
              disabled={pending}
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60"
            >
              <Check size={14} /> Approve
            </button>
            <button
              type="submit"
              name="decision"
              value="rejected"
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm font-medium text-gray-800 dark:text-white/90 hover:border-error-500 hover:text-error-500 disabled:opacity-60"
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
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm font-medium text-gray-800 dark:text-white/90 hover:border-error-500 hover:text-error-500"
          >
            <Ban size={14} /> Revoke access
          </button>
        </div>
      )}
    </form>
  );
}
