"use client";

import { useActionState } from "react";
import type { ActionResult } from "./actions";

type ServerAction = (state: ActionResult, formData: FormData) => Promise<ActionResult>;

type Props = {
  action: ServerAction;
  defaults: {
    firstName: string;
    lastName: string;
    email: string;
    timezone: string;
    locale: string;
  };
};

export function ProfileForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <input
            name="first_name"
            required
            defaultValue={defaults.firstName}
            className={inputClass}
          />
        </Field>
        <Field label="Last name">
          <input
            name="last_name"
            required
            defaultValue={defaults.lastName}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Email">
        <input
          type="email"
          value={defaults.email}
          readOnly
          disabled
          className={`${inputClass} cursor-not-allowed opacity-70`}
        />
        <span className="mt-1 block text-theme-xs text-gray-400 dark:text-gray-500">
          Changing your email requires an admin to send a fresh invite.
        </span>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Timezone">
          <input
            name="timezone"
            defaultValue={defaults.timezone}
            placeholder="America/Los_Angeles"
            className={inputClass}
          />
        </Field>
        <Field label="Locale">
          <input
            name="locale"
            defaultValue={defaults.locale}
            placeholder="en-US"
            className={inputClass}
          />
        </Field>
      </div>

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

export function PasswordForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3" key={state.info ?? "pw"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New password">
          <input
            type="password"
            name="new_password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <Field label="Confirm password">
          <input
            type="password"
            name="confirm_password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
      </div>

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

function Status({ state }: { state: ActionResult }) {
  if (state.error) {
    return (
      <div className="rounded-md border border-error-500/30 bg-error-500/10 px-3 py-2 text-theme-xs text-error-500">
        {state.error}
      </div>
    );
  }
  if (state.info) {
    return (
      <div className="rounded-md border border-success-500/30 bg-success-50 dark:bg-success-500/15 px-3 py-2 text-theme-xs text-success-500">
        {state.info}
      </div>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-theme-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400";

const submitClass =
  "h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60";
