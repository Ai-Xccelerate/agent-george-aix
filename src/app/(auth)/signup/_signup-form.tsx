"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type AuthResult } from "../actions";
import { AuthField, AuthInput, PrimaryButton } from "../_components/auth-input";

export function SignUpForm() {
  const [state, action, pending] = useActionState<AuthResult, FormData>(signUpAction, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value="/dashboard" />

      <AuthField label="Email">
        <AuthInput
          type="email"
          name="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </AuthField>

      <AuthField label="Password">
        <AuthInput
          type="password"
          name="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </AuthField>

      {state.error && (
        <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[12px] text-[var(--color-error)]">
          {state.error}
        </div>
      )}

      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </PrimaryButton>

      <p className="text-center text-[12px] text-[var(--color-fg-muted)]">
        Already have an account?{" "}
        <Link href="/signin" className="text-[var(--color-accent)] hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
