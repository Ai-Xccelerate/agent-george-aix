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
        <span className="text-[12px] text-[var(--color-fg-muted)]">{state.info}</span>
      )}
      {state.error && (
        <span className="text-[12px] text-[var(--color-error)]">{state.error}</span>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
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
