import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Mail,
  MailCheck,
  Reply,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ChatClient, type InitialMessage } from "../chat/_chat-client";
import { MessageMarkdown } from "../chat/_markdown";
import { SafeHtml } from "./_safe-html";

export const dynamic = "force-dynamic";

/**
 * AI actions — the PM's queue from George.
 *
 * Two-column master/detail.
 *   Left column: ranked feed of items needing the PM (Mode A drafts +
 *     inbound emails awaiting verdict). Selected via ?item=<key>.
 *   Right column: the email itself + George's verdict (assistant messages
 *     from the session) + the actions the PM can take on it.
 *
 * Framing from `knowledge/core/02-agent-george-role.md`:
 *   - George produces; the PM decides.
 *   - Lead with the recommendation, two or three actions max.
 *   - Mode B work shows up here as post-review only (placeholder section
 *     until partner-health and run-record surfaces land — backlog #56/#60).
 */

type SessionRow = {
  id: string;
  title: string | null;
  customer_id: string | null;
  channel: string | null;
  updated_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  customer_id: string | null;
  session_id: string | null;
  created_at: string;
};

type CustomerRow = {
  id: string;
  name: string;
  customer_kind: "partner" | "end_customer";
  lifecycle: string;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

type Item = {
  key: string;
  kind: "draft_new" | "draft_reply" | "inbound" | "risk" | "mode_b";
  subject: string | null;
  recipients: string | null;
  detail: string | null;
  customer: CustomerRow | null;
  createdAt: string;
  sessionId: string | null;
  severity: "routine" | "watch" | "urgent";
  // For draft / inbound detail pane:
  bodyHtml?: string | null;
  draftId?: string | null;
  auditId?: string | null;
  // For risk detail pane:
  riskSignal?: string | null;
  riskRecommendation?: string | null;
  // For Mode B detail pane:
  modeBSummary?: string | null;
};

/**
 * Static demo data for Risks and Mode B sections. There are no backing
 * tables for these yet (backlog #56, #58, #60, #66) — these items show what
 * the surface looks like populated and let prospects walk the full flow.
 * The customer chip resolves against real DB rows so the partner names
 * stay correct as we evolve the seed set.
 */
const DEMO_RISKS: Array<{
  key: string;
  customerId: string;
  subject: string;
  severity: "routine" | "watch" | "urgent";
  signal: string;
  recommendation: string;
  createdAtMinutesAgo: number;
}> = [
  {
    key: "r:helix-volume-drop",
    customerId: "11111111-1111-1111-8111-000000000001", // Helix Cloud
    subject: "Helix Cloud — assessment volume down 60% week-over-week",
    severity: "watch",
    signal:
      "Helix ran 2 Transition Hub assessments this week against a trailing 4-week average of 5. Last coach touch (Fraser) was 9 days ago. No support questions opened. Partner is in onboarding phase and was on track as of last cadence.",
    recommendation:
      "Drop Priya a short note acknowledging the slowdown and asking what's in their pipeline this week — not chase, not pressure. If they're heads-down on a close, that's fine. If they're stuck, this is the moment to pull Fraser in.",
    createdAtMinutesAgo: 45,
  },
  {
    key: "r:argonaut-renewal",
    customerId: "11111111-1111-1111-8111-000000000003", // Argonaut Systems
    subject: "Argonaut Systems — renewal at T-78, 18 days since last PM touch",
    severity: "urgent",
    signal:
      "Renewal lands in 78 days. Last Fraser touch was 18 days ago (vs the 7-day cadence agreed at sign). Two cadence calls skipped, including this Thursday's. No Transition Hub activity in 12 days.",
    recommendation:
      "Don't wait for T-60 — Fraser owns this conversation now. Propose a 30-minute call with Dale next week and bring John on standby if Dale slips again. The pattern is identical to the partner who churned last quarter at T-65.",
    createdAtMinutesAgo: 240,
  },
  {
    key: "r:cascadia-ingest",
    customerId: "11111111-1111-1111-8111-000000000010", // Cascadia Regional Health (end customer)
    subject: "Cascadia tenant ingest — parsed-contract failure on 2nd attempt",
    severity: "watch",
    signal:
      "Two consecutive ingests on Cascadia returned a Right-Size number that's $200K below As-Is. Root cause is the parser misreading the Government A6 tier as A1 — page-2 tier marker is missing from the contract PDF Helix uploaded.",
    recommendation:
      "Loop Esteban (engineering) on the parser branch. Meanwhile, ask Priya to attach Cascadia's prior contract manually and rerun — that path has worked for the last three partners with the same failure mode.",
    createdAtMinutesAgo: 75,
  },
];

const DEMO_MODE_B: Array<{
  key: string;
  customerId: string | null;
  subject: string;
  summary: string;
  createdAtMinutesAgo: number;
}> = [
  {
    key: "mb:ingest-classify-today",
    customerId: null,
    subject: "Classified 4 tenant ingests today — 3 success, 1 escalated",
    summary:
      "Watched the Transition Hub ingest queue across your book. Helix Cloud and Acme Robotics tenants ingested cleanly. Myriad360's first ingest failed on CSP-readiness quotas (known data-issue pattern); reran with the documented remediation — succeeded on attempt 2. Cascadia (Helix's customer) failed twice on parsed-contract tier — escalated to Esteban + flagged for your review in the Risks section above.",
    createdAtMinutesAgo: 30,
  },
  {
    key: "mb:kickoff-myriad360",
    customerId: "ff65fd26-47f6-4f11-b405-a1f106f3fd9d", // Myriad360
    subject: "Captured Myriad360 kickoff into the coaching knowledge layer",
    summary:
      "Fireflies transcript ingested and structured. Three reusable Q&A entries written to the program-management knowledge layer: (1) how to scope the first-customer nomination when the partner is between sales cycles, (2) when to bring Stuart in vs. keep the deal-maker coaching to Fraser, (3) the Entra ID authorization email pattern Myriad360's IT admin pushed back on. Next partner who hits any of these will get faster coaching.",
    createdAtMinutesAgo: 120,
  },
  {
    key: "mb:health-weekly",
    customerId: null,
    subject: "Weekly partner-health rollup — 5 partners, 1 watch, 1 urgent",
    summary:
      "Computed Monday-morning health across your active book.\n\n- On-track (3): Acme Robotics, Myriad360, Helix Cloud (with caveat — see Risks).\n- Watch (1): Northwind Managed IT — coach is still in every meeting through their 4th assessment; Mode-B not unlocking. Suggest pairing with Stuart for the next deal.\n- Urgent (1): Argonaut Systems — renewal cluster, escalated.\n\nCapacity line for the PM-lead: 1 PM × 5 partners in flight today, target 25. We are 20% of the way to PM 2.0 on this PM's book.",
    createdAtMinutesAgo: 180,
  },
];

export default async function ActionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ item?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const supabase = await createSupabaseServer();
  const params = (await searchParams) ?? {};
  const selectedKey = params.item ?? null;

  const [sessionsRes, auditRes, partnersRes] = await Promise.all([
    supabase
      .from("agent_sessions")
      .select("id, title, customer_id, channel, updated_at")
      .eq("channel", "email")
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("audit_log")
      .select("id, action, payload, customer_id, session_id, created_at")
      .in("action", ["email.drafted", "email.reply_drafted", "email.sent"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("customers")
      .select("id, name, customer_kind, lifecycle")
      .eq("customer_kind", "partner"),
  ]);

  const inbound = (sessionsRes.data ?? []) as SessionRow[];
  const auditRows = (auditRes.data ?? []) as AuditRow[];
  const partners = (partnersRes.data ?? []) as CustomerRow[];

  const sentDraftIds = new Set(
    auditRows
      .filter((r) => r.action === "email.sent")
      .map((r) => (r.payload as { draft_id?: string } | null)?.draft_id)
      .filter((v): v is string => !!v),
  );
  const pendingDrafts = auditRows.filter((r) => {
    if (r.action === "email.sent") return false;
    const draftId = (r.payload as { draft_id?: string } | null)?.draft_id;
    if (!draftId) return false;
    return !sentDraftIds.has(draftId);
  });

  const customerIds = Array.from(
    new Set(
      [
        ...inbound.map((r) => r.customer_id),
        ...pendingDrafts.map((r) => r.customer_id),
      ].filter((v): v is string => !!v),
    ),
  );
  const customersById = new Map<string, CustomerRow>();
  if (customerIds.length > 0) {
    const cRes = await supabase
      .from("customers")
      .select("id, name, customer_kind, lifecycle")
      .in("id", customerIds);
    for (const c of (cRes.data ?? []) as CustomerRow[]) {
      customersById.set(c.id, c);
    }
  }

  const partnersInBook = partners.length;
  const atRiskPartners = partners.filter((p) => p.lifecycle === "at_risk").length;

  // Pre-hydrate demo customer chips (Risks + Mode B reference real partners
  // by id so the chips render correctly).
  const demoCustomerIds = Array.from(
    new Set(
      [
        ...DEMO_RISKS.map((r) => r.customerId),
        ...DEMO_MODE_B.map((m) => m.customerId).filter(
          (v): v is string => !!v,
        ),
      ],
    ),
  );
  if (demoCustomerIds.length > 0) {
    const cRes = await supabase
      .from("customers")
      .select("id, name, customer_kind, lifecycle")
      .in("id", demoCustomerIds);
    for (const c of (cRes.data ?? []) as CustomerRow[]) {
      if (!customersById.has(c.id)) customersById.set(c.id, c);
    }
  }

  const needsYou = pendingDrafts.length + inbound.length;

  const items: Item[] = [
    ...pendingDrafts.map<Item>((r) => {
      const p = (r.payload ?? {}) as {
        draft_id?: string;
        to?: string[];
        subject?: string;
        body_html?: string;
      };
      const recipients = (p.to ?? []).join(", ") || null;
      const isReply = r.action === "email.reply_drafted";
      return {
        key: `d:${r.id}`,
        kind: isReply ? "draft_reply" : "draft_new",
        subject: p.subject ?? null,
        recipients,
        detail: stripHtml(p.body_html ?? "").slice(0, 180) || null,
        customer: r.customer_id ? customersById.get(r.customer_id) ?? null : null,
        createdAt: r.created_at,
        sessionId: r.session_id,
        severity: "routine",
        bodyHtml: p.body_html ?? null,
        draftId: p.draft_id ?? null,
        auditId: r.id,
      };
    }),
    ...inbound.map<Item>((s) => {
      const customer = s.customer_id ? customersById.get(s.customer_id) ?? null : null;
      const isAtRisk = customer?.lifecycle === "at_risk";
      const subject = s.title?.replace(/^Email:\s*/, "") ?? null;
      return {
        key: `i:${s.id}`,
        kind: "inbound",
        subject,
        recipients: null,
        detail: null,
        customer,
        createdAt: s.updated_at,
        sessionId: s.id,
        severity: isAtRisk ? "urgent" : "watch",
      };
    }),
  ].sort((a, b) => {
    const sev = sevScore(b.severity) - sevScore(a.severity);
    if (sev !== 0) return sev;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const riskItems: Item[] = DEMO_RISKS.map((r) => ({
    key: r.key,
    kind: "risk",
    subject: r.subject,
    recipients: null,
    detail: r.signal.slice(0, 180),
    customer: customersById.get(r.customerId) ?? null,
    createdAt: minutesAgo(r.createdAtMinutesAgo),
    sessionId: null,
    severity: r.severity,
    riskSignal: r.signal,
    riskRecommendation: r.recommendation,
  }));

  const modeBItems: Item[] = DEMO_MODE_B.map((m) => ({
    key: m.key,
    kind: "mode_b",
    subject: m.subject,
    recipients: null,
    detail: m.summary.slice(0, 180),
    customer: m.customerId ? customersById.get(m.customerId) ?? null : null,
    createdAt: minutesAgo(m.createdAtMinutesAgo),
    sessionId: null,
    severity: "routine",
    modeBSummary: m.summary,
  }));

  const allItems = [...items, ...riskItems, ...modeBItems];

  // Default selection: first item from "Needs your decision" if any,
  // otherwise the first risk, otherwise the first Mode B run.
  const effectiveSelectedKey =
    selectedKey && allItems.some((i) => i.key === selectedKey)
      ? selectedKey
      : allItems[0]?.key ?? null;
  const selected = allItems.find((i) => i.key === effectiveSelectedKey) ?? null;

  // Detail pane data: for any item with a session we hydrate the message
  // trail so the inline chat below the body picks up George's prior turns
  // without the PM re-explaining context.
  let messages: MessageRow[] = [];
  if (selected?.sessionId) {
    const m = await supabase
      .from("agent_messages")
      .select("id, role, content, created_at")
      .eq("session_id", selected.sessionId)
      .order("created_at", { ascending: true });
    messages = (m.data ?? []) as MessageRow[];
  }
  const inlineChatMessages: InitialMessage[] = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 space-y-4 px-4 py-5 sm:px-6 md:px-8 md:py-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--color-accent)]" />
            <h1 className="text-[22px] font-bold text-[var(--color-fg)]">AI actions</h1>
          </div>
          <p className="max-w-2xl text-sm text-[var(--color-fg-secondary)]">
            What George is asking you for, ranked. Pick an item on the left to
            see the message, George&rsquo;s verdict, and the next step he
            recommends &mdash; act from there.
          </p>
        </header>

        <CapacityStrip
          partners={partnersInBook}
          needsYou={needsYou}
          atRisk={atRiskPartners}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-5 sm:px-6 md:px-8 md:pb-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,440px)]">
        {/* LEFT: ranked list — own scroll */}
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <ListSection
            title="Needs your decision"
            subtitle="Mode A. George drafted; you review and act."
            icon={<MailCheck size={14} />}
            count={items.length}
          >
            {items.length === 0 ? (
              <Empty>
                <p>
                  Inbox is clear and no drafts are waiting. Mail to{" "}
                  <code className="rounded bg-[var(--color-surface-2)] px-1 py-px text-[11px]">
                    agent.george@getonyx.ai
                  </code>{" "}
                  lands here with George&rsquo;s recommended next step.
                </p>
              </Empty>
            ) : (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {items.map((i) => (
                  <ListRow
                    key={i.key}
                    item={i}
                    active={i.key === effectiveSelectedKey}
                  />
                ))}
              </ul>
            )}
          </ListSection>

          <ListSection
            title="Risks George flagged (needs your attention)"
            subtitle="Drift signals across your book."
            icon={<ShieldAlert size={14} />}
            count={riskItems.length}
          >
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {riskItems.map((i) => (
                <ListRow
                  key={i.key}
                  item={i}
                  active={i.key === effectiveSelectedKey}
                />
              ))}
            </ul>
          </ListSection>

          <ListSection
            title="What George ran on his own"
            subtitle="Mode B. Post-review only."
            icon={<CheckCircle2 size={14} />}
            count={modeBItems.length}
          >
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {modeBItems.map((i) => (
                <ListRow
                  key={i.key}
                  item={i}
                  active={i.key === effectiveSelectedKey}
                />
              ))}
            </ul>
          </ListSection>
        </div>

        {/* MIDDLE: message + verdict — own scroll */}
        <div className="min-h-0 min-w-0 overflow-y-auto">
          {selected ? (
            <DetailPane item={selected} messages={messages} />
          ) : (
            <div className="rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-10 text-center text-[13px] text-[var(--color-fg-muted)]">
              Pick an item on the left to see the message and George&rsquo;s
              verdict here.
            </div>
          )}
        </div>

        {/* RIGHT: inline chat per selected item — fills full column height */}
        <div className="flex min-h-0 min-w-0 flex-col">
          {selected ? (
            <InlineChat
              item={selected}
              initialMessages={inlineChatMessages}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-10 text-center text-[13px] text-[var(--color-fg-muted)]">
              Chat with George will appear here once you pick an item.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function sevScore(s: "routine" | "watch" | "urgent") {
  return s === "urgent" ? 2 : s === "watch" ? 1 : 0;
}

function CapacityStrip({
  partners,
  needsYou,
  atRisk,
}: {
  partners: number;
  needsYou: number;
  atRisk: number;
}) {
  const target = 25;
  const pct = Math.min(100, Math.round((partners / target) * 100));
  return (
    <div className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Partners in your book" value={partners} />
        <Stat label="Awaiting your action" value={needsYou} accent={needsYou > 0} />
        <Stat label="At-risk partners" value={atRisk} warn={atRisk > 0} />
        <Stat label="Toward 25/PM target" value={`${pct}%`} muted />
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-fg-muted)]">
        Capacity objective: 5&ndash;10 partners per PM today &rarr; 25 with George
        assisting &rarr; 50 once Mode B is live for routine work.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
  muted,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  warn?: boolean;
  muted?: boolean;
}) {
  const tone = warn
    ? "text-[var(--color-error)]"
    : accent
      ? "text-[var(--color-accent)]"
      : muted
        ? "text-[var(--color-fg-muted)]"
        : "text-[var(--color-fg)]";
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
        {label}
      </div>
      <div className={`mt-0.5 text-[22px] font-bold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function ListSection({
  title,
  subtitle,
  icon,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-fg)]">
            <span className="text-[var(--color-accent)]">{icon}</span>
            {title}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)]">{subtitle}</div>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-fg-muted)]">
          {count}
        </span>
      </header>
      {children}
    </section>
  );
}

function ListRow({ item, active }: { item: Item; active: boolean }) {
  const KindIcon =
    item.kind === "inbound"
      ? Mail
      : item.kind === "draft_reply"
        ? Reply
        : item.kind === "risk"
          ? ShieldAlert
          : item.kind === "mode_b"
            ? CheckCircle2
            : MailCheck;
  return (
    <li>
      <Link
        href={`/actions?item=${encodeURIComponent(item.key)}`}
        scroll={false}
        className={`flex items-start gap-3 px-4 py-3 transition-colors ${
          active
            ? "bg-[var(--color-accent-light)]/60"
            : "hover:bg-[var(--color-surface-2)]"
        }`}
      >
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            item.severity === "urgent"
              ? "bg-[var(--color-error)]/10 text-[var(--color-error)]"
              : "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
          }`}
        >
          {item.severity === "urgent" ? <AlertTriangle size={13} /> : <KindIcon size={13} />}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <KindChip kind={item.kind} />
            {item.customer ? (
              <CustomerChip customer={item.customer} />
            ) : (
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-fg-muted)]">
                Unlinked
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[var(--color-fg-muted)]">
              <Clock3 size={9} />
              {relative(item.createdAt)}
            </span>
          </div>
          <div className="truncate text-[13px] font-medium text-[var(--color-fg)]">
            {item.subject ?? "(no subject)"}
          </div>
          {item.recipients && (
            <div className="truncate text-[11px] text-[var(--color-fg-muted)]">
              To {item.recipients}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

function KindChip({ kind }: { kind: Item["kind"] }) {
  const label =
    kind === "draft_new"
      ? "New outbound"
      : kind === "draft_reply"
        ? "Reply draft"
        : kind === "inbound"
          ? "Inbound"
          : kind === "risk"
            ? "Risk flag"
            : "Mode B run";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-light)] px-2 py-0.5 font-medium text-[var(--color-accent)]">
      <CircleDot size={8} />
      {label}
    </span>
  );
}

function CustomerChip({ customer }: { customer: CustomerRow }) {
  const isEnd = customer.customer_kind === "end_customer";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-fg-secondary)]">
      <span className="text-[var(--color-fg-muted)]">{isEnd ? "↳" : "·"}</span>
      {customer.name}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
      {children}
    </div>
  );
}

