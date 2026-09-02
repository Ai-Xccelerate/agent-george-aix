import Link from "next/link";
import { checkOnboardingPreconditions } from "@/lib/agent/onboarding-preconditions";
import { OnboardButton } from "./_onboard-button";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Flag,
  ListChecks,
  Mail,
  Network,
  Phone,
  Repeat,
  Sparkles,
  Star,
  Target,
  Users,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveEscalationAction } from "../../dashboard/actions";
import {
  HealthBadge,
  KindBadge,
  LifecycleBadge,
  StepStatusBadge,
} from "@/components/ui/badge";
import { initials } from "@/lib/utils";
import { AccountConversations } from "./_account-conversations";
import {
  AddContactButton,
  AddEndCustomerButton,
  DocumentList,
  type DocumentListItem,
  EditContactButton,
  EditCustomerButton,
  UploadDocumentButton,
} from "./_forms";

export const dynamic = "force-dynamic";

// ── Account-hub layout ──────────────────────────────────────────────────────
// George is an employee, not an app: this page is the account's home. The Onyx
// team comes here to see where a partner's onboarding stands and what George is
// doing about it — not to operate George. Left column = the account (objectives,
// plan, meetings, docs, contacts). Right rail = the conversation with George
// about THIS account + a log of what he's done. Reference: the Agent Joy hub.

