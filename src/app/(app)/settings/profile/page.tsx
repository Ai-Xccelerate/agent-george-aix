import { getCurrentUser } from "@/lib/supabase/current-user";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/utils";
import { ProfileForm } from "./_profile-form";
import { updateProfileAction } from "./actions";

export const dynamic = "force-dynamic";

function splitName(full: string | null | undefined): { first: string; last: string } {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { first, last } = splitName(user.fullName);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Your profile</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          Update your name, timezone, and locale. Your password and email are
          managed in AIX Core.
        </p>
      </header>

      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent)] text-[16px] font-semibold text-[var(--color-fg-inverse)]">
            {initials(user.fullName ?? user.email ?? "?")}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[17px] font-semibold text-[var(--color-fg)]">
                {user.fullName ?? "—"}
              </span>
              <Badge tone={user.role === "owner" ? "accent" : "info"}>{user.role}</Badge>
            </div>
            <div className="text-[13px] text-[var(--color-fg-secondary)]">{user.email}</div>
            <div className="text-[12px] text-[var(--color-fg-muted)]">{user.orgName}</div>
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">Details</h2>
        <p className="mt-1 mb-4 text-[12px] text-[var(--color-fg-muted)]">
          Timezone uses IANA names (e.g. <code>America/Los_Angeles</code>). Locale is a BCP
          47 tag (e.g. <code>en-US</code>).
        </p>
        <ProfileForm
          action={updateProfileAction}
          defaults={{
            firstName: first,
            lastName: last,
            email: user.email ?? "",
            timezone: user.timezone ?? "",
            locale: user.locale ?? "",
          }}
        />
      </section>
    </div>
  );
}
