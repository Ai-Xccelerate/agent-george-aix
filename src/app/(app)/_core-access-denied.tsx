import type { CoreAccessOutcome } from "@/lib/aix-core/access";

/**
 * Shown when AIX Core denies (org not enabled / user not assigned) or is
 * unavailable. Mirrors the playbook's denied-access UX — one screen, with a
 * link back to the Core dashboard where an admin grants access.
 */
export function CoreAccessDenied({
  outcome,
}: {
  outcome: Extract<CoreAccessOutcome, { ok: false }>;
}) {
  const coreUrl = process.env.NEXT_PUBLIC_CORE_URL ?? "https://app-staging.aiworkforce.md";
  const unavailable = outcome.kind === "unavailable";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface)] px-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 className="text-2xl font-bold text-[var(--color-fg)]">
          {unavailable ? "George is unavailable" : "You don't have access to George"}
        </h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          {unavailable
            ? "We couldn't confirm your access with AIX Core right now. Please try again in a moment."
            : "Ask your org admin to grant you access to George from the AIX Core dashboard."}
        </p>
        {outcome.reason && (
          <p className="text-[12px] text-[var(--color-fg-muted)]">reason: {outcome.reason}</p>
        )}
        <a
          href={coreUrl}
          className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--color-accent)] px-6 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          Open AIX Core
        </a>
      </div>
    </div>
  );
}