type Customer = {
  id: string;
  name: string;
  domain: string | null;
  lifecycle: string;
  customer_kind: "partner" | "end_customer";
  parent_customer_id: string | null;
  industry: string | null;
  size: string | null;
  notes: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type RelatedCustomer = {
  id: string;
  name: string;
  domain: string | null;
  customer_kind?: "partner" | "end_customer";
  lifecycle?: string;
  updated_at?: string;
};

type Contact = {
  id: string;
  full_name: string;
  email: string | null;
  title: string | null;
  phone: string | null;
  is_primary: boolean;
  timezone: string | null;
  /** Who they are to the account (migration 0004). Null on contacts that predate it. */
  role: string | null;
};

type Contract = {
  id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  arr_cents: number | null;
  currency: string | null;
  signed_at: string | null;
  summary: string | null;
};

type Step = {
  id: string;
  ordinal: number;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  owner: string | null;
};

type Plan = {
  id: string;
  status: string;
  start_date: string | null;
  target_end_date: string | null;
  pace: string | null;
  notes: string | null;
  onboarding_steps: Step[] | null;
};

type Health = {
  id: string;
  band: string;
  score: number | null;
  reason: string | null;
  measured_at: string;
};

type Cadence = {
  id: string;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "ad_hoc";
  channel: "call" | "in_person" | "email" | "async";
  day_of_week: number | null;
  time_of_day: string | null;
  timezone: string | null;
  duration_min: number | null;
  next_meeting_at: string | null;
  last_met_at: string | null;
  notes: string | null;
};

type Objective = {
  id: string;
  title: string;
  status: "pending" | "awaiting" | "achieved" | "blocked" | "cancelled";
  responsible_side: "customer" | "onyx";
  due_date: string | null;
  next_followup_at: string | null;
  followup_count: number;
  max_followups: number;
};

type Owner = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

type Session = {
  id: string;
  title: string | null;
  channel: string | null;
  updated_at: string;
};

type Activity = {
  id: string;
  action: string;
  created_at: string;
  session_id: string | null;
};

export default async function CustomerPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // Service-role client (auth/entitlement enforced by getCurrentUser); the root
  // customer fetch is org-scoped so an out-of-org id 404s instead of leaking.
  const supabase = createSupabaseAdmin();

  const [{ data: customer }, contactsRes, contractsRes, planRes, healthRes] =
    await Promise.all([
      supabase
        .from("customers")
        .select(
          "id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, notes, owner_user_id, created_at, updated_at",
        )
        .eq("id", id)
        .eq("org_id", user.orgId)
        .maybeSingle<Customer>(),
      supabase
        .from("contacts")
        .select("id, full_name, email, title, phone, is_primary, timezone, role")
        .eq("customer_id", id)
        .order("is_primary", { ascending: false })
        .order("full_name"),
      supabase
        .from("contracts")
        .select("id, status, start_date, end_date, arr_cents, currency, signed_at, summary")
        .eq("customer_id", id)
        .order("signed_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("onboarding_plans")
        .select(
          "id, status, start_date, target_end_date, pace, notes, onboarding_steps(id, ordinal, title, description, status, due_date, completed_at, owner)",
        )
        .eq("customer_id", id)
        .in("status", ["planned", "in_progress", "blocked"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<Plan>(),
      supabase
        .from("customer_health")
        .select("id, band, score, reason, measured_at")
        .eq("customer_id", id)
        .order("measured_at", { ascending: false })
        .limit(10),
    ]);

  if (!customer) notFound();

  const [
    parentRes,
    endCustomersRes,
    cadenceRes,
    docsRes,
    objectivesRes,
    ownerRes,
    sessionsRes,
    activityRes,
  ] = await Promise.all([
    customer.parent_customer_id
      ? supabase
          .from("customers")
          .select("id, name, domain, customer_kind")
          .eq("id", customer.parent_customer_id)
          .eq("org_id", user.orgId)
          .maybeSingle<RelatedCustomer>()
      : Promise.resolve({ data: null as RelatedCustomer | null }),
    customer.customer_kind === "partner"
      ? supabase
          .from("customers")
          .select("id, name, domain, lifecycle, updated_at")
          .eq("parent_customer_id", customer.id)
          .eq("org_id", user.orgId)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] as RelatedCustomer[] }),
    supabase
      .from("cadences")
      .select(
        "id, frequency, channel, day_of_week, time_of_day, timezone, duration_min, next_meeting_at, last_met_at, notes",
      )
      .eq("customer_id", customer.id)
      .eq("active", true)
      .maybeSingle<Cadence>(),
    supabase
      .from("documents")
      .select("id, original_name, mime_type, file_size, created_at, uploaded_by")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("objectives")
      .select(
        "id, title, status, responsible_side, due_date, next_followup_at, followup_count, max_followups",
      )
      .eq("customer_id", customer.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true }),
    customer.owner_user_id
      ? supabase
          .from("org_members")
          .select("user_id, full_name, email")
          .eq("user_id", customer.owner_user_id)
          .eq("org_id", user.orgId)
          .maybeSingle<Owner>()
      : Promise.resolve({ data: null as Owner | null }),
    supabase
      .from("agent_sessions")
      .select("id, title, channel, updated_at")
      .eq("customer_id", customer.id)
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("audit_log")
      .select("id, action, created_at, session_id")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const parent = parentRes.data ?? null;
  const endCustomers = (endCustomersRes.data ?? []) as RelatedCustomer[];
  const cadence = cadenceRes.data ?? null;
  const objectives = (objectivesRes.data ?? []) as Objective[];
  const owner = ownerRes.data ?? null;
  const sessions = (sessionsRes.data ?? []) as Session[];
  const activity = (activityRes.data ?? []) as Activity[];

  // Open decisions George raised about this partner — surfaced here so
  // customer-specific actions live on the partner, not buried in /actions.
  const { data: escRows } = await supabase
    .from("escalations")
    .select("id, title, urgency, session_id, created_at")
    .eq("customer_id", customer.id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(10);
  const openDecisions = (escRows ?? []) as Array<{
    id: string;
    title: string;
    urgency: string;
    session_id: string | null;
    created_at: string;
  }>;

  const docsRaw = (docsRes.data ?? []) as Array<{
    id: string;
    original_name: string;
    mime_type: string;
    file_size: number;
    created_at: string;
    uploaded_by: string | null;
  }>;
  const uploaderIds = Array.from(
    new Set(docsRaw.map((d) => d.uploaded_by).filter((v): v is string => !!v)),
  );
  const uploaders = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const usersRes = await supabase
      .from("org_members")
      .select("user_id, full_name, email")
      .in("user_id", uploaderIds)
      .eq("org_id", user.orgId);
    for (const u of (usersRes.data ?? []) as Array<{
      user_id: string;
      full_name: string | null;
      email: string | null;
    }>) {
      uploaders.set(u.user_id, u.full_name ?? u.email ?? "Unknown");
    }
  }
  const docs: DocumentListItem[] = docsRaw.map((d) => ({
    id: d.id,
    original_name: d.original_name,
    mime_type: d.mime_type,
    file_size: d.file_size,
    created_at: d.created_at,
    uploader_name: d.uploaded_by ? uploaders.get(d.uploaded_by) ?? null : null,
  }));

  const contacts = (contactsRes.data ?? []) as Contact[];
  const onboarding = await checkOnboardingPreconditions(supabase, user.orgId, id);
  // `?? contacts[0]` used to end this line. Harmless for showing a name and
  // exactly the wrong instinct next to a feature that picks who receives mail,
  // so it is gone: no primary contact now reads as no primary contact.
  // Choosing a RECIPIENT is a different question again and lives in
  // onboarding-preconditions.ts, which requires an explicit role.
  const primary = contacts.find((c) => c.is_primary) ?? null;
  const contracts = (contractsRes.data ?? []) as Contract[];
  const activeContract =
    contracts.find((c) => c.status === "active" || c.status === "signed") ??
    contracts[0] ??
    null;
  const plan = planRes.data;
  const steps = (plan?.onboarding_steps ?? []).slice().sort((a, b) => a.ordinal - b.ordinal);
  const healthHistory = (healthRes.data ?? []) as Health[];
  const latestHealth = healthHistory[0] ?? null;
  const nextDueStep =
    steps.find((s) => s.status === "in_progress") ??
    steps.find((s) => s.status === "planned" || s.status === "blocked") ??
    null;
  const progress =
    steps.length === 0
      ? 0
      : Math.round(
          (steps.filter((s) => s.status === "completed").length / steps.length) * 100,
        );

  const openObjectives = objectives.filter(
    (o) => o.status !== "achieved" && o.status !== "cancelled",
  );
  const isPartner = customer.customer_kind === "partner";

  return (
    <div className="w-full space-y-6 px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-theme-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white/90"
      >
        <ArrowLeft size={14} />
        Partners
      </Link>

      <StatStripHeader
        customer={customer}
        owner={owner}
        primary={primary}
        latestHealth={latestHealth}
        activeContract={activeContract}
        nextStep={nextDueStep}
        targetEnd={plan?.target_end_date ?? null}
        progress={plan ? progress : null}
      />

      <OnboardButton
        customerId={id}
        blockers={onboarding.ok ? [] : onboarding.failures}
        recipient={
          onboarding.ok
            ? { email: onboarding.recipient.email, role: onboarding.recipient.role }
            : null
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
        {/* ── Left: the account. Masonry on wide screens so a 4K display
              isn't a tall single column of scrolling; collapses to one
              column on laptops and stacks on mobile. ─────────────────── */}
        <div className="gap-6 [column-fill:balance] columns-1 xl:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
          {openDecisions.length > 0 && (
            <Section
              title="Needs you"
              icon={<Bell size={14} className="text-brand-500 dark:text-brand-400" />}
              right={
                <span className="text-theme-xs text-gray-400 dark:text-gray-500">
                  {openDecisions.length}
                </span>
              }
            >
              <ul className="space-y-1.5">
                {openDecisions.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <Link
                      href={d.session_id ? `/chat/${d.session_id}` : "/actions"}
                      className="min-w-0 flex-1"
                    >
                      <div className="flex items-center gap-2">
                        {d.urgency === "high" && (
                          <span className="shrink-0 rounded-full bg-error-500/15 px-1.5 py-0.5 text-theme-xs font-medium uppercase tracking-wide text-error-500">
                            high
                          </span>
                        )}
                        <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                          {d.title}
                        </span>
                      </div>
                    </Link>
                    <form action={resolveEscalationAction} className="shrink-0">
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 py-1 text-theme-xs font-medium text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                      >
                        Resolve
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <ObjectivesSection objectives={objectives} customerId={customer.id} />

          <Section
            title="Onboarding plan"
            icon={<ListChecks size={14} className="text-brand-500 dark:text-brand-400" />}
            right={
              plan ? (
                <span className="text-theme-xs text-gray-400 dark:text-gray-500">
                  {progress}% · {steps.length} step{steps.length === 1 ? "" : "s"}
                </span>
              ) : null
            }
          >
            {plan ? (
              <PlanBlock plan={plan} steps={steps} progress={progress} />
            ) : (
              <EmptyRow
                text="No onboarding plan yet."
                cta={{ label: "Ask George to plan it", href: `/chat?customer=${customer.id}` }}
              />
            )}
          </Section>

          <Section
            title="Meetings & cadence"
            icon={<Repeat size={14} className="text-brand-500 dark:text-brand-400" />}
          >
            {cadence ? (
              <CadenceBlock cadence={cadence} />
            ) : (
              <EmptyRow
                text="No recurring cadence set. Scribe joins meetings and George reads the transcript after."
                cta={{ label: "Ask George to set one", href: `/chat?customer=${customer.id}` }}
              />
            )}
          </Section>

          <DocumentsPanel customerId={customer.id} docs={docs} />

          <Section
            title={`Contacts (${contacts.length})`}
            icon={<Users size={14} className="text-brand-500 dark:text-brand-400" />}
            right={
              <AddContactButton
                customerId={customer.id}
                hasPrimary={contacts.some((c) => c.is_primary)}
              />
            }
          >
            {contacts.length === 0 ? (
              <EmptyRow text="No contacts yet." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {contacts.map((c) => (
                  <ContactCard key={c.id} contact={c} />
                ))}
              </div>
            )}
          </Section>

          <HierarchySection
            customer={customer}
            parent={parent}
            endCustomers={endCustomers}
          />

          {customer.notes && (
            <Section title="Notes">
              <p className="whitespace-pre-wrap text-sm text-gray-500 dark:text-gray-400">
                {customer.notes}
              </p>
            </Section>
          )}
        </div>

        {/* ── Right: George, scoped to this account ──────────────────────── */}
        <aside className="space-y-6 lg:sticky lg:top-5 lg:self-start">
          <AccountConversations
            customerId={customer.id}
            customerName={customer.name}
            sessions={sessions}
          />
          <ActivitySection activity={activity} />
          {openObjectives.length === 0 && objectives.length === 0 && (
            <p className="px-1 text-theme-xs leading-relaxed text-gray-400 dark:text-gray-500">
              George works this account on his own — drafting outreach, chasing
              what onboarding needs, and reporting to {owner?.full_name ?? "the owner"}.
              You step in to review and decide.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Header: name + a horizontal stat strip ──────────────────────────────────
function StatStripHeader({
  customer,
  owner,
  primary,
  latestHealth,
  activeContract,
  nextStep,
  targetEnd,
  progress,
}: {
  customer: Customer;
  owner: Owner | null;
  primary: Contact | null;
  latestHealth: Health | null;
  activeContract: Contract | null;
  nextStep: Step | null;
  targetEnd: string | null;
  progress: number | null;
}) {
  return (
    <div className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-4 p-6 pb-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
            <Building2 size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-display text-2xl font-semibold tracking-tight leading-tight text-gray-800 dark:text-white/90">
                {customer.name}
              </h1>
              <KindBadge kind={customer.customer_kind} />
              <LifecycleBadge value={customer.lifecycle} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-theme-sm text-gray-500 dark:text-gray-400">
              {customer.domain && (
                <a
                  href={`https://${customer.domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 hover:text-brand-500 dark:hover:text-brand-400"
                >
                  {customer.domain}
                  <ExternalLink size={11} />
                </a>
              )}
              {customer.industry && <span>{customer.industry}</span>}
              {customer.size && <span>{customer.size}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <EditCustomerButton
            customer={{
              id: customer.id,
              name: customer.name,
              domain: customer.domain,
              lifecycle: customer.lifecycle,
              industry: customer.industry,
              size: customer.size,
              notes: customer.notes,
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[16px] border-t border-gray-200 dark:border-gray-800 bg-gray-200 dark:bg-gray-800 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Contract">
          {activeContract?.arr_cents != null
            ? formatMoney(activeContract.arr_cents, activeContract.currency ?? "USD")
            : "—"}
        </Stat>
        <Stat label="Stage">
          <LifecycleBadge value={customer.lifecycle} />
        </Stat>
        <Stat label="Health">
          {latestHealth ? (
            <span className="inline-flex items-center gap-1.5">
              <HealthBadge band={latestHealth.band} />
              {latestHealth.score != null && (
                <span className="text-theme-sm font-semibold">{latestHealth.score}</span>
              )}
            </span>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label="Owner">{owner?.full_name ?? owner?.email ?? "Unassigned"}</Stat>
        <Stat label="Primary contact">{primary?.full_name ?? "—"}</Stat>
        <Stat label={progress != null ? "Next step" : "Target"}>
          {nextStep ? (
            <span className="truncate" title={nextStep.title}>
              {nextStep.title}
            </span>
          ) : targetEnd ? (
            fmt(targetEnd)
          ) : (
            "—"
          )}
        </Stat>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-white/[0.03] px-4 py-3">
      <div className="text-theme-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </div>
      <div className="mt-1 truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {children}
      </div>
    </div>
  );
}

// ── Objectives — what George is chasing for this account ─────────────────────
function ObjectivesSection({
  objectives,
  customerId,
}: {
  objectives: Objective[];
  customerId: string;
}) {
  const open = objectives.filter((o) => o.status !== "achieved");
  const done = objectives.filter((o) => o.status === "achieved");
  return (
    <Section
      title="Objectives"
      icon={<Target size={14} className="text-brand-500 dark:text-brand-400" />}
      right={
        objectives.length > 0 ? (
          <span className="text-theme-xs text-gray-400 dark:text-gray-500">
            {done.length}/{objectives.length} done
          </span>
        ) : null
      }
    >
      {objectives.length === 0 ? (
        <EmptyRow
          text="Nothing being chased yet. George creates objectives from the kickoff and follows up until each is met."
          cta={{ label: "Ask George", href: `/chat?customer=${customerId}` }}
        />
      ) : (
        <ul className="space-y-2">
          {[...open, ...done].map((o) => (
            <ObjectiveRow key={o.id} objective={o} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ObjectiveRow({ objective: o }: { objective: Objective }) {
  const achieved = o.status === "achieved";
  const blocked = o.status === "blocked";
  return (
    <li className="flex items-start gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3">
      {achieved ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success-500" />
      ) : blocked ? (
        <Flag size={16} className="mt-0.5 shrink-0 text-warning-500" />
      ) : (
        <Circle size={16} className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-theme-sm font-medium ${achieved ? "text-gray-400 dark:text-gray-500 line-through" : "text-gray-800 dark:text-white/90"}`}
          >
            {o.title}
          </span>
          <ObjectiveStatusBadge status={o.status} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
          <span>{o.responsible_side === "onyx" ? "Onyx owes" : "Customer owes"}</span>
          {!achieved && o.followup_count > 0 && (
            <span>follow-up {o.followup_count}/{o.max_followups}</span>
          )}
          {o.due_date && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={10} /> due {fmt(o.due_date)}
            </span>
          )}
          {!achieved && o.next_followup_at && (
            <span>next nudge {timeAgo(o.next_followup_at)}</span>
          )}
        </div>
      </div>
    </li>
  );
}

function ObjectiveStatusBadge({ status }: { status: Objective["status"] }) {
  const map: Record<Objective["status"], { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" },
    awaiting: { label: "Awaiting", cls: "bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400" },
    achieved: { label: "Done", cls: "bg-gray-100 dark:bg-gray-800 text-success-500" },
    blocked: { label: "Escalated", cls: "bg-gray-100 dark:bg-gray-800 text-warning-500" },
    cancelled: { label: "Cancelled", cls: "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500" },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-[2px] text-theme-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ── Activity — what George did on this account ───────────────────────────────
function ActivitySection({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return null;
  return (
    <Section
      title="What George did"
      icon={<Sparkles size={14} className="text-brand-500 dark:text-brand-400" />}
    >
      <ul className="space-y-2.5">
        {activity.map((a) => (
          <li key={a.id} className="flex items-start gap-2.5 text-theme-xs">
            <Circle size={6} className="mt-1.5 shrink-0 fill-brand-500 text-brand-500 dark:text-brand-400" />
            <div className="min-w-0 flex-1">
              <span className="text-gray-500 dark:text-gray-400">{actionLabel(a.action)}</span>
              <span className="ml-1.5 text-gray-400 dark:text-gray-500">· {timeAgo(a.created_at)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "email.drafted": "Drafted an email",
    "email.reply_drafted": "Drafted a reply",
    "email.sent": "Sent an email",
    "calendar.event_created": "Scheduled a meeting",
    "fireflies.transcript_fetched": "Pulled a meeting transcript",
  };
  return map[action] ?? action.replace(/[._]/g, " ");
}

// ── Hierarchy ───────────────────────────────────────────────────────────────
function HierarchySection({
  customer,
  parent,
  endCustomers,
}: {
  customer: Customer;
  parent: RelatedCustomer | null;
  endCustomers: RelatedCustomer[];
}) {
  if (customer.customer_kind === "end_customer") {
    return (
      <Section
        title="Partner"
        icon={<Network size={14} className="text-brand-500 dark:text-brand-400" />}
      >
        {parent ? (
          <Link
            href={`/customers/${parent.id}`}
            className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
              <Building2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {parent.name}
                </span>
                <KindBadge kind="partner" />
              </div>
              {parent.domain && (
                <div className="text-theme-xs text-gray-400 dark:text-gray-500">{parent.domain}</div>
              )}
            </div>
            <ArrowLeft size={14} className="rotate-180 text-gray-400 dark:text-gray-500" />
          </Link>
        ) : (
          <EmptyRow text="No parent partner linked." />
        )}
      </Section>
    );
  }

  return (
    <Section
      title={`End customers (${endCustomers.length})`}
      icon={<Network size={14} className="text-brand-500 dark:text-brand-400" />}
      right={<AddEndCustomerButton parentId={customer.id} parentName={customer.name} />}
    >
      {endCustomers.length === 0 ? (
        <EmptyRow text="No end customers yet for this partner." />
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {endCustomers.map((ec) => (
            <li key={ec.id}>
              <Link
                href={`/customers/${ec.id}`}
                className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
                  <Building2 size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {ec.name}
                  </div>
                  <div className="flex items-center gap-2 text-theme-xs text-gray-400 dark:text-gray-500">
                    {ec.lifecycle && <LifecycleBadge value={ec.lifecycle} />}
                    {ec.domain && <span className="truncate">{ec.domain}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────
function DocumentsPanel({
  customerId,
  docs,
}: {
  customerId: string;
  docs: DocumentListItem[];
}) {
  return (
    <Section
      title={`Documents (${docs.length})`}
      icon={<FileText size={14} className="text-brand-500 dark:text-brand-400" />}
      right={<UploadDocumentButton customerId={customerId} />}
    >
      {docs.length === 0 ? (
        <EmptyRow text="No documents yet. Upload one, or drop it in chat and George files it here." />
      ) : (
        <DocumentList docs={docs} />
      )}
    </Section>
  );
}

// ── Shared leaf components ───────────────────────────────────────────────────
function Section({
  title,
  right,
  icon,
  className,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 ${className ?? ""}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
          {icon}
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function CadenceBlock({ cadence }: { cadence: Cadence }) {
  const cadenceLabel: Record<Cadence["frequency"], string> = {
    weekly: "Weekly",
    biweekly: "Biweekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    ad_hoc: "Ad hoc",
  };
  const channelLabelMap: Record<Cadence["channel"], string> = {
    call: "Call",
    in_person: "In person",
    email: "Email",
    async: "Async",
  };
  const dayText = cadence.day_of_week != null ? DAY_NAMES[cadence.day_of_week] : null;
  const timeText = cadence.time_of_day ? cadence.time_of_day.slice(0, 5) : null;
  const tzText = cadence.timezone ? ` ${cadence.timezone}` : "";
  const slotLine =
    cadence.frequency === "ad_hoc"
      ? "No fixed slot"
      : [dayText, timeText && `at ${timeText}${tzText}`].filter(Boolean).join(" ") ||
        "Day/time not set";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-500/15 px-2.5 py-[3px] text-theme-xs font-medium text-brand-500 dark:text-brand-400">
          <Repeat size={11} /> {cadenceLabel[cadence.frequency]}
        </div>
        <span className="text-theme-sm text-gray-500 dark:text-gray-400">{slotLine}</span>
        <span className="text-theme-xs text-gray-400 dark:text-gray-500">
          · {channelLabelMap[cadence.channel]}
          {cadence.duration_min ? ` · ${cadence.duration_min} min` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 text-theme-sm">
        <KV
          label="Next meeting"
          value={cadence.next_meeting_at ? fmt(cadence.next_meeting_at) : "—"}
        />
        <KV
          label="Last met"
          value={cadence.last_met_at ? fmt(cadence.last_met_at) : "—"}
        />
      </div>
      {cadence.notes && (
        <p className="whitespace-pre-wrap rounded-md bg-gray-50 dark:bg-white/[0.03] p-3 text-theme-xs text-gray-500 dark:text-gray-400">
          {cadence.notes}
        </p>
      )}
    </div>
  );
}

function PlanBlock({ plan, steps, progress }: { plan: Plan; steps: Step[]; progress: number }) {
  return (
    <div className="space-y-4">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-50 dark:bg-white/[0.03]">
        <div className="h-full brand-gradient transition-all" style={{ width: `${progress}%` }} />
      </div>
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li
            key={s.id}
            className="flex items-start gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3"
          >
            <StepIcon status={s.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{s.title}</span>
                <StepStatusBadge value={s.status} />
              </div>
              {s.description && (
                <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{s.description}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-3 text-theme-xs text-gray-400 dark:text-gray-500">
                {s.due_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock size={10} /> due {fmt(s.due_date)}
                  </span>
                )}
                {s.owner && <span>· {s.owner}</span>}
                {s.completed_at && (
                  <span className="inline-flex items-center gap-1 text-success-500">
                    <CheckCircle2 size={10} /> done {timeAgo(s.completed_at)}
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "completed")
    return <CheckCircle2 size={18} className="mt-0.5 text-success-500" />;
  if (status === "in_progress")
    return <Clock size={18} className="mt-0.5 animate-pulse text-brand-500 dark:text-brand-400" />;
  if (status === "blocked")
    return <Clock size={18} className="mt-0.5 text-warning-500" />;
  return <Circle size={18} className="mt-0.5 text-gray-400 dark:text-gray-500" />;
}

function ContactCard({ contact }: { contact: Contact }) {
  return (
    <div className="group relative rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3">
      <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
        <EditContactButton
          contact={{
            id: contact.id,
            full_name: contact.full_name,
            title: contact.title,
            role: contact.role,
            email: contact.email,
            phone: contact.phone,
            timezone: contact.timezone,
            is_primary: contact.is_primary,
          }}
        />
      </div>
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-theme-xs font-semibold text-white">
          {initials(contact.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
              {contact.full_name}
            </span>
            {contact.is_primary && (
              <Star size={11} className="text-brand-500 dark:text-brand-400" aria-label="primary" />
            )}
          </div>
          <div className="text-theme-xs text-gray-400 dark:text-gray-500">{contact.title ?? "—"}</div>
          <div className="mt-1 space-y-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1 truncate hover:text-brand-500 dark:hover:text-brand-400"
              >
                <Mail size={10} />
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <div className="inline-flex items-center gap-1">
                <Phone size={10} />
                {contact.phone}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-theme-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</div>
      <div className="mt-0.5 text-theme-sm font-medium text-gray-800 dark:text-white/90">{value}</div>
    </div>
  );
}

function EmptyRow({
  text,
  cta,
}: {
  text: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-5 text-theme-sm text-gray-400 dark:text-gray-500">
      <span>{text}</span>
      {cta && (
        <Link href={cta.href} className="shrink-0 text-brand-500 dark:text-brand-400 hover:underline">
          {cta.label} →
        </Link>
      )}
    </div>
  );
}

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const future = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400000);
  if (days < 1) {
    const hrs = Math.floor(abs / 3600000);
    if (hrs <= 0) return "just now";
    return future ? `in ${hrs}h` : `${hrs}h ago`;
  }
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 14) return future ? `in ${days}d` : `${days}d ago`;
  return fmt(iso);
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
