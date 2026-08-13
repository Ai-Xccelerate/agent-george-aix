import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, Bell, Flag, Mail } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { listOrgIntegrations, COMPOSIO_NOT_CONFIGURED } from "@/lib/composio/connections";
import { getScribeConnection } from "@/lib/agent/scribe";
import { Badge, LifecycleBadge } from "@/components/ui/badge";
import HealthScoreChart from "@/components/aix/dashboards/george/HealthScoreChart";
import AtRiskAccountsPanel from "@/components/aix/dashboards/george/AtRiskAccountsPanel";
import RenewalTimelineTable from "@/components/aix/dashboards/george/RenewalTimelineTable";
import { Greeting } from "./_greeting";
import { ActivityStats } from "./_activity-stats";

export const dynamic = "force-dynamic";

const STAGES: Array<{ key: string; label: string }> = [
  { key: "prospect", label: "Prospect" },
  { key: "onboarding", label: "Onboarding" },
  { key: "active", label: "Active" },
  { key: "at_risk", label: "At risk" },
  { key: "churned", label: "Churned" },
];

const DRAFT_ACTIONS = ["email.drafted", "email.reply_drafted"];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const admin = createSupabaseAdmin();
  const orgId = user.orgId;
  // Sampled once for the whole page — the activity windows, the renewal horizon
  // and ActivityStats all measure against the same instant.
  const now = Date.now();
  const ninetyAgo = new Date(now - 90 * 86400000).toISOString();

  const [custRes, activityRes, objAchievedRes, recentDraftsRes, sentDraftsRes, atRiskRes, escalatedRes, decisionsRes, integrationsRes, healthRes, contractsRes] =
    await Promise.all([
      admin.from("customers").select("id, lifecycle, customer_kind").eq("org_id", orgId).limit(1000),
      admin
        .from("audit_log")
        .select("action, created_at")
        .eq("org_id", orgId)
        .in("action", [...DRAFT_ACTIONS, "email.sent", "calendar.event_created"])
        .gte("created_at", ninetyAgo)
        .limit(5000),
      admin
        .from("objectives")
        .select("achieved_at")
        .eq("org_id", orgId)
        .eq("status", "achieved")
        .gte("achieved_at", ninetyAgo)
        .limit(5000),
      admin
        .from("audit_log")
        .select("id, action, payload, customer_id")
        .eq("org_id", orgId)
        .in("action", DRAFT_ACTIONS)
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("audit_log")
        .select("payload")
        .eq("org_id", orgId)
        .eq("action", "email.sent")
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("customers")
        .select("id, name")
        .eq("org_id", orgId)
        .eq("lifecycle", "at_risk")
        .order("updated_at", { ascending: false })
        .limit(5),
      admin
        .from("objectives")
        .select("id, title, customer_id, customers!inner(name)")
        .eq("org_id", orgId)
        .eq("status", "blocked")
        .order("updated_at", { ascending: false })
        .limit(5),
      admin
        .from("escalations")
        .select("id, title, urgency, customer_id, session_id, created_at, customers(name)")
        .eq("org_id", orgId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(8),
      listOrgIntegrations(orgId),
      // Health history — newest first; we keep the latest row per customer
      // below. There is no "latest per group" in the query layer, so the
      // dedupe happens in JS over a bounded window.
      // Neither table carries org_id — both are scoped through the customer
      // they belong to, which is also how their RLS policies join. `!inner`
      // is load-bearing: without it the filter would narrow the embed and
      // still return every org's rows with a null customer attached.
      admin
        .from("customer_health")
        .select("customer_id, band, score, measured_at, customers!inner(id, name)")
        .eq("customers.org_id", orgId)
        .order("measured_at", { ascending: false })
        .limit(2000),
      admin
        .from("contracts")
        .select(
          "id, customer_id, end_date, arr_cents, currency, status, customers!inner(id, name)",
        )
        .eq("customers.org_id", orgId)
        .not("end_date", "is", null)
        .order("end_date", { ascending: true })
        .limit(200),
    ]);

  const customers = (custRes.data ?? []) as Array<{ lifecycle: string; customer_kind: string }>;
  const stageCounts = new Map<string, number>();
  for (const c of customers) stageCounts.set(c.lifecycle, (stageCounts.get(c.lifecycle) ?? 0) + 1);
  const partnerTotal = customers.filter((c) => c.customer_kind === "partner").length;

  const activity = (activityRes.data ?? []) as Array<{ action: string; created_at: string }>;
  const drafts = activity.filter((a) => DRAFT_ACTIONS.includes(a.action)).map((a) => a.created_at);
  const sent = activity.filter((a) => a.action === "email.sent").map((a) => a.created_at);
  const meetings = activity.filter((a) => a.action === "calendar.event_created").map((a) => a.created_at);
  const objectives = ((objAchievedRes.data ?? []) as Array<{ achieved_at: string | null }>)
    .map((o) => o.achieved_at)
    .filter((t): t is string => !!t);

  // Drop drafts that have since been sent — an `email.sent` row carries the
  // sent draft's id in its payload. Without this the dashboard shows stale
  // "to review" rows whose /actions target has already been filtered out.
  const sentDraftIds = new Set(
    ((sentDraftsRes.data ?? []) as Array<{ payload: { draft_id?: string } | null }>)
      .map((r) => r.payload?.draft_id)
      .filter((x): x is string => !!x),
  );
  const recentDrafts = (
    (recentDraftsRes.data ?? []) as Array<{
      id: string;
      action: string;
      payload: { to?: string[]; subject?: string; draft_id?: string } | null;
    }>
  )
    .filter((d) => {
      const id = d.payload?.draft_id;
      return id ? !sentDraftIds.has(id) : true;
    })
    .slice(0, 4);
  const atRisk = (atRiskRes.data ?? []) as Array<{ id: string; name: string }>;
  const escalated = (escalatedRes.data ?? []) as Array<{
    id: string;
    title: string;
    customer_id: string;
    customers: { name: string }[] | null;
  }>;
  const decisions = (decisionsRes.data ?? []) as Array<{
    id: string;
    title: string;
    urgency: string;
    session_id: string | null;
    customers: { name: string }[] | null;
  }>;
  // Live status from Composio is the single source of truth — no cached
  // table that can go stale on token expiry. `ok: false` means Composio was
  // unreachable; we render that distinctly rather than implying "connected".
  const integrationsOk = integrationsRes.ok;
  const integrationsError = integrationsRes.ok ? null : integrationsRes.error;
  const integrations = integrationsRes.ok ? integrationsRes.integrations : [];
  // Scribe is a direct MCP server, not a Composio integration — its status is
  // env-derived and independent of whether Composio could be reached.
  const scribe = getScribeConnection();

  // --- AIX-017 panels: health distribution, at-risk list, renewal timeline ---

  // Latest health row per customer. Rows arrive newest-first, so the first
  // sighting of a customer_id is its current score.
  type HealthRow = {
    customer_id: string;
    band: string;
    score: number | null;
    measured_at: string;
    customers: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const latestHealth = new Map<string, HealthRow>();
  for (const row of (healthRes.data ?? []) as HealthRow[]) {
    if (!latestHealth.has(row.customer_id)) latestHealth.set(row.customer_id, row);
  }
  const one = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? v[0] ?? null : v;

  // Renewal date per customer, so the at-risk list can show it.
  type ContractRow = {
    id: string;
    customer_id: string;
    end_date: string | null;
    arr_cents: number | null;
    currency: string | null;
    status: string;
    customers: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const contracts = (contractsRes.data ?? []) as ContractRow[];
  const renewalByCustomer = new Map<string, string>();
  for (const c of contracts) {
    if (c.end_date && !renewalByCustomer.has(c.customer_id)) {
      renewalByCustomer.set(c.customer_id, c.end_date);
    }
  }

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "";

  // Distribution across the chart's score buckets.
  const healthBuckets = [0, 0, 0, 0, 0, 0, 0];
  const bucketOf = (s: number) =>
    s <= 20 ? 0 : s <= 40 ? 1 : s <= 60 ? 2 : s <= 70 ? 3 : s <= 80 ? 4 : s <= 90 ? 5 : 6;
  for (const row of latestHealth.values()) {
    if (row.score != null) healthBuckets[bucketOf(row.score)]++;
  }
  const scoredCount = [...latestHealth.values()].filter((r) => r.score != null).length;

  const atRiskAccounts = [...latestHealth.values()]
    .filter((r) => r.score != null && r.score < 60)
    .map((r) => ({
      id: r.customer_id,
      account: one(r.customers)?.name ?? "Unknown account",
      healthScore: r.score as number,
      renewal: fmtDate(renewalByCustomer.get(r.customer_id) ?? null),
    }))
    .sort((a, b) => a.healthScore - b.healthScore)
    .slice(0, 8);

  // Renewals inside the next 120 days, soonest first. Risk is derived from the
  // account's current health score, not stored — there is no risk column.
  const horizon = now + 120 * 86400000;
  const renewals = contracts
    .filter((c) => {
      if (!c.end_date || c.status === "cancelled") return false;
      const t = new Date(c.end_date).getTime();
      return t >= now && t <= horizon;
    })
    .slice(0, 10)
    .map((c) => {
      const score = latestHealth.get(c.customer_id)?.score ?? null;
      return {
        account: one(c.customers)?.name ?? "Unknown account",
        arr:
          c.arr_cents != null
            ? new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: c.currency ?? "USD",
                maximumFractionDigits: 0,
              }).format(c.arr_cents / 100)
            : "—",
        renewal: fmtDate(c.end_date),
        owner: "George" as const,
        risk: (score == null ? "Low" : score < 40 ? "High" : score < 60 ? "Medium" : "Low") as
          | "High"
          | "Medium"
          | "Low",
      };
    });

  const needsYouCount =
    recentDrafts.length + atRisk.length + escalated.length + decisions.length;
  const firstName = user.fullName?.split(" ")[0] ?? null;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      data-aix-id="AIX-017"
      className="w-full space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 md:px-8 md:py-7 2xl:px-12"
    >
      <div data-aix-id="AIX-017.1">
        <Greeting firstName={firstName} />
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {today} · {partnerTotal} partner{partnerTotal === 1 ? "" : "s"} in your book
          {needsYouCount > 0
            ? ` · ${needsYouCount} thing${needsYouCount === 1 ? "" : "s"} need you`
            : " · all clear"}
        </p>
      </div>

      <div data-aix-id="AIX-017.2">
        <ActivityStats
          drafts={drafts}
          sent={sent}
          meetings={meetings}
          objectives={objectives}
          now={now}
        />
      </div>

      <div
        data-aix-id="AIX-017.3"
        className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3"
      >
        <div className="lg:col-span-2">
          <Card
            title="AI actions for you"
            badge={needsYouCount || undefined}
            right={
              <Link
                href="/actions"
                className="text-theme-xs font-medium text-brand-500 hover:text-brand-600 dark:hover:text-brand-400"
              >
                Open actions →
              </Link>
            }
          >
            {needsYouCount === 0 ? (
              <Empty text="Nothing waiting. George surfaces drafts to approve, escalations, and at-risk partners here." />
            ) : (
              <div className="space-y-4">
                {decisions.length > 0 && (
                  <NeedGroup
                    icon={<Bell size={13} />}
                    label={`${decisions.length} decision${decisions.length === 1 ? "" : "s"} for you`}
                  >
                    {decisions.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                      >
                        <Link href={`/actions?item=decision:${d.id}`} className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {d.urgency === "high" && (
                              <Badge tone="error" withDot={false}>
                                high
                              </Badge>
                            )}
                            <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                              {d.title}
                            </span>
                          </div>
                          {d.customers?.[0]?.name && (
                            <div className="truncate text-theme-xs font-medium text-brand-500">
                              {d.customers[0].name}
                            </div>
                          )}
                        </Link>
                        <Link
                          href={`/actions?item=decision:${d.id}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-theme-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                        >
                          Open <ArrowRight size={12} />
                        </Link>
                      </div>
                    ))}
                  </NeedGroup>
                )}
                {recentDrafts.length > 0 && (
                  <NeedGroup icon={<Mail size={13} />} label={`${recentDrafts.length} draft${recentDrafts.length === 1 ? "" : "s"} to review`}>
                    {recentDrafts.map((d) => (
                      <NeedRow
                        key={d.id}
                        href={`/actions?item=draft:${d.id}`}
                        title={
                          d.payload?.subject ||
                          (d.action === "email.reply_drafted" ? "Reply draft" : "(no subject)")
                        }
                        sub={d.payload?.to?.join(", ") || "—"}
                      />
                    ))}
                  </NeedGroup>
                )}
                {escalated.length > 0 && (
                  <NeedGroup icon={<Flag size={13} />} label={`${escalated.length} escalated`}>
                    {escalated.map((e) => (
                      <NeedRow
                        key={e.id}
                        href={`/customers/${e.customer_id}`}
                        title={e.title}
                        sub={e.customers?.[0]?.name ?? ""}
                      />
                    ))}
                  </NeedGroup>
                )}
                {atRisk.length > 0 && (
                  <NeedGroup icon={<AlertTriangle size={13} />} label={`${atRisk.length} at-risk partner${atRisk.length === 1 ? "" : "s"}`}>
                    {atRisk.map((p) => (
                      <NeedRow key={p.id} href={`/customers/${p.id}`} title={p.name} sub="Health is red" />
                    ))}
                  </NeedGroup>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 md:space-y-6">
          <Card
            title="Pipeline"
            right={
              <Link
                href="/customers"
                className="text-theme-xs font-medium text-brand-500 hover:text-brand-600 dark:hover:text-brand-400"
              >
                All partners →
              </Link>
            }
          >
            <ul className="space-y-1.5">
              {STAGES.map((s) => (
                <li key={s.key}>
                  <Link
                    href="/customers"
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <LifecycleBadge value={s.key} />
                    <span className="text-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                      {stageCounts.get(s.key) ?? 0}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="George's connections"
            right={
              <Link
                href="/settings/integrations"
                className="text-theme-xs font-medium text-brand-500 hover:text-brand-600 dark:hover:text-brand-400"
              >
                Manage →
              </Link>
            }
          >
            <ul className="space-y-1.5">
              <ConnectionLi label="Scribe (note-taker)" connected={scribe.connected} />
              {integrations.map((i) => (
                <ConnectionLi key={i.authConfigId} label={i.label} connected={i.status === "connected"} />
              ))}
            </ul>
            {!integrationsOk && (
              <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
                {integrationsError === COMPOSIO_NOT_CONFIGURED
                  ? "Outlook/Calendar integrations aren\u2019t configured locally. Add COMPOSIO_API_KEY to .env.local to enable."
                  : "Couldn\u2019t reach Composio for the rest \u2014 check back shortly."}
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* Account health — only rendered once George has scored something.
          An empty chart would imply "all accounts are at zero" rather than
          "nothing has been measured yet". */}
      {scoredCount > 0 && (
        <>
          <div
            data-aix-id="AIX-017.4"
            className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-3"
          >
            <div className="xl:col-span-2">
              <HealthScoreChart accounts={healthBuckets} />
            </div>
            <div>
              <AtRiskAccountsPanel accounts={atRiskAccounts} />
            </div>
          </div>

          {renewals.length > 0 && (
            <div data-aix-id="AIX-017.5">
              <RenewalTimelineTable renewals={renewals} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConnectionLi({ label, connected }: { label: string; connected: boolean }) {
  return (
    <li className="flex items-center justify-between text-theme-sm">
      <span className="text-gray-700 dark:text-gray-300">{label}</span>
      <span className="inline-flex items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
        <span
          className={`h-2 w-2 rounded-full ${
            connected ? "bg-success-500" : "bg-gray-300 dark:bg-gray-600"
          }`}
        />
        {connected ? "Connected" : "Not connected"}
      </span>
    </li>
  );
}

function Card({
  title,
  right,
  badge,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-white/90">
          {title}
          {badge ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-theme-xs font-medium text-white">
              {badge}
            </span>
          ) : null}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function NeedGroup({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-3 py-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
        <span className="text-brand-500">{icon}</span>
        {label}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  );
}

function NeedRow({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {title}
        </span>
        {sub && (
          <span className="block truncate text-theme-xs text-gray-500 dark:text-gray-400">
            {sub}
          </span>
        )}
      </span>
      <ArrowRight size={13} className="shrink-0 text-gray-400" />
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-center text-theme-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
      {text}
    </div>
  );
}

