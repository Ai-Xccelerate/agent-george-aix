import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { LogoUploadForm, OrgForm } from "./_org-form";
import {
  removeOrgLogoAction,
  updateOrganizationAction,
  uploadOrgLogoAction,
} from "./actions";

export const dynamic = "force-dynamic";

type BusinessHours = { start?: string | null; end?: string | null; days?: string[] };

export default async function OrganizationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  // Service-role read so we get all the new columns regardless of RLS — the
  // admin check above already gates this page.
  const admin = createSupabaseAdmin();
  const { data: org } = await admin
    .from("orgs")
    .select(
      "name, display_name, customer_brand_name, domain, tagline, brand_color, default_timezone, business_hours, logo_square_path, logo_wordmark_path",
    )
    .eq("id", user.orgId)
    .maybeSingle();

  const bh = (org?.business_hours as BusinessHours | null) ?? {};
  const squareUrl = publicUrl(admin, org?.logo_square_path);
  const wordmarkUrl = publicUrl(admin, org?.logo_wordmark_path);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Organization</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          Company profile and brand. George uses these in customer-facing copy.
        </p>
      </header>

      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            {squareUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={squareUrl}
                alt={org?.display_name ?? org?.name ?? user.orgName}
                className="h-10 w-10 rounded-lg object-contain"
              />
            ) : (
              <Building2 size={22} />
            )}
          </div>
          <div>
            <div className="text-[17px] font-semibold text-[var(--color-fg)]">
              {org?.display_name ?? org?.name ?? user.orgName}
            </div>
            <div className="text-[13px] text-[var(--color-fg-secondary)]">
              {org?.domain ?? "—"}
            </div>
            {org?.tagline && (
              <div className="text-[12px] text-[var(--color-fg-muted)]">{org.tagline}</div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">Profile</h2>
        <p className="mt-1 mb-4 text-[12px] text-[var(--color-fg-muted)]">
          Display + brand names can differ from the legal name. Timezone uses IANA
          (e.g. <code>America/Los_Angeles</code>).
        </p>
        <OrgForm
          action={updateOrganizationAction}
          defaults={{
            name: org?.name ?? "",
            display_name: org?.display_name ?? "",
            customer_brand_name: org?.customer_brand_name ?? "",
            domain: org?.domain ?? "",
            tagline: org?.tagline ?? "",
            brand_color: org?.brand_color ?? "",
            default_timezone: org?.default_timezone ?? "",
            bh_start: bh.start ?? "",
            bh_end: bh.end ?? "",
            bh_days: bh.days ?? [],
          }}
        />
      </section>

      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">Logos</h2>
        <p className="mt-1 mb-4 text-[12px] text-[var(--color-fg-muted)]">
          Square is used for avatars and favicons. Wordmark is used for headers
          and emails.
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <LogoSlot
            variant="square"
            currentUrl={squareUrl}
            hasCurrent={Boolean(org?.logo_square_path)}
          />
          <LogoSlot
            variant="wordmark"
            currentUrl={wordmarkUrl}
            hasCurrent={Boolean(org?.logo_wordmark_path)}
          />
        </div>
      </section>
    </div>
  );
}

function LogoSlot({
  variant,
  currentUrl,
  hasCurrent,
}: {
  variant: "square" | "wordmark";
  currentUrl: string | null;
  hasCurrent: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <LogoUploadForm
        action={uploadOrgLogoAction}
        variant={variant}
        currentUrl={currentUrl}
      />
      {hasCurrent && (
        <form action={removeOrgLogoAction}>
          <input type="hidden" name="variant" value={variant} />
          <button
            type="submit"
            className="text-[12px] font-medium text-[var(--color-fg-muted)] underline-offset-2 hover:text-[var(--color-error)] hover:underline"
          >
            Remove current
          </button>
        </form>
      )}
    </div>
  );
}

function publicUrl(
  admin: ReturnType<typeof createSupabaseAdmin>,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  return admin.storage.from("org-assets").getPublicUrl(path).data.publicUrl;
}
