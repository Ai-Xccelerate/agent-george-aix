import Link from "next/link";
import { checkOnboardingPreconditions } from "@/lib/agent/onboarding-preconditions";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import { resolvePolicies } from "@/lib/agent/operating-model";
import { OnboardButton } from "./_onboard-button";
import { notFound, redirect } from "next/navigation";
import {
  Archive,
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
  ArchiveCustomerButton,
  EditCustomerButton,
  UploadDocumentButton,
} from "./_forms";

export const dynamic = "force-dynamic";

/** A source_ref is only linkable when it is actually a row id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  /** Set means off the book. The detail page still loads it, so it can be restored. */
  archived_at: string | null;
};

type Observation = {
  id: string;
  summary: string;
  detail: string | null;
  source: string;
  category: string;
  observed_at: string;
  acknowledged_at: string | null;
  /** The row George read. A uuid for a transcript; free text otherwise. */
  source_ref: string | null;
  session_id: string | null;
};

/** One thing George read to write the narrative (migration 0009). */
type NarrativeSource = {
  kind: "email" | "transcript" | "meeting" | "observation" | "session";
  id: string;
  label: string;
};

/** How much there was to go on when the narrative was written. */
type NarrativeEvidence = {
  emails?: number;
  meetings?: number;
  transcripts?: number;
  observations?: number;
  days_covered?: number;
};

type Narrative = {
  id: string;
  body: string;
  sources: NarrativeSource[] | null;
  evidence: NarrativeEvidence | null;
  written_at: string;
  superseded_count: number;
  session_id: string | null;
};

/**
 * What is actually on file for this account, counted rather than asserted.
 *
 * The page uses it to keep a thin account looking thin. Two emails and no
 * meetings has to read as two emails and no meetings — a confident paragraph
 * over nothing is worse than an empty panel, because the reader cannot see
 * that it is over nothing.
 */