function DetailPane({
  item,
  messages,
}: {
  item: Item;
  messages: MessageRow[];
}) {
  // The first user message in an email session is the inbound email
  // rendered for chat by `process-event.ts`. The first assistant message
  // is George's autonomous-run verdict (structured "Actions taken /
  // Awaiting review / Notes" by prompt design).
  const inboundMessage = messages.find((m) => m.role === "user") ?? null;
  const verdictMessage =
    messages.filter((m) => m.role === "assistant").slice(-1)[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
        <header className="border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <KindChip kind={item.kind} />
            {item.customer ? (
              <CustomerChip customer={item.customer} />
            ) : (
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-fg-muted)]">
                Unlinked
              </span>
            )}
            {item.severity === "urgent" && (
              <span className="rounded-full bg-[var(--color-error)]/10 px-2 py-0.5 font-medium text-[var(--color-error)]">
                Urgent
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[var(--color-fg-muted)]">
              <Clock3 size={10} />
              {relative(item.createdAt)}
            </span>
          </div>
          <h2 className="mt-2 text-[16px] font-semibold text-[var(--color-fg)]">
            {item.subject ?? "(no subject)"}
          </h2>
          {item.recipients && (
            <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
              To {item.recipients}
            </div>
          )}
        </header>

        {item.kind === "inbound" ? (
          <InboundBody inbound={inboundMessage} verdict={verdictMessage} />
        ) : item.kind === "risk" ? (
          <RiskBody item={item} />
        ) : item.kind === "mode_b" ? (
          <ModeBBody item={item} />
        ) : (
          <DraftBody item={item} />
        )}
      </div>
    </div>
  );
}

