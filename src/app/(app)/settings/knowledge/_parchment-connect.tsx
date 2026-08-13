"use client";

/**
 * The connect / disconnect controls for an org's Parchment knowledge hub.
 *
 * Client component because it owns form state and pending transitions. The API
 * key is a password field, is never rendered back, and only ever travels to the
 * server action — the page shows a fingerprint instead.
 *
 * Copy is written for the person doing this: an admin who has a Parchment
 * console open in another tab, not an engineer reading a config reference.
 */
import { useActionState, useState, useTransition } from "react";
import { Loader2, Plug, RefreshCw, Unplug } from "lucide-react";
import {
  connectParchmentAction,
  disconnectParchmentAction,
  recheckParchmentAction,
  type ActionState,
} from "./parchment-actions";

const inputClass =
  "h-9 w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm text-gray-800 dark:text-white/90 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none";

export function ParchmentConnectForm({ defaultBaseUrl }: { defaultBaseUrl?: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    connectParchmentAction,
    {},
  );

  return (
    <form action={action} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Parchment API URL
          </span>
          <input
            name="base_url"
            type="url"
            required
            defaultValue={defaultBaseUrl ?? ""}
            placeholder="https://your-parchment-api.example.com"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Agent API key
          </span>
          <input
            name="api_key"
            type="password"
            required
            autoComplete="off"
            placeholder="pcm_…"
            className={inputClass}
          />
        </label>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Create the key in your Parchment console under <strong>Connect</strong> (or{" "}
        <strong>Keys</strong>) with the <strong>agent</strong> role — that is enough for
        George to read. Choose <strong>editor</strong> instead if you also want approved
        knowledge from George pushed back into the hub. The key is stored encrypted and
        never shown again.
      </p>

      {state.error ? (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.info ? (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          {state.info}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
        {pending ? "Testing connection…" : "Connect"}
      </button>
      <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
        The credentials are tested before they are saved.
      </span>
    </form>
  );
}

export function ParchmentManageButtons() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setResult(await recheckParchmentAction()))}
          className="h-9 px-3 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90 disabled:opacity-60"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Test again
        </button>

        {confirming ? (
          <>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Disconnect and delete the stored key?
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setResult(await disconnectParchmentAction());
                  setConfirming(false);
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Unplug size={12} />
              Yes, disconnect
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-xs text-gray-500 dark:text-gray-400 underline"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 px-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
          >
            <Unplug size={12} />
            Disconnect
          </button>
        )}
      </div>

      {result.error ? (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
      {result.info ? (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          {result.info}
        </p>
      ) : null}
    </div>
  );
}
