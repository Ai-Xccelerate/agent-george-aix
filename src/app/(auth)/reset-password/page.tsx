"use client";

import { useActionState } from "react";
import { updatePasswordAction, type AuthResult } from "../actions";
import { AuthField, AuthInput, PrimaryButton } from "../_components/auth-input";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState<AuthResult, FormData>(
    updatePasswordAction,
    {},
  );

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-[28px] font-bold text-[var(--color-fg)]">Set a new password</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          Choose a new password for your account.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <AuthField label="New password" hint="At least 8 characters.">
          <AuthInput
            type="password"
            name="password"
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </AuthField>

        <AuthField label="Confirm new password">
          <AuthInput
            type="password"
            name="confirm"
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </AuthField>

        {state.error && <Alert tone="error">{state.error}</Alert>}

        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Saving…" : "Set new password"}
        </PrimaryButton>
      </form>
    </div>
  );
}

function Alert({ tone, children }: { tone: "error"; children: React.ReactNode }) {
  const className =
    "border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-[var(--color-error)]";
  void tone;
  return (
    <div className={`rounded-md border px-3 py-2 text-[12px] ${className}`}>{children}</div>
  );
}
