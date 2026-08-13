"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { syncTranscriptsNowAction, type SyncState } from "./actions";

export function SyncButton() {
  const [state, action, pending] = useActionState<SyncState, FormData>(
    syncTranscriptsNowAction,
    {},
  );

  return (
    <form action={action} className="flex items-center gap-3">
      {state.info && (
        <span className="text-theme-xs text-gray-400 dark:text-gray-500">{state.info}</span>
      )}
      {state.error && (
        <span className="text-theme-xs text-error-500">{state.error}</span>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCw size={14} />
        )}
        Sync now
      </button>
    </form>
  );
}
