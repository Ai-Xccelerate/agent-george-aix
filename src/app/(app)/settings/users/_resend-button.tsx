"use client";

import { useActionState } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { ActionResult } from "./actions";

export function ResendInviteButton({
  inviteId,
  action,
}: {
  inviteId: string;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="invite_id" value={inviteId} />
      {state.error && (
        <span className="max-w-[160px] truncate text-[11px] text-[var(--color-error)]" title={state.error}>
          {state.error}
        </span>
      )}
      <button
        type="submit"
        disabled={pending}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-50"
      >
        {state.info ? (
          <>
            <Check size={13} className="text-[var(--color-success)]" />
            Sent
          </>
        ) : (
          <>
            <RefreshCw size={13} className={pending ? "animate-spin" : ""} />
            {pending ? "Sending…" : "Resend"}
          </>
        )}
      </button>
    </form>
  );
}