type OnFile = {
  transcripts: number;
  emails: number;
  observations: number;
  sessions: number;
  healthChecks: number;
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

  // Everything that depends only on (orgId, id) goes in this batch, including
  // the agent settings and the onboarding preconditions.
  //
  // Those two were sequential `await`s at the bottom of the page, which is what
  // made this render slow: preconditions is itself three round-trips deep, so
  // the page finished its own work and then waited on a fresh chain before it
  // could render anything. Neither reads a value from this batch — they only
  // need the org and the customer id, and both are known before it starts.
  //
  // Round-trip depth before: 9. After: 6. On a hosted database that is the
  // number that decides how the page feels; the query count barely moved.
  const [
    { data: customer },
    contactsRes,
    contractsRes,
    planRes,
    healthRes,
    agentSettings,
    onboarding,
    observationsRes,
    narrativeRes,
  ] = await Promise.all([
      supabase
        .from("customers")
        .select(
          "id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, notes, owner_user_id, created_at, updated_at, archived_at",
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
      getAgentSettings(supabase, user.orgId),
      checkOnboardingPreconditions(supabase, user.orgId, id),
      supabase
        .from("customer_observations")
        .select(
          "id, summary, detail, source, category, observed_at, acknowledged_at, source_ref, session_id",
        )
        .eq("customer_id", id)
        .eq("org_id", user.orgId)
        // observed_at, not created_at: a transcript synced today can describe
        // last week's call, and ordering by write time tells it out of order.
        .order("observed_at", { ascending: false })
        .limit(25),
      // The story of the account (migration 0009). One row, or none.
      supabase
        .from("customer_narrative")
        .select("id, body, sources, evidence, written_at, superseded_count, session_id")
        .eq("customer_id", id)
        .eq("org_id", user.orgId)
        .maybeSingle<Narrative>(),
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
    transcriptCountRes,
    emailCountRes,
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
    // What is on file, as counts. `head: true` so this is a count and not a
    // second copy of rows the page already has — it exists to let a thin
    // account look thin, not to render anything.
    supabase
      .from("meeting_transcripts")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .eq("org_id", user.orgId),
    supabase
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .eq("org_id", user.orgId),
  ]);

  const parent = parentRes.data ?? null;
  const endCustomers = (endCustomersRes.data ?? []) as RelatedCustomer[];
  // "End customers" is the reseller model: the buyer sells on to their own
  // customers. AIX sells direct, so the section is not merely empty for them,
  // it is meaningless — and a card reading "No end customers yet for this
  // partner" invites a question with no useful answer. Off unless the tenant
  // says they have a partner motion; some genuinely do.
  const partnerMotion =
    resolvePolicies(agentSettings.operating_policy).partner_motion === true;
  const cadence = cadenceRes.data ?? null;
  const objectives = (objectivesRes.data ?? []) as Objective[];
  const observations = (observationsRes.data ?? []) as Observation[];
  const narrative = narrativeRes.data ?? null;
  const owner = ownerRes.data ?? null;
  const sessions = (sessionsRes.data ?? []) as Session[];
  const activity = (activityRes.data ?? []) as Activity[];

  const onFile: OnFile = {
    transcripts: transcriptCountRes.count ?? 0,
    emails: emailCountRes.count ?? 0,
    observations: observations.length,
    sessions: sessions.length,
    healthChecks: (healthRes.data ?? []).length,
  };

  /**
   * Third and last wave. Everything here needs a value from batch 1 and nothing
   * from batch 2, so all three go together.
   *
   * They were three separate sequential awaits when first written — source
   * resolution, then escalations, then the approver lookup — which put the
   * page's round-trip depth back up to 8 from the 6 the batching above got it
   * to. Undoing a latency fix while working on a latency ticket is an easy
   * mistake to make and an invisible one to leave: every query here is a
   * fraction of a millisecond of server work, so nothing about it looks slow
   * locally, and the cost is one network round-trip each in front of the render.
   *
   * Depth is the number that decides how this page feels, not query count.
   * Three queries issued together cost one latency; issued in sequence, three.
   */
  const refIds = Array.from(
    new Set(
      [
        ...observations.map((o) => o.source_ref),
        ...((narrative?.sources ?? []).map((s) => s.id) as Array<string | null>),
      ].filter((v): v is string => Boolean(v) && UUID_RE.test(v!)),
    ),
  );

  const [titlesRes, escRes, approverRes] = await Promise.all([
    // Turn the raw ids George recorded into things a person can click.
    // `customer_observations.source_ref` and `customer_narrative.sources[].id`
    // both hold a bare row id; on this account they are meeting_transcripts
    // uuids, so they resolve to a real title and a real link — which is the
    // whole requirement, since a claim a human cannot trace is a claim they
    // cannot act on. Anything that does not resolve stays plain text rather
    // than becoming a link to nowhere: a dead link asserts a traceability it
    // does not have, which is worse than admitting the reference is loose.
    refIds.length > 0
      ? supabase
          .from("meeting_transcripts")
          .select("id, title, started_at")
          .in("id", refIds)
          .eq("org_id", user.orgId)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string | null; started_at: string | null }> }),
    // Open decisions George raised about this account. They surface here, on
    // the account, rather than in a cross-book queue — that queue is off.
    supabase
      .from("escalations")
      .select("id, title, urgency, session_id, created_at")
      .eq("customer_id", customer.id)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(10),
    // Who a decision goes to, by name. agent_settings.owner_user_id is George's
    // manager for the org — deliberately NOT the account owner in the stat
    // strip, which answers "whose relationship is this" rather than "who is
    // accountable for what George does". Those are often different people and
    // were being conflated. Named rather than left implicit, because an
    // escalation addressed to nobody in particular is how a queue forms.
    agentSettings.owner_user_id
      ? supabase
          .from("org_members")
          .select("full_name, email")
          .eq("org_id", user.orgId)
          .eq("user_id", agentSettings.owner_user_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { full_name: string | null; email: string | null } | null }),
  ]);

  const sourceTitles = new Map<string, string>();
  for (const t of (titlesRes.data ?? []) as Array<{
    id: string;
    title: string | null;
    started_at: string | null;
  }>) {
    sourceTitles.set(
      t.id,
      [t.title ?? "Transcript", t.started_at ? fmt(t.started_at) : null]
        .filter(Boolean)
        .join(" · "),
    );
  }

  const openDecisions = (escRes.data ?? []) as Array<{
    id: string;
    title: string;
    urgency: string;
    session_id: string | null;
    created_at: string;
  }>;

  const approverRow = approverRes.data as
    | { full_name: string | null; email: string | null }
    | null;
  const approver = approverRow?.full_name ?? approverRow?.email ?? null;

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
        {/* ── Left: the account.

              This was CSS multi-column masonry (`columns-2`), which balances
              height beautifully and has no way to express a minimum width. In
              a 1fr grid cell beside a 400px rail it produced ~200px columns,
              and cards wrapped to one or two words per line.

              auto-fit + minmax gives the thing masonry cannot: a floor. Cards
              are never narrower than 320px, and the track count drops to one
              when the cell cannot hold two. Rows are no longer height-balanced
              — a fair trade for text that can be read. ─────────────────── */}
        {/* ── The four questions, in the order they get asked ────────────────
              A person opening an account asks: what is the story, what
              changed, how are they doing and why, what is outstanding. The
              page used to answer the second and fourth and skip the first
              entirely, which left the reader assembling the story from a list
              of thirteen observations every time they visited.

              All four are READ-ONLY. Nothing in this column starts anything —
              decisions moved to the right rail. A surface that both tells you
              what George noticed and offers to act on it turns reading into
              triage, and triage is the queue this was meant to replace. ──── */}
        <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <NarrativeSection
            narrative={narrative}
            onFile={onFile}
            sourceTitles={sourceTitles}
            customerName={customer.name}
          />

          <ObservationsSection observations={observations} sourceTitles={sourceTitles} />

          <HealthSection history={healthHistory} onFile={onFile} />

          <OutstandingSection objectives={objectives} />

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
            partnerMotion={partnerMotion}
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
          {/* Decisions live here, not in the reading column, and not in a
              cross-book queue. The queue is switched off: George records what
              he notices on the account, and the few things that genuinely need
              a person answer to a named person rather than to a list. */}
          {openDecisions.length > 0 && (
            <Section
              title="Needs a decision"
              icon={<Bell size={14} className="text-brand-500 dark:text-brand-400" />}
              right={
                <span className="text-theme-xs text-gray-400 dark:text-gray-500">
                  {openDecisions.length}
                </span>
              }
            >
              {approver && (
                <p className="mb-2 text-theme-xs text-gray-400 dark:text-gray-500">
                  Goes to {approver} first.
                </p>
              )}
              <ul className="space-y-1.5">
                {openDecisions.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    {d.session_id ? (
                      <Link href={`/chat/${d.session_id}`} className="min-w-0 flex-1">
                        <DecisionTitle title={d.title} urgency={d.urgency} />
                      </Link>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <DecisionTitle title={d.title} urgency={d.urgency} />
                      </div>
                    )}
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
          <AccountConversations
            customerId={customer.id}
            customerName={customer.name}
            sessions={sessions}
          />
          <ActivitySection activity={activity} />
          {openObjectives.length === 0 && objectives.length === 0 && (
            <p className="px-1 text-theme-xs leading-relaxed text-gray-400 dark:text-gray-500">
              George works this account on his own — reading email, meetings and
              transcripts, and recording what he notices here for{" "}
              {approver ?? owner?.full_name ?? "the account owner"} to read. He does not
              raise work; you decide whether any of it needs doing.
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
      {/* An archived account looks exactly like a live one from here, and the
          difference is that George has stopped working it. Say so, or somebody
          waits on follow-ups that are never coming. */}
      {customer.archived_at ? (
        <div className="flex items-center gap-2 rounded-t-3xl border-b border-warning-500/30 bg-warning-50 dark:bg-warning-500/10 px-6 py-3 text-theme-sm text-warning-600 dark:text-warning-400">
          <Archive size={14} />
          <span>
            Archived on {new Date(customer.archived_at).toLocaleDateString()}. George is not
            working this account — no follow-ups, no health checks, no decisions.
          </span>
        </div>
      ) : null}
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
          <ArchiveCustomerButton
            customerId={customer.id}
            customerName={customer.name}
            archived={Boolean(customer.archived_at)}
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

// ── 1. What's the story on this account right now? ───────────────────────────
/**
 * The narrative. Was missing entirely, and it is the question people actually
 * open an account to answer.
 *
 * Three rules the panel enforces rather than hopes for:
 *
 * REWRITTEN, NOT APPENDED. One row per customer (unique index in 0009), so
 * there is nothing here to grow. The rewrite count is shown because an account
 * whose story has been redrawn eleven times is a different kind of account from
 * one written once, and that is the only thing worth keeping from the versions
 * that are gone.
 *
 * SOURCES OR IT SAYS SO. Every citation renders as a chip, linked where the id
 * resolves. A narrative with none renders an explicit line saying it cites
 * nothing — not silence. Silence reads as "no sources needed".
 *
 * THIN LOOKS THIN. The evidence line is what stops a confident paragraph over
 * two emails from looking like a confident paragraph over forty. When there is
 * no narrative at all, the empty state says what IS on file, so the reader can
 * see whether the gap is George's or the account's.
 */
function NarrativeSection({
  narrative,
  onFile,
  sourceTitles,
  customerName,
}: {
  narrative: Narrative | null;
  onFile: OnFile;
  sourceTitles: Map<string, string>;
  customerName: string;
}) {
  const sources = narrative?.sources ?? [];
  const nothingOnFile =
    onFile.transcripts === 0 &&
    onFile.emails === 0 &&
    onFile.observations === 0 &&
    onFile.sessions === 0;

  return (
    <Section
      title="Where this account stands"
      icon={<Sparkles size={14} className="text-brand-500 dark:text-brand-400" />}
      right={
        narrative ? (
          <span className="text-theme-xs text-gray-400 dark:text-gray-500">
            {timeAgo(narrative.written_at)}
          </span>
        ) : null
      }
    >
      {!narrative ? (
        <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-800 p-3">
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            George has not written the story of this account yet.
          </p>
          <p className="mt-1.5 text-theme-xs leading-relaxed text-gray-400 dark:text-gray-500">
            {nothingOnFile
              ? `Nothing on file for ${customerName} — no email, no meetings, no transcripts. There is nothing to summarise, which is itself the honest answer.`
              : `On file: ${describeOnFile(onFile)}. He writes this once he has read enough to have a view.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-theme-sm leading-relaxed text-gray-800 dark:text-white/90">
            {narrative.body}
          </p>

          {/* How much this was built on. Deliberately adjacent to the prose:
              read apart from the evidence, every narrative reads equally
              confident. */}
          <p className="text-theme-xs text-gray-400 dark:text-gray-500">
            {narrative.evidence && Object.keys(narrative.evidence).length > 0
              ? `Written from ${describeEvidence(narrative.evidence)}.`
              : `On file now: ${describeOnFile(onFile)}.`}
            {narrative.superseded_count > 0 && (
              <> Rewritten {narrative.superseded_count}×.</>
            )}
          </p>

          {sources.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s, i) => (
                <SourceChip
                  key={`${s.kind}:${s.id}:${i}`}
                  kind={s.kind}
                  id={s.id}
                  label={s.label}
                  resolved={sourceTitles.get(s.id) ?? null}
                />
              ))}
            </div>
          ) : (
            /* Not a missing feature — a stated one. An uncited synthesis is the
               least checkable claim on the page and must not pass silently. */
            <p className="flex items-start gap-1.5 text-theme-xs text-warning-600 dark:text-warning-400">
              <Flag size={11} className="mt-0.5 shrink-0" />
              This cites no source, so none of it can be traced back to something
              a person can read.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

// ── 2. What changed recently? ────────────────────────────────────────────────
/**
 * The observation feed, ordered by when the thing happened rather than when the
 * row was written — a transcript synced today can describe last week's call.
 *
 * Read-only. There is no acknowledge control and no resolve button: the "new"
 * count is there to show what has arrived since you last looked, not to be
 * cleared. Give this surface a button and it becomes the queue again.
 */
function ObservationsSection({
  observations,
  sourceTitles,
}: {
  observations: Observation[];
  sourceTitles: Map<string, string>;
}) {
  const unread = observations.filter((o) => !o.acknowledged_at).length;

  return (
    <Section
      title="What changed recently"
      icon={<Clock size={14} className="text-brand-500 dark:text-brand-400" />}
      right={
        unread > 0 ? (
          <span className="rounded-full bg-brand-50 dark:bg-brand-500/15 px-2 py-0.5 text-theme-xs font-medium text-brand-500 dark:text-brand-400">
            {unread} new
          </span>
        ) : null
      }
    >
      {observations.length === 0 ? (
        <EmptyRow text="Nothing recorded yet. George adds what he picks up from email, meetings and transcripts as it comes in." />
      ) : (
        <ul className="space-y-2">
          {observations.map((o) => (
            <ObservationRow key={o.id} observation={o} sourceTitles={sourceTitles} />
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── 3. How are they doing, and why? ──────────────────────────────────────────
/**
 * Band, score, and — new here — the REASON.
 *
 * `customer_health.reason` was being selected by this page and then never
 * rendered. So the account showed a red badge with no account of why it was
 * red, which is the least useful possible version of a health signal: it asks
 * for a reaction and withholds the grounds for one.
 *
 * The previous two checks are shown underneath, because "red" and "red, down
 * from green last week" are different situations and the badge cannot tell them
 * apart on its own.
 */
function HealthSection({ history, onFile }: { history: Health[]; onFile: OnFile }) {
  const latest = history[0] ?? null;
  const earlier = history.slice(1, 3);

  return (
    <Section
      title="How they're doing"
      icon={<Star size={14} className="text-brand-500 dark:text-brand-400" />}
      right={
        latest ? (
          <span className="text-theme-xs text-gray-400 dark:text-gray-500">
            {timeAgo(latest.measured_at)}
          </span>
        ) : null
      }
    >
      {!latest ? (
        <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-800 p-3">
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            No health check on record.
          </p>
          <p className="mt-1.5 text-theme-xs leading-relaxed text-gray-400 dark:text-gray-500">
            {onFile.transcripts === 0 && onFile.emails === 0
              ? "There is no contact history to judge from yet."
              : "George has not scored this account. The stage badge is not a health signal — it says where onboarding is, not how it is going."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <HealthBadge band={latest.band} />
            {latest.score != null && (
              <span className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                {latest.score}
              </span>
            )}
          </div>

          {latest.reason ? (
            <p className="text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
              {latest.reason}
            </p>
          ) : (
            <p className="text-theme-xs text-gray-400 dark:text-gray-500">
              No reason was recorded with this score, so the band cannot be traced
              to anything.
            </p>
          )}

          {earlier.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-800 pt-2">
              <div className="mb-1.5 text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Before
              </div>
              <ul className="space-y-1">
                {earlier.map((h) => (
                  <li
                    key={h.id}
                    className="flex items-center gap-2 text-theme-xs text-gray-400 dark:text-gray-500"
                  >
                    <HealthBadge band={h.band} />
                    <span>{fmt(h.measured_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── 4. What's outstanding, on either side? ───────────────────────────────────
/**
 * Split by who owes it, because "on either side" is the question and a single
 * merged list cannot answer it without the reader checking each row's label.
 *
 * Objectives are shown as observed state, not as a worklist George is driving.
 * The follow-up counters stay — they are facts about what George has already
 * done — but nothing here starts, stops or reassigns anything.
 */
function OutstandingSection({ objectives }: { objectives: Objective[] }) {
  const live = objectives.filter((o) => o.status !== "achieved" && o.status !== "cancelled");
  const ours = live.filter((o) => o.responsible_side === "onyx");
  const theirs = live.filter((o) => o.responsible_side === "customer");
  const done = objectives.filter((o) => o.status === "achieved");

  return (
    <Section
      title="What's outstanding"
      icon={<Target size={14} className="text-brand-500 dark:text-brand-400" />}
      right={
        objectives.length > 0 ? (
          <span className="text-theme-xs text-gray-400 dark:text-gray-500">
            {done.length}/{objectives.length} done
          </span>
        ) : null
      }
    >
      {live.length === 0 ? (
        <EmptyRow
          text={
            objectives.length === 0
              ? "Nothing outstanding on either side."
              : "Nothing outstanding — everything on record is done."
          }
        />
      ) : (
        <div className="space-y-4">
          {ours.length > 0 && (
            <SideGroup label="We owe them" objectives={ours} />
          )}
          {theirs.length > 0 && (
            <SideGroup label="They owe us" objectives={theirs} />
          )}
        </div>
      )}
    </Section>
  );
}

function SideGroup({ label, objectives }: { label: string; objectives: Objective[] }) {
  return (
    <div>
      <div className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label} ({objectives.length})
      </div>
      <ul className="space-y-2">
        {objectives.map((o) => (
          <ObjectiveRow key={o.id} objective={o} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One citation. A link when the id resolves to a row we can open, plain text
 * when it does not — a link to nowhere claims a traceability it lacks.
 */
function SourceChip({
  kind,
  id,
  label,
  resolved,
}: {
  kind: NarrativeSource["kind"];
  id: string;
  label: string;
  resolved: string | null;
}) {
  const text = resolved ?? label;
  const href =
    kind === "transcript" && resolved
      ? `/transcripts/${id}`
      : kind === "email"
        ? `/mailbox/${id}`
        : kind === "session"
          ? `/chat/${id}`
          : null;

  const body = (
    <>
      <FileText size={10} className="shrink-0" />
      <span className="truncate">{text}</span>
    </>
  );

  const base =
    "inline-flex max-w-[240px] items-center gap-1 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-1.5 py-0.5 text-theme-xs text-gray-500 dark:text-gray-400";

  return href ? (
    <Link href={href} className={`${base} hover:text-brand-500 dark:hover:text-brand-400`}>
      {body}
    </Link>
  ) : (
    <span className={base} title={id}>
      {body}
    </span>
  );
}

function DecisionTitle({ title, urgency }: { title: string; urgency: string }) {
  return (
    <div className="flex items-center gap-2">
      {urgency === "high" && (
        <span className="shrink-0 rounded-full bg-error-500/15 px-1.5 py-0.5 text-theme-xs font-medium uppercase tracking-wide text-error-500">
          high
        </span>
      )}
      <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {title}
      </span>
    </div>
  );
}

/** "10 transcripts, 12 emails and 13 observations" — or "nothing". */
function describeOnFile(f: OnFile): string {
  const parts = [
    f.transcripts ? `${f.transcripts} transcript${f.transcripts === 1 ? "" : "s"}` : null,
    f.emails ? `${f.emails} email${f.emails === 1 ? "" : "s"}` : null,
    f.observations
      ? `${f.observations} observation${f.observations === 1 ? "" : "s"}`
      : null,
    f.sessions ? `${f.sessions} conversation${f.sessions === 1 ? "" : "s"}` : null,
  ].filter((v): v is string => Boolean(v));
  return joinList(parts) || "nothing";
}

function describeEvidence(e: NarrativeEvidence): string {
  const parts = [
    e.transcripts ? `${e.transcripts} transcript${e.transcripts === 1 ? "" : "s"}` : null,
    e.meetings ? `${e.meetings} meeting${e.meetings === 1 ? "" : "s"}` : null,
    e.emails ? `${e.emails} email${e.emails === 1 ? "" : "s"}` : null,
    e.observations
      ? `${e.observations} observation${e.observations === 1 ? "" : "s"}`
      : null,
  ].filter((v): v is string => Boolean(v));
  const base = joinList(parts) || "no cited evidence";
  return e.days_covered ? `${base}, covering ${e.days_covered} days` : base;
}

function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const OBSERVATION_TONE: Record<string, string> = {
  risk: "text-warning-500 dark:text-warning-400",
  progress: "text-success-500 dark:text-success-400",
  commercial: "text-brand-500 dark:text-brand-400",
  relationship: "text-gray-500 dark:text-gray-400",
  product: "text-gray-500 dark:text-gray-400",
  other: "text-gray-500 dark:text-gray-400",
};

function ObservationRow({
  observation: o,
  sourceTitles,
}: {
  observation: Observation;
  sourceTitles: Map<string, string>;
}) {
  // The thing George read, when we can name it. `source_ref` holds a bare row
  // id; resolved means it is a transcript we can open.
  const resolved = o.source_ref ? sourceTitles.get(o.source_ref) ?? null : null;
  // A scan is George reasoning over the account record — there is no document
  // behind it, and saying "from scan" without saying that invites the reader to
  // go looking for one.
  const isInference = o.source === "scan";

  return (
    <li className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3">
      <div className="flex items-start gap-2">
        <span className={`mt-1 shrink-0 ${OBSERVATION_TONE[o.category] ?? OBSERVATION_TONE.other}`}>
          <Circle size={7} fill="currentColor" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-theme-sm text-gray-800 dark:text-white/90">{o.summary}</p>
          {o.detail && (
            <p className="mt-1 text-theme-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {o.detail}
            </p>
          )}
          {/* Where it came from, because an inference and a quotation are
              different kinds of claim and the reader has to tell them apart —
              and because a claim nobody can trace is a claim nobody can act on.
              Named and linked where the id resolves; named as an inference
              where there is nothing to link to. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-theme-xs text-gray-400 dark:text-gray-500">
            <span className="capitalize">{o.category}</span>
            <span aria-hidden>·</span>
            {resolved && o.source_ref ? (
              <Link
                href={`/transcripts/${o.source_ref}`}
                className="inline-flex max-w-[220px] items-center gap-1 truncate hover:text-brand-500 dark:hover:text-brand-400"
              >
                <FileText size={10} className="shrink-0" />
                <span className="truncate">{resolved}</span>
              </Link>
            ) : isInference ? (
              <span title="George worked this out from the account record — there is no document behind it.">
                George&apos;s inference
              </span>
            ) : o.session_id ? (
              <Link
                href={`/chat/${o.session_id}`}
                className="hover:text-brand-500 dark:hover:text-brand-400"
              >
                from {o.source}
              </Link>
            ) : (
              <span>from {o.source}</span>
            )}
            <span aria-hidden>·</span>
            <span>{new Date(o.observed_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </li>
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
  partnerMotion,
}: {
  customer: Customer;
  parent: RelatedCustomer | null;
  endCustomers: RelatedCustomer[];
  partnerMotion: boolean;
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

  // Nothing to say to a direct-sales tenant. Returning null rather than an
  // empty card: an empty card still asks the reader to work out whether it
  // matters to them.
  if (!partnerMotion && endCustomers.length === 0) return null;

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
      {/*
        Visible at rest, not only on hover.

        This was `opacity-0 group-hover:opacity-100`, and it is the only way to
        edit a contact — so on a touchscreen, or for anyone who did not happen
        to hover, there was no way to change a contact at all. It also had no
        focus state, so tabbing to it left it invisible while still clickable.

        An affordance you cannot see is not an affordance. Muted at rest keeps
        the card calm; hover and keyboard focus both bring it up.
      */}
      <div className="absolute right-2 top-2 opacity-45 transition group-hover:opacity-100 focus-within:opacity-100">
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
            {/* shrink-0: without it a long name compresses the star to nothing,
                and "who is the primary contact" silently stops being answerable.
                "Gustavo Ernesto Gilio Alatorre" is 30 characters and real. */}
            {contact.is_primary && (
              <Star
                size={11}
                className="shrink-0 text-brand-500 dark:text-brand-400"
                aria-label="primary"
              />
            )}
          </div>
          <div className="truncate text-theme-xs text-gray-400 dark:text-gray-500">
            {contact.title ?? "—"}
          </div>
          <div className="mt-1 space-y-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
            {/*
              `flex` with the text in its own `truncate` span, not `inline-flex
              truncate` on the link.

              `text-overflow: ellipsis` needs a block box with a constrained
              width. On an inline-flex element it does nothing at all — the
              address simply runs past the edge of the card. It looked like a
              truncation rule was in place, which is why this survived a layout
              pass: the class was there and had never once applied.

              `mondellopromotional.com` addresses are 36-39 characters against a
              text column around 200px wide, so this is the common case here,
              not an edge case.
            */}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                title={contact.email}
                className="flex min-w-0 items-center gap-1 hover:text-brand-500 dark:hover:text-brand-400"
              >
                <Mail size={10} className="shrink-0" />
                <span className="truncate">{contact.email}</span>
              </a>
            )}
            {contact.phone && (
              <div className="flex min-w-0 items-center gap-1">
                <Phone size={10} className="shrink-0" />
                <span className="truncate">{contact.phone}</span>
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
    // Stacked, not justify-between. Side by side, the CTA was shrink-0 and the
    // text had no floor, so in a narrow card the sentence collapsed to one or
    // two words per line while the link kept its full width.
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-5 text-theme-sm text-gray-400 dark:text-gray-500">
      <span className="text-pretty">{text}</span>
      {cta && (
        <Link href={cta.href} className="font-medium text-brand-500 dark:text-brand-400 hover:underline">
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
