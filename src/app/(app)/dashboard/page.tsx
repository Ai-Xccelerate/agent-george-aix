import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Clock,
  Sparkles,
  Users,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const admin = createSupabaseAdmin();
  const orgId = user.orgId;

  // All counts in parallel. We use head:true + count:'exact' so we only get
  // the integer back, not the rows.
  const [
    activePartners,
    activeEndCustomers,
    onboarding,
    atRisk,
    onboardingTotal,
    activeTotal,
    standingJobs,
  ] = await Promise.all([
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("customer_kind", "partner")
      .eq("lifecycle", "active"),
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("customer_kind", "end_customer")
      .eq("lifecycle", "active"),
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("lifecycle", "onboarding"),
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("lifecycle", "at_risk"),
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("lifecycle", "onboarding"),
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("lifecycle", "active"),
    admin
      .from("agent_jobs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("enabled", true),
  ]);

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <HeroCard
        firstName={user.fullName?.split(" ")[0] ?? null}
        onboardingCount={onboardingTotal.count ?? 0}
        activeCount={activeTotal.count ?? 0}
        standingJobsCount={standingJobs.count ?? 0}
      />

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Active channel partners"
          value={String(activePartners.count ?? 0)}
          icon={Building2}
          accent
          href="/customers"
        />
        <Kpi
          label="Active end customers"
          value={String(activeEndCustomers.count ?? 0)}
          icon={Users}
          tone="info"
          href="/customers"
        />
        <Kpi
          label="In onboarding"
          value={String(onboarding.count ?? 0)}
          icon={Activity}
          href="/customers"
        />
        <Kpi
          label="At risk"
          value={String(atRisk.count ?? 0)}
          icon={AlertTriangle}
          tone="warning"
          href="/customers"
        />
      </section>

      <section className="grid grid-cols-3 gap-4">
        <div className="col-span-2 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
              Today’s queue
            </h2>
            <Link
              href="/settings/jobs"
              className="text-[12px] font-medium text-[var(--color-accent)] hover:underline"
            >
              Manage standing jobs →
            </Link>
          </div>
          <EmptyState
            icon={Clock}
            title="No tasks scheduled yet"
            body="Configure a standing job (utilization sweep, cadence prep, inbox triage) and George will queue what he runs each day here."
          />
        </div>

        <div className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
              Recent activity
            </h2>
          </div>
          <EmptyState
            icon={Sparkles}
            title="Nothing yet"
            body="Drop a signed contract into chat and George will add the partner, contacts, and onboarding plan — all of that shows up here."
          />
        </div>
      </section>
    </div>
  );
}

function HeroCard({
  firstName,
  onboardingCount,
  activeCount,
  standingJobsCount,
}: {
  firstName: string | null;
  onboardingCount: number;
  activeCount: number;
  standingJobsCount: number;
}) {
  return (
    <div className="brand-gradient relative overflow-hidden rounded-[16px] p-6 px-7 text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)]">
      <div className="flex items-start justify-between gap-8">
        <div className="max-w-[560px] space-y-2">
          <h1 className="text-[20px] font-bold leading-tight">
            {firstName ? `Hey ${firstName} — ` : "Hey, "}I’m George, your customer
            success teammate.
          </h1>
          <p className="text-sm text-white/85">
            Drop a contract, forward an email, or just tell me what’s going on with a
            partner. I’ll handle onboarding, health, and the busywork.
          </p>
          <Link
            href="/chat"
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-white/95"
          >
            Talk to George
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <GlassStat label="Onboarding" value={String(onboardingCount)} />
          <GlassStat label="Active" value={String(activeCount)} />
          <GlassStat label="Standing jobs" value={String(standingJobsCount)} />
        </div>
      </div>
    </div>
  );
}

function GlassStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass min-w-[110px] rounded-md px-5 py-3 backdrop-blur">
      <div className="text-[22px] font-bold leading-none text-[var(--color-fg-inverse)]">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-white/70">{label}</div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  accent,
  href,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone?: "success" | "warning" | "info";
  accent?: boolean;
  href?: string;
}) {
  const toneClass =
    tone === "success"
      ? "bg-[var(--color-success-light)] text-[var(--color-success)]"
      : tone === "warning"
        ? "bg-[var(--color-badge-training-bg)] text-[var(--color-badge-training-fg)]"
        : tone === "info"
          ? "bg-[#E6F0FA] text-[var(--color-info)]"
          : accent
            ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
            : "bg-[var(--color-surface-2)] text-[var(--color-fg-secondary)]";

  const body = (
    <div className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-4 transition-colors hover:border-[var(--color-accent)]/30">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-fg-muted)]">{label}</span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-md ${toneClass}`}
        >
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-3 text-[22px] font-bold text-[var(--color-fg)]">{value}</div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border-subtle)] py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]">
        <Icon size={18} />
      </div>
      <div className="text-sm font-medium text-[var(--color-fg)]">{title}</div>
      <p className="max-w-[320px] text-xs text-[var(--color-fg-muted)]">{body}</p>
    </div>
  );
}
