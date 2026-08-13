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
          className="h-10 flex-1 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400"
        />
        <input
          name="reason"
          placeholder="Why George needs this (optional)"
          className="h-10 flex-[2] rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 shrink-0 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60"
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {state.error && (
        <div className="rounded-md border border-error-500/30 bg-error-500/10 px-3 py-1.5 text-theme-xs text-error-500">
          {state.error}
        </div>
      )}
      {state.info && (
        <div className="rounded-md border border-success-500/30 bg-success-50 dark:bg-success-500/15 px-3 py-1.5 text-theme-xs text-success-500">
          {state.info}
        </div>
      )}
    </form>
  );
}
