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
        <span className="mt-1 block text-[11px] text-[var(--color-fg-muted)]">
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
      <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[12px] text-[var(--color-error)]">
        {state.error}
      </div>
    );
  }
  if (state.info) {
    return (
      <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success-light)] px-3 py-2 text-[12px] text-[var(--color-success)]">
        {state.info}
      </div>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--color-fg-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]";

const submitClass =
  "inline-flex h-10 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60";
