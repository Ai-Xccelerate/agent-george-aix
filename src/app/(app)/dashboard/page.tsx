import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, Bell, Flag, Mail } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { listOrgIntegrations } from "@/lib/composio/connections";
import { getScribeConnection } from "@/lib/agent/scribe";
import { LifecycleBadge } from "@/components/ui/badge";
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
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  const [custRes, activityRes, objAchievedRes, recentDraftsRes, sentDraftsRes, atRiskRes, escalatedRes, decisionsRes, integrationsRes] =
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
  const integrations = integrationsRes.ok ? integrationsRes.integrations : [];
  // Scribe is a direct MCP server, not a Composio integration — its status is
  // env-derived and independent of whether Composio could be reached.
  const scribe = getScribeConnection();

  const needsYouCount =
    recentDrafts.length + atRisk.length + escalated.length + decisions.length;
  const firstName = user.fullName?.split(" ")[0] ?? null;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="w-full space-y-6 px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <div>
        <Greeting firstName={firstName} />
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          {today} · {partnerTotal} partner{partnerTotal === 1 ? "" : "s"} in your book
          {needsYouCount > 0
            ? ` · ${needsYouCount} thing${needsYouCount === 1 ? "" : "s"} need you`
            : " · all clear"}
        </p>
      </div>

      <ActivityStats drafts={drafts} sent={sent} meetings={meetings} objectives={objectives} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title="AI Actions for You"
            badge={needsYouCount || undefined}
            right={
              <Link href="/actions" className="text-[12px] font-medium text-[var(--color-accent)] hover:underline">
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
                        className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--color-surface-2)]"
                      >
                        <Link href={`/actions?item=decision:${d.id}`} className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {d.urgency === "high" && (
                              <span className="shrink-0 rounded-full bg-[var(--color-error)]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-error)]">
                                high
                              </span>
                            )}
                            <span className="truncate text-[13px] font-medium text-[var(--color-fg)]">
                              {d.title}
                            </span>
                          </div>
                          {d.customers?.[0]?.name && (
                            <div className="truncate text-[12px] font-medium text-[var(--color-accent)]">
                              {d.customers[0].name}
                            </div>
                          )}
                        </Link>
                        <Link
                          href={`/actions?item=decision:${d.id}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
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

        <div className="space-y-6">
          <Card title="Pipeline" right={<Link href="/customers" className="text-[12px] font-medium text-[var(--color-accent)] hover:underline">All partners →</Link>}>
            <ul className="space-y-1.5">
              {STAGES.map((s) => (
                <li key={s.key}>
                  <Link href="/customers" className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                    <LifecycleBadge value={s.key} />
                    <span className="text-[14px] font-semibold tabular-nums text-[var(--color-fg)]">{stageCounts.get(s.key) ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="George's connections"
            right={<Link href="/settings/integrations" className="text-[12px] font-medium text-[var(--color-accent)] hover:underline">Manage →</Link>}
          >
            <ul className="space-y-1.5">
              <ConnectionLi label="Scribe (note-taker)" connected={scribe.connected} />
              {integrations.map((i) => (
                <ConnectionLi key={i.authConfigId} label={i.label} connected={i.status === "connected"} />
              ))}
            </ul>
            {!integrationsOk && (
              <p className="mt-2 text-[12px] text-[var(--color-fg-muted)]">
                Couldn&apos;t reach Composio for the rest — check back shortly.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConnectionLi({ label, connected }: { label: string; connected: boolean }) {
  return (
    <li className="flex items-center justify-between text-[13px]">
      <span className="text-[var(--color-fg)]">{label}</span>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)]">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: connected ? "var(--color-success)" : "var(--color-fg-muted)" }}
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
    <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-fg)]">
          {title}
          {badge ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[11px] font-medium text-white">
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
    <div className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-secondary)]">
        <span className="text-[var(--color-accent)]">{icon}</span>
        {label}
      </div>
      <div className="divide-y divide-[var(--color-border-subtle)]">{children}</div>
    </div>
  );
}

function NeedRow({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--color-surface-2)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--color-fg)]">{title}</span>
        {sub && <span className="block truncate text-[11px] text-[var(--color-fg-muted)]">{sub}</span>}
      </span>
      <ArrowRight size={13} className="shrink-0 text-[var(--color-fg-muted)]" />
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--color-border-subtle)] px-4 py-8 text-center text-[13px] text-[var(--color-fg-muted)]">
      {text}
    </div>
  );
}

