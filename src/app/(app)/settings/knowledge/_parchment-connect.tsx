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
  "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] focus:border-[var(--color-accent)] focus:outline-none";

export function ParchmentConnectForm({ defaultBaseUrl }: { defaultBaseUrl?: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    connectParchmentAction,
    {},
  );

  return (
    <form action={action} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-fg-secondary)]">
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
          <span className="mb-1 block text-xs font-medium text-[var(--color-fg-secondary)]">
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

      <p className="text-xs text-[var(--color-fg-secondary)]">
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
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
        {pending ? "Testing connection…" : "Connect"}
      </button>
      <span className="ml-2 text-xs text-[var(--color-fg-muted)]">
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
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-2.5 text-xs font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Test again
        </button>

        {confirming ? (
          <>
            <span className="text-xs text-[var(--color-fg-secondary)]">
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
              className="text-xs text-[var(--color-fg-secondary)] underline"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]"
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
