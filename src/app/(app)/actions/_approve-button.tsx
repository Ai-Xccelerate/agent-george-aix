"use client";

/**
 * Approve and send.
 *
 * The label says what happens. "Approve" alone leaves a reviewer guessing
 * whether they have queued something or dispatched it, and the difference
 * matters at the exact moment they are deciding.
 */
import { useActionState } from "react";
import { Loader2, Send } from "lucide-react";
import { approveAndSendAction, type ApproveResult } from "./approve";

export function ApproveAndSendButton({
  escalationId,
  recipients,
}: {
  escalationId: string;
  recipients: string[];
}) {
  const [state, action, pending] = useActionState<ApproveResult | null, FormData>(
    approveAndSendAction,
    null,
  );

  return (
    <div className="w-full">
      <form action={action} className="inline-flex">
        <input type="hidden" name="escalation_id" value={escalationId} />
        <button
          type="submit"
          disabled={pending || state?.ok === true}
          className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-semibold text-white shadow-theme-xs transition hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {pending ? "Sending…" : state?.ok ? "Sent" : "Approve and send"}
        </button>
      </form>

      {/*
        A refusal is the interesting outcome — the guards exist precisely for
        this moment — so it is shown here rather than logged. The decision stays
        open when a send is refused; a refused send is not a handled decision.
      */}
      {state && !state.ok && (
        <p className="mt-2 rounded-lg bg-error-50 dark:bg-error-500/10 p-3 text-theme-xs text-gray-600 dark:text-gray-300">
          {state.message}
        </p>
      )}
      {state?.ok && (
        <p className="mt-2 rounded-lg bg-success-50 dark:bg-success-500/10 p-3 text-theme-xs text-gray-600 dark:text-gray-300">
          {state.message}
        </p>
      )}
      {!state && recipients.length > 0 && (
        <p className="mt-2 text-theme-xs text-gray-400 dark:text-gray-500">
          Sends this exact draft to {recipients.join(", ")} — nothing is re-composed.
        </p>
      )}
    </div>
  );
}