function InlineChat({
  item,
  initialMessages,
}: {
  item: Item;
  initialMessages: InitialMessage[];
}) {
  // Risks and Mode B don't have backing sessions yet — explain and exit
  // until #66 / #60 land.
  if (item.kind === "risk" || item.kind === "mode_b") {
    return (
      <div className="flex h-full items-center justify-center rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-6 text-center text-[12px] text-[var(--color-fg-secondary)]">
        {item.kind === "risk"
          ? "Inline chat lands once risks are first-class records (backlog #66). For now, mention this risk in any chat with George — he'll pick up the context from the partner's session history."
          : "Post-review only. To question or roll back this Mode B run, open a chat and reference it by partner — George keeps a full audit trail."}
      </div>
    );
  }
  if (!item.sessionId) {
    return (
      <div className="flex h-full items-center justify-center rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-6 text-center text-[12px] text-[var(--color-fg-muted)]">
        No session linked to this item yet — can&rsquo;t chat inline.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border-subtle)] px-4 py-2.5 text-[12px] font-semibold text-[var(--color-fg)]">
        <Sparkles size={12} className="text-[var(--color-accent)]" />
        Chat with George about this
      </header>
      <div className="min-h-0 flex-1">
        <ChatClient
          key={item.sessionId}
          sessionId={item.sessionId}
          initialMessages={initialMessages}
          embedded
        />
      </div>
    </div>
  );
}

