/**
 * Settings is entirely dynamic — the layout and every page call
 * getCurrentUser(), which verifies the Clerk session, hits AIX Core for the
 * entitlement check and mirrors tenant rows. Without a loading boundary the
 * router had nothing to show while that resolved, so clicking Settings looked
 * like nothing had happened until the server came back.
 *
 * This renders instantly on click and mirrors the settings layout, so the
 * transition reads as "loading" rather than "stuck".
 */
export default function SettingsLoading() {
  return (
    <div className="flex max-w-[1400px] animate-pulse flex-col gap-6 px-4 py-5 sm:px-6 md:flex-row md:gap-8 md:px-8 md:py-7">
      <aside className="md:w-56 md:shrink-0">
        <div className="mb-3 ml-3 h-3 w-16 rounded bg-gray-200 dark:bg-white/[0.06]" />
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-9 rounded-lg bg-gray-100 dark:bg-white/[0.04]"
            />
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="h-7 w-48 rounded bg-gray-200 dark:bg-white/[0.06]" />
        <div className="h-64 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      </div>
    </div>
  );
}
