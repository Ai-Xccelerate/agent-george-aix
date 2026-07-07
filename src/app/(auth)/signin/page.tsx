"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInAction, magicLinkAction, type AuthResult } from "../actions";
import { AuthField, AuthInput, PrimaryButton, GhostLink } from "../_components/auth-input";

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}

function SignInInner() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const urlError = params.get("error");
  const urlErrorMessage =
    urlError === "domain_blocked"
      ? "Your email isn't on an authorized domain. AIX George only allows getonyx.ai and aixccelerate.com."
      : urlError === "no_invite"
        ? "Your account isn't linked to an org yet. Ask an admin to invite you."
        : urlError?.toLowerCase().includes("code verifier")
          ? "This link was opened in a different browser than the one you requested it from — email apps often do this automatically. Go back to where you clicked \"Send magic link\" (or the invite email) and open the link there instead, or request a new one and open it in the same browser or tab."
          : urlError
            ? `Sign-in failed: ${urlError}`
            : null;
  const [pwState, pwAction, pwPending] = useActionState<AuthResult, FormData>(
    signInAction,
    {},
  );
  const [linkState, linkAction, linkPending] = useActionState<AuthResult, FormData>(
    magicLinkAction,
    {},
  );

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-[28px] font-bold text-[var(--color-fg)]">Welcome back</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          Sign in to talk to George and keep your customers moving.
        </p>
      </div>

      {urlErrorMessage && <Alert tone="error">{urlErrorMessage}</Alert>}

      <form action={pwAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />

        <AuthField label="Work email">
          <AuthInput
            type="email"
            name="email"
            placeholder="you@aixccelerate.com"
            autoComplete="email"
            required
          />
        </AuthField>

        <AuthField label="Password">
          <AuthInput
            type="password"
            name="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </AuthField>

        <div className="flex justify-end">
          <GhostLink href="/forgot-password">Forgot password?</GhostLink>
        </div>

        {pwState.error && <Alert tone="error">{pwState.error}</Alert>}

        <PrimaryButton type="submit" disabled={pwPending}>
          {pwPending ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </form>

      <Divider label="or" />

      <form action={linkAction} className="space-y-3">
        <AuthField label="Email me a magic link">
          <AuthInput
            type="email"
            name="email"
            placeholder="you@aixccelerate.com"
            autoComplete="email"
            required
          />
        </AuthField>
        {linkState.error && <Alert tone="error">{linkState.error}</Alert>}
        {linkState.info && <Alert tone="info">{linkState.info}</Alert>}
        <button
          type="submit"
          disabled={linkPending}
          className="h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
        >
          {linkPending ? "Sending…" : "Send magic link"}
        </button>
      </form>

      <p className="text-center text-[12px] text-[var(--color-fg-muted)]">
        {process.env.NEXT_PUBLIC_OPEN_SIGNUP === "true" ? (
          <>
            No account yet?{" "}
            <GhostLink href="/signup">Create one</GhostLink>
          </>
        ) : (
          <>Access is invite-only. Need an account? Ask your admin to invite you.</>
        )}
      </p>
    </div>
  );
}

function Alert({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
}) {
  const className =
    tone === "error"
      ? "border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-[var(--color-error)]"
      : "border-[var(--color-info)]/30 bg-[var(--color-info)]/10 text-[var(--color-info)]";
  return (
    <div className={`rounded-md border px-3 py-2 text-[12px] ${className}`}>
      {children}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="text-[13px] text-[var(--color-fg-muted)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}
