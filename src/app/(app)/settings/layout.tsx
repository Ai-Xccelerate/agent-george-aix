import { getCurrentUser } from "@/lib/supabase/current-user";
import { SettingsNav } from "./_nav";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-4 py-5 sm:px-6 md:flex-row md:gap-8 md:px-8 md:py-7">
      <aside className="md:w-56 md:shrink-0">
        <h2 className="mb-3 px-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
          Settings
        </h2>
        <SettingsNav isAdmin={isAdmin} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
