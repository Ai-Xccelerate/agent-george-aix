import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Heart,
  ListChecks,
  Mail,
  MessageSquare,
  Network,
  Phone,
  Repeat,
  Star,
  Users,
} from "lucide-react";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  HealthBadge,
  KindBadge,
  LifecycleBadge,
  StepStatusBadge,
} from "@/components/ui/badge";
import { initials } from "@/lib/utils";
import { CustomerTabs, type CustomerTabSpec } from "./_tabs";
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

export default async function CustomerPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServer();

  const [{ data: customer }, contactsRes, contractsRes, planRes, healthRes] =
    await Promise.all([
      supabase
        .from("customers")
        .select(
          "id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, notes, created_at, updated_at",
        )
        .eq("id", id)
        .maybeSingle<Customer>(),
      supabase
        .from("contacts")
        .select("id, full_name, email, title, phone, is_primary, timezone")
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

  const [parentRes, endCustomersRes, cadenceRes, docsRes] = await Promise.all([
    customer.parent_customer_id
      ? supabase
          .from("customers")
          .select("id, name, domain, customer_kind")
          .eq("id", customer.parent_customer_id)
          .maybeSingle<RelatedCustomer>()
      : Promise.resolve({ data: null as RelatedCustomer | null }),
    customer.customer_kind === "partner"
      ? supabase
          .from("customers")
          .select("id, name, domain, lifecycle, updated_at")
          .eq("parent_customer_id", customer.id)
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
      .select(
        "id, original_name, mime_type, file_size, created_at, uploaded_by",
      )
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const parent = parentRes.data ?? null;
  const endCustomers = (endCustomersRes.data ?? []) as RelatedCustomer[];
  const cadence = cadenceRes.data ?? null;

  const docsRaw = (docsRes.data ?? []) as Array<{
    id: string;
    original_name: string;
    mime_type: string;
    file_size: number;
    created_at: string;
    uploaded_by: string | null;
  }>;
  // Resolve uploader names in one query so the list doesn't N+1.
  const uploaderIds = Array.from(
    new Set(docsRaw.map((d) => d.uploaded_by).filter((v): v is string => !!v)),
  );
  const uploaders = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const usersRes = await supabase
      .from("org_members")
      .select("user_id, full_name, email")
      .in("user_id", uploaderIds);
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
  const primary = contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
  const contracts = (contractsRes.data ?? []) as Contract[];
  const activeContract = contracts.find((c) => c.status === "active" || c.status === "signed") ?? contracts[0] ?? null;
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

  const isPartner = customer.customer_kind === "partner";

  const tabs: CustomerTabSpec[] = [
    {
      id: "overview",
      label: "Overview",
      icon: "overview",
      panel: (
        <OverviewPanel
          customer={customer}
          primary={primary}
          contactsCount={contacts.length}
          latestHealth={latestHealth}
          healthHistory={healthHistory}
          activeContract={activeContract}
          plan={plan}
          steps={steps}
          progress={progress}
          nextDueStep={nextDueStep}
          cadence={cadence}
        />
      ),
    },
    {
      id: "onboarding",
      label: "Onboarding",
      icon: "onboarding",
      badge: plan && steps.length > 0 ? `${progress}%` : null,
      panel: (
        <Section
          title="Onboarding plan"
          right={
            plan ? (
              <span className="text-[12px] text-[var(--color-fg-muted)]">
                {progress}% complete · {steps.length} step{steps.length === 1 ? "" : "s"}
              </span>
            ) : null
          }
        >
          {plan ? (
            <PlanBlock plan={plan} steps={steps} progress={progress} />
          ) : (
            <EmptyRow
              text="No active onboarding plan."
              cta={{ label: "Ask George to plan it", href: "/chat" }}
            />
          )}
        </Section>
      ),
    },
    {
      id: "cadence",
      label: "Cadence",
      icon: "cadence",
      panel: (
        <Section title="Cadence">
          {cadence ? (
            <CadenceBlock cadence={cadence} />
          ) : (
            <EmptyRow
              text="No recurring cadence set."
              cta={{ label: "Ask George to set one", href: "/chat" }}
            />
          )}
        </Section>
      ),
    },
    {
      id: "hierarchy",
      label: isPartner ? "End customers" : "Partner",
      icon: "hierarchy",
      badge: isPartner ? endCustomers.length : null,
      panel: (
        <HierarchySection
          customer={customer}
          parent={parent}
          endCustomers={endCustomers}
        />
      ),
    },
    {
      id: "contacts",
      label: "Contacts",
      icon: "contacts",
      badge: contacts.length,
      panel: (
        <Section
          title={`Contacts (${contacts.length})`}
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {contacts.map((c) => (
                <ContactCard key={c.id} contact={c} />
              ))}
            </div>
          )}
        </Section>
      ),
    },
    {
      id: "documents",
      label: "Documents",
      icon: "documents",
      badge: docs.length || null,
      panel: <DocumentsPanel customerId={customer.id} docs={docs} />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft size={14} />
        All channel partners
      </Link>

      <HeaderCard
        customer={customer}
        primary={primary}
        latestHealth={latestHealth}
        contactsCount={contacts.length}
      />

      <CustomerTabs tabs={tabs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview panel — the "dashboard" view, intentionally compact. Full detail
// for each domain lives in its dedicated tab.
// ---------------------------------------------------------------------------
function OverviewPanel({
  customer,
  primary,
  contactsCount,
  latestHealth,
  healthHistory,
  activeContract,
  plan,
  steps,
  progress,
  nextDueStep,
  cadence,
}: {
  customer: Customer;
  primary: Contact | null;
  contactsCount: number;
  latestHealth: Health | null;
  healthHistory: Health[];
  activeContract: Contract | null;
  plan: Plan | null | undefined;
  steps: Step[];
  progress: number;
  nextDueStep: Step | null;
  cadence: Cadence | null;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Health" icon={<Heart size={14} className="text-[var(--color-accent)]" />}>
          {latestHealth ? (
            <HealthBlock health={latestHealth} history={healthHistory} />
          ) : (
            <EmptyRow text="No health checks yet." />
          )}
        </Section>

        <Section title="Contract" icon={<FileText size={14} className="text-[var(--color-accent)]" />}>
          {activeContract ? (
            <ContractRow contract={activeContract} />
          ) : (
            <EmptyRow text="No contract on file yet." />
          )}
        </Section>

        <Section title="Onboarding" icon={<ListChecks size={14} className="text-[var(--color-accent)]" />}>
          {plan ? (
            <OnboardingSummary
              plan={plan}
              progress={progress}
              stepsTotal={steps.length}
              nextDueStep={nextDueStep}
            />
          ) : (
            <EmptyRow
              text="No active onboarding plan."
              cta={{ label: "Ask George to plan it", href: "/chat" }}
            />
          )}
        </Section>

        <Section title="Cadence" icon={<Repeat size={14} className="text-[var(--color-accent)]" />}>
          {cadence ? (
            <CadenceSummary cadence={cadence} />
          ) : (
            <EmptyRow
              text="No recurring cadence set."
              cta={{ label: "Ask George to set one", href: "/chat" }}
            />
          )}
        </Section>
      </div>

      <Section
        title={`Contacts (${contactsCount})`}
        icon={<Users size={14} className="text-[var(--color-accent)]" />}
      >
        {primary ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <ContactCard contact={primary} />
            </div>
            {contactsCount > 1 && (
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                {contactsCount - 1} more contact{contactsCount - 1 === 1 ? "" : "s"} —
                see the <strong>Contacts</strong> tab.
              </p>
            )}
          </div>
        ) : (
          <EmptyRow text="No contacts yet." />
        )}
      </Section>

      {customer.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-fg-secondary)]">
            {customer.notes}
          </p>
        </Section>
      )}
    </div>
  );
}

function OnboardingSummary({
  plan,
  progress,
  stepsTotal,
  nextDueStep,
}: {
  plan: Plan;
  progress: number;
  stepsTotal: number;
  nextDueStep: Step | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[20px] font-bold text-[var(--color-fg)]">{progress}%</span>
        <span className="text-[12px] text-[var(--color-fg-muted)]">
          complete · {stepsTotal} step{stepsTotal === 1 ? "" : "s"} · {plan.pace ?? "no pace"}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full brand-gradient transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      {nextDueStep ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <StepStatusBadge value={nextDueStep.status} />
            <span className="text-[13px] font-medium text-[var(--color-fg)]">
              {nextDueStep.title}
            </span>
          </div>
          {nextDueStep.due_date && (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-muted)]">
              <CalendarClock size={10} />
              due {fmt(nextDueStep.due_date)}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[12px] text-[var(--color-fg-muted)]">
          No step in progress. All caught up.
        </div>
      )}
    </div>
  );
}

