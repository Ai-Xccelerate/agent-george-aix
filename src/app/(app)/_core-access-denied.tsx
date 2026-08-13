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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white/90">
          {unavailable ? "George is unavailable" : "You don't have access to George"}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {unavailable
            ? "We couldn't confirm your access with AIX Core right now. Please try again in a moment."
            : "Ask your org admin to grant you access to George from the AIX Core dashboard."}
        </p>
        {outcome.reason && (
          <p className="text-theme-xs text-gray-400 dark:text-gray-500">reason: {outcome.reason}</p>
        )}
        <a
          href={coreUrl}
          className="h-11 px-6 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
        >
          Open AIX Core
        </a>
      </div>
    </div>
  );
}