function RiskBody({ item }: { item: Item }) {
  return (
    <div className="divide-y divide-[var(--color-border-subtle)]">
      <div className="px-5 py-4">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
          Signal
        </div>
        <div className="text-[13px] leading-relaxed text-[var(--color-fg)]">
          <MessageMarkdown content={item.riskSignal ?? "(no signal recorded)"} />
        </div>
      </div>
      <div className="bg-[var(--color-surface-2)]/40 px-5 py-4">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--color-accent)]">
          <Sparkles size={11} /> George&rsquo;s recommendation
        </div>
        <div className="text-[13px] leading-relaxed text-[var(--color-fg)]">
          <MessageMarkdown content={item.riskRecommendation ?? "(no recommendation)"} />
        </div>
      </div>
    </div>
  );
}

function ModeBBody({ item }: { item: Item }) {
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--color-accent)]">
        <CheckCircle2 size={11} /> Run summary
      </div>
      <div className="text-[13px] leading-relaxed text-[var(--color-fg)]">
        <MessageMarkdown content={item.modeBSummary ?? "(no summary)"} />
      </div>
    </div>
  );
}

function InboundBody({
  inbound,
  verdict,
}: {
  inbound: MessageRow | null;
  verdict: MessageRow | null;
}) {
  if (!inbound && !verdict) {
    return (
      <div className="px-5 py-6 text-[12px] text-[var(--color-fg-muted)]">
        No message body captured. The webhook may have lost the body or the
        Composio fetch failed &mdash; check the inline chat below.
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--color-border-subtle)]">
      {inbound && (
        <div className="px-5 py-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
            Message
          </div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg)]">
            {truncate(inbound.content, 4000)}
          </div>
        </div>
      )}
      {verdict && (
        <div className="bg-[var(--color-surface-2)]/40 px-5 py-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--color-accent)]">
            <Sparkles size={11} /> George&rsquo;s verdict
          </div>
          <div className="text-[13px] leading-relaxed text-[var(--color-fg)]">
            <MessageMarkdown content={truncate(verdict.content, 4000)} />
          </div>
        </div>
      )}
    </div>
  );
}