function CadenceSummary({ cadence }: { cadence: Cadence }) {
  const cadenceLabel: Record<Cadence["frequency"], string> = {
    weekly: "Weekly",
    biweekly: "Biweekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    ad_hoc: "Ad hoc",
  };
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-light)] px-2.5 py-[3px] text-[12px] font-medium text-[var(--color-accent)]">
          <Repeat size={11} /> {cadenceLabel[cadence.frequency]}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
            Next
          </div>
          <div className="mt-0.5 font-medium text-[var(--color-fg)]">
            {cadence.next_meeting_at ? fmt(cadence.next_meeting_at) : "—"}
          </div>
          {cadence.next_meeting_at && (
            <div className="text-[11px] text-[var(--color-fg-muted)]">
              {timeAgo(cadence.next_meeting_at)}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
            Last met
          </div>
          <div className="mt-0.5 font-medium text-[var(--color-fg)]">
            {cadence.last_met_at ? fmt(cadence.last_met_at) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents tab — placeholder until backlog #19 (file upload) and #18
// (contract parsing) land. Once those ship, this surfaces the customer's
// documents table.
// ---------------------------------------------------------------------------
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
      icon={<FileText size={14} className="text-[var(--color-accent)]" />}
      right={<UploadDocumentButton customerId={customerId} />}
    >
      {docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <FileText size={20} />
          </div>
          <h3 className="text-[15px] font-semibold text-[var(--color-fg)]">
            No documents yet
          </h3>
          <p className="max-w-[480px] text-[13px] text-[var(--color-fg-secondary)]">
            Upload a contract, NDA, or order form here — or drop it into chat
            and George will file it for this customer. PDFs, images, Office
            docs, plain text up to 10 MB.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <UploadDocumentButton customerId={customerId} />
            <Link
              href="/chat"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
            >
              <MessageSquare size={13} />
              Or drop in chat
            </Link>
          </div>
        </div>
      ) : (
        <DocumentList docs={docs} />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Hierarchy panel — for a partner shows the end-customer list; for an end-
// customer shows the parent partner.
// ---------------------------------------------------------------------------
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
        icon={<Network size={14} className="text-[var(--color-accent)]" />}
      >
        {parent ? (
          <Link
            href={`/customers/${parent.id}`}
            className="flex items-center gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 hover:bg-[var(--color-surface-2)]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-accent-light)] text-[var(--color-accent)]">
              <Building2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-[var(--color-fg)]">
                  {parent.name}
                </span>
                <KindBadge kind="partner" />
              </div>
              {parent.domain && (
                <div className="text-[12px] text-[var(--color-fg-muted)]">{parent.domain}</div>
              )}
            </div>
            <ArrowLeft size={14} className="rotate-180 text-[var(--color-fg-muted)]" />
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
      icon={<Network size={14} className="text-[var(--color-accent)]" />}
      right={
        <AddEndCustomerButton parentId={customer.id} parentName={customer.name} />
      }
    >
      {endCustomers.length === 0 ? (
        <EmptyRow text="No end customers yet for this partner." />
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {endCustomers.map((ec) => (
            <li key={ec.id}>
              <Link
                href={`/customers/${ec.id}`}
                className="flex items-center gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 hover:bg-[var(--color-surface-2)]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                  <Building2 size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--color-fg)]">
                    {ec.name}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
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

// ---------------------------------------------------------------------------
// Header (unchanged — sits above the tab strip)
// ---------------------------------------------------------------------------
function HeaderCard({
  customer,
  primary,
  latestHealth,
  contactsCount,
}: {
  customer: Customer;
  primary: Contact | null;
  latestHealth: Health | null;
  contactsCount: number;
}) {
  return (
    <div className="rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-6">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <Building2 size={22} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[24px] font-bold leading-tight text-[var(--color-fg)]">
                {customer.name}
              </h1>
              <KindBadge kind={customer.customer_kind} />
              <LifecycleBadge value={customer.lifecycle} />
              {latestHealth && <HealthBadge band={latestHealth.band} />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-fg-secondary)]">
              {customer.domain && (
                <a
                  href={`https://${customer.domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 hover:text-[var(--color-accent)]"
                >
                  {customer.domain}
                  <ExternalLink size={11} />
                </a>
              )}
              {customer.industry && <span>{customer.industry}</span>}
              {customer.size && <span>{customer.size}</span>}
              <span>
                <Users size={11} className="mr-1 inline" />
                {contactsCount} contact{contactsCount === 1 ? "" : "s"}
              </span>
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
          <Link
            href={`/chat?customer=${customer.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            <MessageSquare size={14} />
            Ask George
          </Link>
        </div>
      </div>

      {primary && (
        <div className="mt-5 flex items-center gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-[12px] font-semibold text-[var(--color-fg-inverse)]">
            {initials(primary.full_name)}
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-fg)]">
              {primary.full_name}
              <Star size={11} className="text-[var(--color-accent)]" />
              <span className="text-[11px] font-normal text-[var(--color-fg-muted)]">primary</span>
            </div>
            <div className="text-[12px] text-[var(--color-fg-secondary)]">
              {primary.title ?? "—"} · {primary.email ?? "no email"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared cells (unchanged from the pre-tab layout)
// ---------------------------------------------------------------------------
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
      className={`rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5 ${className ?? ""}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-fg)]">
          {icon}
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function ContractRow({ contract }: { contract: Contract }) {
  return (
    <div className="grid grid-cols-2 gap-4 text-[13px] md:grid-cols-4">
      <KV label="Status" value={contract.status.replace("_", " ")} />
      <KV
        label="ARR"
        value={
          contract.arr_cents != null
            ? formatMoney(contract.arr_cents, contract.currency ?? "USD")
            : "—"
        }
      />
      <KV label="Start" value={fmt(contract.start_date)} />
      <KV label="End" value={fmt(contract.end_date)} />
      {contract.summary && (
        <div className="col-span-2 mt-1 rounded-md bg-[var(--color-surface-2)] p-3 text-[12px] text-[var(--color-fg-secondary)] md:col-span-4">
          {contract.summary}
        </div>
      )}
    </div>
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
  const channelLabel: Record<Cadence["channel"], string> = {
    call: "Call",
    in_person: "In person",
    email: "Email",
    async: "Async",
  };
  const dayText =
    cadence.day_of_week != null ? DAY_NAMES[cadence.day_of_week] : null;
  const timeText = cadence.time_of_day ? cadence.time_of_day.slice(0, 5) : null;
  const tzText = cadence.timezone ? ` ${cadence.timezone}` : "";
  const slotLine =
    cadence.frequency === "ad_hoc"
      ? "No fixed slot"
      : [dayText, timeText && `at ${timeText}${tzText}`]
          .filter(Boolean)
          .join(" ") || "Day/time not set";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-light)] px-2.5 py-[3px] text-[12px] font-medium text-[var(--color-accent)]">
          <Repeat size={11} /> {cadenceLabel[cadence.frequency]}
        </div>
        <span className="text-[13px] text-[var(--color-fg-secondary)]">{slotLine}</span>
        <span className="text-[12px] text-[var(--color-fg-muted)]">
          · {channelLabel[cadence.channel]}
          {cadence.duration_min ? ` · ${cadence.duration_min} min` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 text-[13px]">
        <KV
          label="Next meeting"
          value={
            cadence.next_meeting_at ? (
              <span>
                {fmt(cadence.next_meeting_at)}{" "}
                <span className="text-[11px] text-[var(--color-fg-muted)]">
                  · {timeAgo(cadence.next_meeting_at)}
                </span>
              </span>
            ) : (
              "—"
            )
          }
        />
        <KV
          label="Last met"
          value={
            cadence.last_met_at ? (
              <span>
                {fmt(cadence.last_met_at)}{" "}
                <span className="text-[11px] text-[var(--color-fg-muted)]">
                  · {timeAgo(cadence.last_met_at)}
                </span>
              </span>
            ) : (
              "—"
            )
          }
        />
      </div>

      {cadence.notes && (
        <p className="whitespace-pre-wrap rounded-md bg-[var(--color-surface-2)] p-3 text-[12px] text-[var(--color-fg-secondary)]">
          {cadence.notes}
        </p>
      )}
    </div>
  );
}

function HealthBlock({ health, history }: { health: Health; history: Health[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <HealthBadge band={health.band} />
        {health.score != null && (
          <span className="text-[13px] font-semibold text-[var(--color-fg)]">
            {health.score}/100
          </span>
        )}
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {timeAgo(health.measured_at)}
        </span>
      </div>
      {health.reason && (
        <p className="text-[12px] leading-relaxed text-[var(--color-fg-secondary)]">
          {health.reason}
        </p>
      )}
      {history.length > 1 && (
        <details className="text-[12px] text-[var(--color-fg-muted)]">
          <summary className="cursor-pointer hover:text-[var(--color-fg)]">
            Show {history.length - 1} earlier check{history.length - 1 === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1">
            {history.slice(1).map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <HealthBadge band={h.band} />
                <span>{fmt(h.measured_at)}</span>
                {h.reason && <span className="truncate">— {h.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PlanBlock({ plan, steps, progress }: { plan: Plan; steps: Step[]; progress: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-[13px] md:grid-cols-4">
        <KV label="Status" value={plan.status.replace("_", " ")} />
        <KV label="Pace" value={plan.pace ?? "—"} />
        <KV label="Start" value={fmt(plan.start_date)} />
        <KV label="Target end" value={fmt(plan.target_end_date)} />
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full brand-gradient transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li
            key={s.id}
            className="flex items-start gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
          >
            <StepIcon status={s.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-[var(--color-fg-muted)]">
                  Step {s.ordinal}
                </span>
                <span className="text-[14px] font-medium text-[var(--color-fg)]">
                  {s.title}
                </span>
                <StepStatusBadge value={s.status} />
              </div>
              {s.description && (
                <p className="mt-1 text-[12px] text-[var(--color-fg-secondary)]">
                  {s.description}
                </p>
              )}
              <div className="mt-1 flex gap-3 text-[11px] text-[var(--color-fg-muted)]">
                {s.due_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock size={10} /> due {fmt(s.due_date)}
                  </span>
                )}
                {s.owner && <span>· {s.owner}</span>}
                {s.completed_at && (
                  <span className="inline-flex items-center gap-1 text-[var(--color-success)]">
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
    return <CheckCircle2 size={18} className="mt-0.5 text-[var(--color-success)]" />;
  if (status === "in_progress")
    return <Clock size={18} className="mt-0.5 animate-pulse text-[var(--color-accent)]" />;
  if (status === "blocked")
    return <Clock size={18} className="mt-0.5 text-[var(--color-warning)]" />;
  return <Circle size={18} className="mt-0.5 text-[var(--color-fg-muted)]" />;
}

function ContactCard({ contact }: { contact: Contact }) {
  return (
    <div className="group relative rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
      <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
        <EditContactButton
          contact={{
            id: contact.id,
            full_name: contact.full_name,
            title: contact.title,
            email: contact.email,
            phone: contact.phone,
            timezone: contact.timezone,
            is_primary: contact.is_primary,
          }}
        />
      </div>
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-[12px] font-semibold text-[var(--color-fg-inverse)]">
          {initials(contact.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-[var(--color-fg)]">
              {contact.full_name}
            </span>
            {contact.is_primary && (
              <Star size={11} className="text-[var(--color-accent)]" aria-label="primary" />
            )}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)]">
            {contact.title ?? "—"}
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] text-[var(--color-fg-secondary)]">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1 truncate hover:text-[var(--color-accent)]"
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
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-[14px] font-medium text-[var(--color-fg)]">{value}</div>
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
    <div className="flex items-center justify-between rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-5 text-[13px] text-[var(--color-fg-muted)]">
      <span>{text}</span>
      {cta && (
        <Link
          href={cta.href}
          className="text-[var(--color-accent)] hover:underline"
        >
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
  const days = Math.floor(ms / 86400000);
  if (days < 1) {
    const hrs = Math.floor(ms / 3600000);
    return hrs <= 0 ? "just now" : `${hrs}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return fmt(iso);
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
