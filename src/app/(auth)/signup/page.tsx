import Link from "next/link";
import { Mail } from "lucide-react";
import { SignUpForm } from "./_signup-form";

export default function SignUpPage() {
  const openSignup = process.env.NEXT_PUBLIC_OPEN_SIGNUP === "true";

  if (openSignup) {
    return (
      <div className="space-y-7">
        <div className="space-y-2">
          <h1 className="text-[28px] font-bold text-[var(--color-fg)]">Create account</h1>
          <p className="text-sm text-[var(--color-fg-secondary)]">
            Sign up with any email to try AIX George locally.
          </p>
        </div>
        <SignUpForm />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <Mail size={18} />
        </div>
        <h1 className="text-[28px] font-bold text-[var(--color-fg)]">Invite-only</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          AIX George is invite-only. Ask your admin to send an invite to your
          work email — you&apos;ll get a sign-in link in your inbox.
        </p>
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-4 text-[13px] text-[var(--color-fg-secondary)]">
        Only emails from approved org domains can sign in. If you think this is
        a mistake, contact your admin.
      </div>

      <Link
        href="/signin"
        className="inline-flex h-11 w-full items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
      >
        Back to sign in
      </Link>
    </div>
  );
}