function DraftBody({ item }: { item: Item }) {
  const bodyHtml = item.bodyHtml ?? null;
  if (!bodyHtml) {
    return (
      <div className="px-5 py-6 text-[12px] text-[var(--color-fg-muted)]">
        No draft body captured.
      </div>
    );
  }
  return (
    <div className="px-5 py-4">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
        Draft preview
      </div>
      <div className="overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
        <header className="space-y-1 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/40 px-4 py-3 text-[12px]">
          <DraftHeaderRow label="From" value="agent.george@getonyx.ai" mono />
          {item.recipients && (
            <DraftHeaderRow label="To" value={item.recipients} mono />
          )}
          {item.subject && (
            <DraftHeaderRow label="Subject" value={item.subject} bold />
          )}
        </header>
        <SafeHtml
          html={bodyHtml}
          className={[
            "px-5 py-4 text-[14px] leading-[1.65] text-[var(--color-fg)]",
            "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
            "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
            "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
            "[&_li]:my-1",
            "[&_strong]:font-semibold [&_strong]:text-[var(--color-fg)]",
            "[&_a]:text-[var(--color-accent)] [&_a]:underline-offset-2 hover:[&_a]:underline",
            "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--color-fg-secondary)]",
            "[&_code]:rounded [&_code]:bg-[var(--color-surface-2)] [&_code]:px-1 [&_code]:py-px [&_code]:text-[12px]",
            "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[16px] [&_h1]:font-semibold",
            "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[15px] [&_h2]:font-semibold",
            "[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[14px] [&_h3]:font-semibold",
            "[&_hr]:my-4 [&_hr]:border-[var(--color-border-subtle)]",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

function DraftHeaderRow({
  label,
  value,
  mono,
  bold,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[var(--color-fg)] ${
          mono ? "font-mono text-[12px]" : ""
        } ${bold ? "font-semibold" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
