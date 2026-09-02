import { redirect } from "next/navigation";
import { Globe2, Clock, CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { AddDomainForm } from "./_add-domain-form";
import { DomainRow, type DomainRequest } from "./_domain-row";

export const dynamic = "force-dynamic";

export default async function DomainAllowlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const isApprover = ["owner", "admin", "csm"].includes(user.role);
  if (!isApprover) redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const [pendingRes, decidedRes] = await Promise.all([
    admin
      .from("domain_allowlist")
      .select("id, domain, reason, status, created_at")
      .eq("org_id", user.orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    admin
      .from("domain_allowlist")
      .select("id, domain, reason, status, decision_note, decided_at, created_at")
      .eq("org_id", user.orgId)
      .in("status", ["approved", "rejected"])
      .order("decided_at", { ascending: false })
      .limit(30),
  ]);

  const pending = (pendingRes.data ?? []) as DomainRequest[];
  const decided = (decidedRes.data ?? []) as DomainRequest[];
  const approved = decided.filter((d) => d.status === "approved");
  const revoked = decided.filter((d) => d.status === "rejected");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Email domains</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          George only ever sends externally to <code>@getonyx.ai</code> by
          default. Approve a domain here to let him draft-and-send to any
          address on it too — the same draft-then-confirm flow, just no
          longer blocked at send time. George can also request a domain
          himself when a customer conversation needs it; it lands here as
          pending either way.
        </p>
      </header>

      <div className="flex gap-3">
        <Stat icon={Clock} label="Pending" value={pending.length} />
        <Stat icon={CheckCircle2} label="Approved domains" value={approved.length} />
      </div>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Add a domain</h2>
        <p className="mt-1 mb-3 text-theme-xs text-gray-400 dark:text-gray-500">
          Goes in as pending — an owner, admin, or CSM (including you) still
          has to approve it below before George can use it.
        </p>
        <AddDomainForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Pending approval</h2>
        {pending.length === 0 ? (
          <EmptyState text="Nothing waiting. Requests George raises from a chat or an approaching send will show up here." />
        ) : (
          pending.map((d) => <DomainRow key={d.id} d={d} mode="decide" />)
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Approved</h2>
        {approved.length === 0 ? (
          <EmptyState text="No external domains are approved yet — George can only reach @getonyx.ai." />
        ) : (
          approved.map((d) => <DomainRow key={d.id} d={d} mode="revoke" />)
        )}
      </section>

      {/*
        Revoked domains were listed here as a grey pill and nothing else —
        visible but inert. Combined with revoke writing `rejected` and no
        transition back, undoing a revocation was impossible from the UI.

        That makes the guard expensive to use: if revoking might be permanent,
        the safe-feeling choice is to leave a domain approved, and an allowlist
        nobody prunes only grows. Re-approval is the same privilege as approval
        and audited the same way.
      */}
      {revoked.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Revoked</h2>
          <p className="text-theme-xs text-gray-400 dark:text-gray-500">
            George cannot email these. Re-approve to put one back.
          </p>
          {revoked.map((d) => (
            <DomainRow key={d.id} d={d} mode="reapprove" />
          ))}
        </section>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <Icon size={16} />
      </div>
      <div>
        <div className="text-lg font-bold leading-none text-gray-800 dark:text-white/90">{value}</div>
        <div className="mt-0.5 text-theme-xs text-gray-400 dark:text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-10 text-center">
      <Globe2 size={20} className="text-gray-400 dark:text-gray-500" />
      <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  );
}
