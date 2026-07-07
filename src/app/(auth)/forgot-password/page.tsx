"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type AuthResult } from "../actions";
import { AuthField, AuthInput, PrimaryButton, GhostLink } from "../_components/auth-input";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<AuthResult, FormData>(
    requestPasswordResetAction,
    {},
  );

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-[28px] font-bold text-[var(--color-fg)]">Reset your password</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          Enter your work email and we&apos;ll send you a link to set a new password.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <AuthField label="Work email">
          <AuthInput
            type="email"
            name="email"
            placeholder="you@aixccelerate.com"
            autoComplete="email"
            required
          />
        </AuthField>

        {state.error && <Alert tone="error">{state.error}</Alert>}
        {state.info && <Alert tone="info">{state.info}</Alert>}

        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </PrimaryButton>
      </form>

      <p className="text-center text-[12px] text-[var(--color-fg-muted)]">
        <GhostLink href="/signin">Back to sign in</GhostLink>
      </p>
    </div>
  );
}

function Alert({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  const className =
    tone === "error"
      ? "border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-[var(--color-error)]"
      : "border-[var(--color-info)]/30 bg-[var(--color-info)]/10 text-[var(--color-info)]";
  return (
    <div className={`rounded-md border px-3 py-2 text-[12px] ${className}`}>{children}</div>
  );
}
