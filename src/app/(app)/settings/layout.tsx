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
    <div className="mx-auto flex max-w-[1180px] gap-8 px-8 py-7">
      <aside className="w-56 shrink-0">
        <h2 className="mb-3 px-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
          Settings
        </h2>
        <SettingsNav isAdmin={isAdmin} />
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
