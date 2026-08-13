import { Users } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { NewPartnerButton } from "./_partner-form";
import { PartnersView, type PartnerRow } from "./_partners-view";

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: string;
  name: string;
  domain: string | null;
  lifecycle: string;
  customer_kind: "partner" | "end_customer";
  parent_customer_id: string | null;
  industry: string | null;
  updated_at: string;
};

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // Service-role client (auth/entitlement enforced by getCurrentUser); scope
  // every read to the caller's org explicitly since RLS no longer applies.
  const supabase = createSupabaseAdmin();
  const { data: customers } = await supabase
    .from("customers")
    .select(
      "id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, updated_at",
    )
    .eq("org_id", user.orgId)
    .order("updated_at", { ascending: false })
    .limit(300);

  const rows = (customers ?? []) as CustomerRow[];
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const ids = rows.map((r) => r.id);

  // Latest health + open objectives in two bulk queries (no N+1).
  const [healthRes, objRes] = await Promise.all([
    ids.length
      ? supabase
          .from("customer_health")
          .select("customer_id, band, score, measured_at")
          .in("customer_id", ids)
          .order("measured_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("objectives")
          .select("customer_id, title, status, due_date, next_followup_at")
          .in("customer_id", ids)
          .in("status", ["pending", "awaiting", "blocked"])
      : Promise.resolve({ data: [] }),
  ]);

  const latestHealth = new Map<string, { band: string; score: number | null }>();
  for (const h of (healthRes.data ?? []) as Array<{
    customer_id: string;
    band: string;
    score: number | null;
  }>) {
    if (!latestHealth.has(h.customer_id)) {
      latestHealth.set(h.customer_id, { band: h.band, score: h.score });
    }
  }

  const objByCustomer = new Map<
    string,
    Array<{ title: string; due_date: string | null; next_followup_at: string | null }>
  >();
  for (const o of (objRes.data ?? []) as Array<{
    customer_id: string;
    title: string;
    due_date: string | null;
    next_followup_at: string | null;
  }>) {
    const arr = objByCustomer.get(o.customer_id) ?? [];
    arr.push({ title: o.title, due_date: o.due_date, next_followup_at: o.next_followup_at });
    objByCustomer.set(o.customer_id, arr);
  }

  function nextStepFor(id: string): string | null {
    const arr = objByCustomer.get(id);
    if (!arr || arr.length === 0) return null;
    // Most urgent: soonest due_date, else soonest next_followup_at.
    const sorted = [...arr].sort((a, b) => {
      const ax = a.due_date ?? a.next_followup_at ?? "9999";
      const bx = b.due_date ?? b.next_followup_at ?? "9999";
      return ax < bx ? -1 : ax > bx ? 1 : 0;
    });
    return sorted[0].title;
  }

  const partnerRows: PartnerRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    kind: c.customer_kind,
    lifecycle: c.lifecycle,
    parentName: c.parent_customer_id ? byId.get(c.parent_customer_id)?.name ?? null : null,
    industry: c.industry,
    health: latestHealth.get(c.id) ?? null,
    nextStep: nextStepFor(c.id),
    openObjectives: objByCustomer.get(c.id)?.length ?? 0,
    updated_at: c.updated_at,
  }));

  return (
    <div className="w-full space-y-6 px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Customers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The customers George is onboarding, by stage. Drop a signed contract in chat
            and he creates the record, contacts, and plan.
          </p>
        </div>
        <NewPartnerButton />
      </header>

      {partnerRows.length === 0 ? <EmptyState /> : <PartnersView rows={partnerRows} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <Users size={20} />
      </div>
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">No customers yet</h2>
      <p className="max-w-[360px] text-sm text-gray-500 dark:text-gray-400">
        Drop a signed contract into the George chat and he&apos;ll create the
        record, contacts, and onboarding plan.
      </p>
      <div className="mt-2">
        <NewPartnerButton />
      </div>
    </div>
  );
}
