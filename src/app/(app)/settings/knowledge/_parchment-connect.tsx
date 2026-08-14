"use client";

/**
 * Workspace selection and the knowledge-grounding escape hatch.
 *
 * Deliberately NOT a connect form and NOT an enable toggle. Parchment's internal
 * agent path is default-allow — an org's workspace exists as soon as anything
 * asks for it — so a control framed as "enable Parchment" would gate something
 * that isn't gated, and a form asking for an API key would ask for something
 * nobody needs to produce. Parchment's own integration guide says as much.
 *
 * For the common single-workspace org this renders as one quiet line, not an
 * interactive control. It only becomes a real choice for an org that created
 * more workspaces in the Parchment dashboard.
 */
import { useActionState, useState, useTransition } from "react";
import { Loader2, PowerOff, RotateCcw } from "lucide-react";
import {
  selectWorkspaceAction,
  setParchmentEnabledAction,
  type ActionState,
} from "./parchment-actions";
import type { ParchmentWorkspace } from "@/lib/parchment/client";

function Message({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="rounded-lg bg-error-50 px-3 py-2 text-xs text-error-600 dark:bg-error-500/10 dark:text-error-400">
        {state.error}
      </p>
    );
  }
  if (state.info) {
    return (
      <p className="rounded-lg bg-success-50 px-3 py-2 text-xs text-success-600 dark:bg-success-500/10 dark:text-success-400">
        {state.info}
      </p>
    );
  }
  return null;
}

export function WorkspacePicker({
  workspaces,
  selectedWorkspaceId,
  defaultWorkspaceId,
}: {
  workspaces: ParchmentWorkspace[];
  selectedWorkspaceId: string | null;
  defaultWorkspaceId: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    selectWorkspaceAction,
    {},
  );

  const defaultName =
    workspaces.find((w) => w.id === defaultWorkspaceId)?.name ?? "General";

  // One workspace is the overwhelmingly common case. Showing a dropdown with a
  // single option would imply a decision that does not exist.
  if (workspaces.length <= 1) {
    return (
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Knowledge base:{" "}
        <span className="font-medium text-gray-800 dark:text-white/90">{defaultName}</span>
        <span className="text-gray-400 dark:text-gray-500">
          {" "}
          — your organisation&rsquo;s default. Create more in Parchment to choose between them.
        </span>
      </p>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Knowledge base
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            name="workspace_id"
            defaultValue={selectedWorkspaceId ?? ""}
            className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-white/[0.03] dark:text-white/90 dark:focus:border-brand-400"
          >
            <option value="">Organisation default ({defaultName})</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.visibility && w.visibility !== "org" ? ` (${w.visibility})` : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 disabled:opacity-60"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            Save
          </button>
        </div>
      </label>
      <Message state={state} />
    </form>
  );
}

/**
 * The opt-out. Present because a team may want to stop grounding George in
 * organisational knowledge entirely; absent as an "enable" control because there
 * is nothing to enable.
 */
export function GroundingSwitch({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [confirming, setConfirming] = useState(false);

  if (enabled) {
    return (
      <div className="mt-3 space-y-2">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Stop using your knowledge base for George&rsquo;s answers?
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setState(await setParchmentEnabledAction(false));
                  setConfirming(false);
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-error-500 px-2.5 text-xs font-medium text-white hover:bg-error-600 disabled:opacity-60"
            >
              {pending ? <Loader2 size={12} className="animate-spin" /> : <PowerOff size={12} />}
              Turn off
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-xs text-gray-500 underline dark:text-gray-400"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
          >
            <PowerOff size={12} />
            Turn off knowledge grounding
          </button>
        )}
        <Message state={state} />
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await setParchmentEnabledAction(true)))}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 disabled:opacity-60"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
        Turn knowledge grounding back on
      </button>
      <Message state={state} />
    </div>
  );
}
