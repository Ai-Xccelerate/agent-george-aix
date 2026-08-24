import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Circle,
  BookOpen,
  Cloud,
  Database,
  FileText,
  GitBranch,
  Hash,
  KanbanSquare,
  ListChecks,
  Mail,
  MessageSquare,
  Mic,
  Plug,
  PlugZap,
  Table2,
  Unplug,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import {
  listOrgIntegrations,
  type IntegrationSummary,
} from "@/lib/composio/connections";
import { getScribeConnection } from "@/lib/agent/scribe";
import { getAgentDbStatus, clerkOrgIdFor, type AgentDbStatus } from "@/lib/agent/agentdb";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getMailProviderStatus,
  type MailProviderStatus,
} from "@/lib/agent/mail-provider";
import { Badge } from "@/components/ui/badge";
import { connectToolkitAction, disconnectToolkitAction } from "./actions";
import { enableAgentDbAction } from "./agentdb-actions";
import { disableIntegrationAction, enableIntegrationAction } from "./toggle-actions";
import { toggleState, type ToggleState } from "@/lib/agent/integration-toggle";
import { isScribeConfigured } from "@/lib/agent/scribe";
import { isNylasEnabled } from "@/lib/nylas/client";
import { getParchmentStatus } from "@/lib/parchment/connection";

export const dynamic = "force-dynamic";

/**
 * Lucide icon per toolkit slug — picked to read at a glance for the kind of
 * application (mail / calendar / drive / CRM / chat / etc.). Unknown
 * toolkits fall back to a generic Plug icon. No external CDN, no brand
 * assets to manage — easy to extend.
 */
const TOOLKIT_ICON: Record<string, LucideIcon> = {
  OUTLOOK: Mail,
  MICROSOFTOUTLOOK: Mail,
  GMAIL: Mail,
  TEAMS: MessageSquare,
  MICROSOFTTEAMS: MessageSquare,
  SLACK: Hash,
  FIREFLIES: Mic,
  FIREFLIESAI: Mic,
  ONEDRIVE: Cloud,
  MICROSOFTONEDRIVE: Cloud,
  GOOGLEDRIVE: Cloud,
  GOOGLEDOCS: FileText,
  GOOGLECALENDAR: CalendarClock,
  CALENDAR: Calendar,
  HUBSPOT: Building2,
  SALESFORCE: Building2,
  ZOHO: Briefcase,
  ZOHOCRM: Briefcase,
  NOTION: FileText,
  AIRTABLE: Table2,
  LINEAR: KanbanSquare,
  ASANA: ListChecks,
  JIRA: KanbanSquare,
  CONFLUENCE: FileText,
  GITHUB: GitBranch,
  GITLAB: GitBranch,
  STRIPE: Banknote,
  CONTACTS: Users,
};

function ToolkitIcon({ toolkit }: { toolkit: string }) {
  const Icon = TOOLKIT_ICON[toolkit] ?? Plug;
  return <Icon size={18} className="text-brand-500 dark:text-brand-400" />;
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    disconnected?: string;
    error?: string;
    agentdb?: string;
    detail?: string;
    toggled?: string;
    state?: string;
    toggle_error?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const result = await listOrgIntegrations(user.orgId);
  const scribe = getScribeConnection();
  // Shown as a status card, never as something to connect: George's own mailbox
  // is provisioned by API and simply exists. A Connect button here would offer
  // an action that does not exist, and imply George's email were gated on
  // someone doing something.
  const mail = await getMailProviderStatus(user.orgId);
  // Resolved the same way the agent runtime resolves it, so this row reflects
  // what George will actually experience rather than a parallel guess.
  const agentdb = await getAgentDbStatus(
    await clerkOrgIdFor(createSupabaseAdmin(), user.orgId),
  );

  // Per-org on/off for the three whose state we own. Each needs its own idea
  // of "configured", because a credential looks different for each of them.
  const admin = createSupabaseAdmin();
  const parchment = await getParchmentStatus(admin, user.orgId).catch(() => null);
  const [nylasToggle, scribeToggle, parchmentToggle] = await Promise.all([
    toggleState(admin, user.orgId, "nylas", isNylasEnabled()),
    toggleState(admin, user.orgId, "scribe", isScribeConfigured()),
    toggleState(admin, user.orgId, "parchment", parchment?.reachable === true),
  ]);
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Integrations</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          How George reaches the outside world. Accounts linked through Composio
          appear here automatically once their auth configs exist in the Composio
          dashboard. George&apos;s own mailbox is not a linked account — see below.
        </p>
      </header>

      {sp.connected && (
        <Banner tone="success">
          <CheckCircle2 size={14} /> {sp.connected.toUpperCase()} connected successfully.
        </Banner>
      )}
      {sp.disconnected && (
        <Banner tone="success">
          <CheckCircle2 size={14} /> {sp.disconnected.toUpperCase()} disconnected.
        </Banner>
      )}
      {sp.error && (
        <Banner tone="error">
          <AlertTriangle size={14} /> {errorMessage(sp.error)}
        </Banner>
      )}
      {sp.toggled && (
        <Banner tone={sp.state === "on" ? "success" : "error"}>
          <CheckCircle2 size={14} /> {sp.toggled.toUpperCase()} turned {sp.state === "on" ? "on" : "off"} for this organisation.
        </Banner>
      )}
      {sp.toggle_error && (
        <Banner tone="error">
          <AlertTriangle size={14} /> Could not change that integration: {sp.toggle_error}
        </Banner>
      )}
      {sp.agentdb === "enabled" && (
        <Banner tone="success">
          <CheckCircle2 size={14} /> Customer database enabled. George can query it now,
          read-only.
        </Banner>
      )}
      {sp.agentdb && sp.agentdb !== "enabled" && (
        <Banner tone="error">
          <AlertTriangle size={14} /> {agentDbMessage(sp.agentdb, sp.detail)}
        </Banner>
      )}

      <div className="space-y-3">
        {mail.provider === "nylas" ? (
          <GeorgeMailboxRow mail={mail} toggle={nylasToggle} />
        ) : null}
        <ScribeRow scribe={scribe} toggle={scribeToggle} />
        <KnowledgeRow toggle={parchmentToggle} documents={parchment?.documents ?? null} />
        <AgentDbRow agentdb={agentdb} />

        {!result.ok ? (
          <ConnectionError message={result.error} />
        ) : result.integrations.length === 0 ? (
          <EmptyState />
        ) : (
          result.integrations.map((c) => <IntegrationRow key={c.authConfigId} c={c} />)
        )}
      </div>
    </div>
  );
}

function IntegrationRow({ c }: { c: IntegrationSummary }) {
  return (
    <div className="flex min-h-[84px] items-center justify-between gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15">
          <ToolkitIcon toolkit={c.toolkit} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-800 dark:text-white/90">
              {c.label}
            </span>
            <StatusPill status={c.status} />
          </div>
          <p
            className="mt-0.5 truncate text-theme-sm text-gray-500 dark:text-gray-400"
            title={c.description}
          >
            {c.description || "Connected via Composio."}
            {c.accountLabel ? ` · ${c.accountLabel}` : ""}
          </p>
        </div>
      </div>

      <ConnectOrDisconnect c={c} />
    </div>
  );
}

/**
 * George's own mailbox and calendar. Deliberately has no Connect or Disconnect
 * control: there is no OAuth flow and no account to link — the mailbox is
 * provisioned by API and belongs to George, the way a work address belongs to
 * an employee. The card exists so that someone looking for George's email on
 * this page finds it, instead of finding a stale Outlook row and believing it.
 */
function GeorgeMailboxRow({
  mail,
  toggle,
}: {
  mail: MailProviderStatus;
  toggle: ToggleState;
}) {
  return (
    <div className="flex min-h-[84px] items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15">
          <Mail size={18} className="text-brand-500 dark:text-brand-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-800 dark:text-white/90">
              Email &amp; calendar
            </span>
            <StatusPill status={mail.connected ? "connected" : "error"} />
          </div>
          <p className="mt-0.5 truncate text-theme-sm text-gray-500 dark:text-gray-400">
            {toggleDetail(
              toggle,
              mail.connected
                ? `${mail.mailbox} · George's own mailbox and calendar`
                : (mail.detail ?? "George's mailbox is unreachable"),
            )}
          </p>
        </div>
      </div>
      <ToggleControl toggle={toggle} />
    </div>
  );
}

/**
 * The organisation's operational database (AgentDB) — George's CRM.
 *
 * Unlike the Composio rows this is not an OAuth connection, and unlike Scribe it
 * is not purely environment-managed: an org must be deliberately switched on by
 * someone whose Clerk JWT proves entitlement in AIX Core, so this row owns that
 * one action and nothing else.
 *
 * Read-only is stated on the row rather than buried in a tooltip, because it sets
 * the expectation for what George will claim it can do with the database.
 */
function AgentDbRow({ agentdb }: { agentdb: AgentDbStatus }) {
  const status = agentdb.enabled
    ? "connected"
    : !agentdb.configured || !agentdb.reachable
      ? "error"
      : "disconnected";

  return (
    <div className="flex min-h-[84px] items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15">
          <Database size={18} className="text-brand-500 dark:text-brand-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-800 dark:text-white/90">
              Customer database
            </span>
            <StatusPill status={status} />
            {agentdb.enabled && (
              <Badge tone="neutral" withDot={false}>
                read-only
              </Badge>
            )}
          </div>
          <p
            className="mt-0.5 truncate text-theme-sm text-gray-500 dark:text-gray-400"
            title={agentdb.detail}
          >
            {agentdb.detail}
          </p>
        </div>
      </div>

      {agentdb.canEnable ? (
        <form action={enableAgentDbAction}>
          <button
            type="submit"
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
            title="Checks your entitlement with AIX Core, then gives George read-only access to this organisation&apos;s database."
          >
            <PlugZap size={14} />
            Enable
          </button>
        </form>
      ) : (
        <span
          className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500"
          title={
            agentdb.enabled
              ? "George queries this database directly over MCP. Write access is deliberately not granted."
              : "AgentDB is configured with AGENTDB_API_URL and the shared internal key in the server environment."
          }
        >
          {agentdb.enabled ? "Managed in environment" : "Unavailable"}
        </span>
      )}
    </div>
  );
}

/** Enable-attempt outcomes, written for whoever pressed the button. */
function agentDbMessage(code: string, detail?: string) {
  if (code === "not_entitled")
    return "AIX Core says this organisation is not entitled to the customer database. Nothing was changed — ask an AIX admin to enable it on the account.";
  if (code === "no_org") return "No active organisation in your session. Pick one and try again.";
  if (code === "no_token")
    return "Your session token could not be read. Sign out and back in, then try again.";
  return detail ?? "Could not enable the customer database.";
}

function ScribeRow({
  scribe,
  toggle,
}: {
  toggle: ToggleState;
  scribe: { connected: boolean; account: string | null; description: string };
}) {
  return (
    <div className="flex min-h-[84px] items-center justify-between gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15">
          <Mic size={18} className="text-brand-500 dark:text-brand-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-800 dark:text-white/90">Scribe</span>
            <StatusPill status={scribe.connected ? "connected" : "disconnected"} />
          </div>
          <p
            className="mt-0.5 truncate text-theme-sm text-gray-500 dark:text-gray-400"
            title={scribe.description}
          >
            {scribe.description}
            {scribe.account ? ` · ${scribe.account}` : ""}
          </p>
        </div>
      </div>
      <ToggleControl toggle={toggle} />
    </div>
  );
}

function ConnectOrDisconnect({ c }: { c: IntegrationSummary }) {
  if (c.status === "connected") {
    return (
      <form action={disconnectToolkitAction}>
        <input type="hidden" name="toolkit" value={c.toolkit} />
        {c.accountId && <input type="hidden" name="account_id" value={c.accountId} />}
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm font-medium text-gray-800 dark:text-white/90 hover:border-error-500 hover:text-error-500"
          title="Disconnect this integration"
        >
          <Unplug size={14} />
          Disconnect
        </button>
      </form>
    );
  }

  return (
    <form action={connectToolkitAction}>
      <input type="hidden" name="toolkit" value={c.toolkit} />
      <input type="hidden" name="auth_config_id" value={c.authConfigId} />
      <button
        type="submit"
        className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
      >
        <PlugZap size={14} />
        Connect
      </button>
    </form>
  );
}

/**
 * Enable / Disable for one integration.
 *
 * Off is not cosmetic here: when this is off the integration's tools are never
 * registered for the run, so George cannot use it even if a prompt tells him to.
 * That is the difference this control is making, and it is worth saying on the
 * row rather than leaving someone to assume it merely discourages use.
 *
 * Disabled when there is no credential: enabling something that cannot work
 * would produce a green state and no behaviour.
 */
function ToggleControl({ toggle }: { toggle: ToggleState }) {
  if (!toggle.configured) {
    return (
      <span
        className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500"
        title="There is no credential for this integration on this deployment yet, so there is nothing to switch on."
      >
        Not configured
      </span>
    );
  }

  const action = toggle.enabled ? disableIntegrationAction : enableIntegrationAction;
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="integration" value={toggle.integration} />
      {toggle.enabled ? (
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm font-medium text-gray-800 dark:text-white/90 hover:border-error-500 hover:text-error-500"
          title="Turn this off for this organisation. George stops being given these tools at all; the credential is kept, so turning it back on needs nothing re-entered."
        >
          <Unplug size={14} />
          Disable
        </button>
      ) : (
        <button
          type="submit"
          className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
          title="Give George these tools for this organisation."
        >
          <PlugZap size={14} />
          Enable
        </button>
      )}
    </form>
  );
}

/** One line under the title explaining the current state in plain terms. */
function toggleDetail(toggle: ToggleState, whenActive: string): string {
  if (toggle.active) return whenActive;
  return toggle.reason ?? "Not available.";
}

/**
 * The organisation's knowledge hub (Parchment).
 *
 * Moved here from Settings → Knowledge, where a connection sat among the
 * documents. A connection to another product belongs with the other
 * connections; the knowledge base itself stays where it is, because that is
 * content rather than an integration.
 */
function KnowledgeRow({
  toggle,
  documents,
}: {
  toggle: ToggleState;
  documents: number | null;
}) {
  const status = toggle.active ? "connected" : toggle.configured ? "disconnected" : "error";
  return (
    <div className="flex min-h-[84px] items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15">
          <BookOpen size={18} className="text-brand-500 dark:text-brand-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-800 dark:text-white/90">
              Knowledge hub
            </span>
            <StatusPill status={status} />
          </div>
          <p className="mt-0.5 truncate text-theme-sm text-gray-500 dark:text-gray-400">
            {toggleDetail(
              toggle,
              documents === null
                ? "Parchment — George can search the hub, read-only."
                : `Parchment — ${documents} document${documents === 1 ? "" : "s"}, read-only.`,
            )}
          </p>
        </div>
      </div>
      <ToggleControl toggle={toggle} />
    </div>
  );
}
function Banner({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const className =
    tone === "success"
      ? "border-success-500/30 bg-success-50 dark:bg-success-500/15 text-success-500"
      : "border-error-500/30 bg-error-500/10 text-error-500";
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-theme-sm ${className}`}
    >
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: IntegrationSummary["status"] }) {
  if (status === "connected")
    return (
      <Badge tone="success" withDot={false}>
        <CheckCircle2 size={11} className="mr-0.5" />
        connected
      </Badge>
    );
  if (status === "error")
    return (
      <Badge tone="error" withDot={false}>
        <AlertTriangle size={11} className="mr-0.5" />
        error
      </Badge>
    );
  if (status === "unknown") return <Badge tone="neutral">unknown</Badge>;
  return (
    <Badge tone="neutral" withDot={false}>
      <Circle size={9} className="mr-0.5" />
      not connected
    </Badge>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <Plug size={20} />
      </div>
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
        No auth configs in Composio yet
      </h2>
      <p className="max-w-[480px] text-sm text-gray-500 dark:text-gray-400">
        Open the Composio dashboard, create an auth config for the toolkit
        you want George to use (Outlook, Fireflies, Zoho, etc.), and it&apos;ll
        show up here within a refresh.
      </p>
      <a
        href="https://platform.composio.dev"
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 py-1.5 text-theme-sm font-medium text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      >
        Open Composio dashboard
      </a>
    </div>
  );
}

function ConnectionError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-error-500/40 bg-white dark:bg-white/[0.03] py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-error-500/10 text-error-500">
        <Unplug size={20} />
      </div>
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Couldn&apos;t reach Composio
      </h2>
      <p className="max-w-[480px] text-sm text-gray-500 dark:text-gray-400">
        George couldn&apos;t list your auth configs. This usually means the
        Composio API key is missing, expired, or scoped to a different project.
        Check <code>COMPOSIO_API_KEY</code> in the server environment, then
        refresh.
      </p>
      <p
        className="max-w-[480px] truncate font-mono text-theme-xs text-gray-500 dark:text-gray-400 opacity-70"
        title={message}
      >
        {message}
      </p>
    </div>
  );
}

function errorMessage(code: string) {
  if (code.startsWith("missing_auth_config_"))
    return `Auth config missing for ${code.replace("missing_auth_config_", "").toUpperCase()}. Add it in the Composio dashboard.`;
  if (code.startsWith("link_failed_"))
    return `Composio rejected the connection request for ${code.replace("link_failed_", "").toUpperCase()}. Re-check the auth config in Composio.`;
  if (code.startsWith("no_redirect_url_"))
    return `Composio didn't return a redirect URL for ${code.replace("no_redirect_url_", "").toUpperCase()}.`;
  if (code.startsWith("disconnect_failed_"))
    return `Could not disconnect ${code.replace("disconnect_failed_", "").toUpperCase()}. Try again in a moment.`;
  if (code.startsWith("already_disconnected_"))
    return `${code.replace("already_disconnected_", "").toUpperCase()} was already disconnected.`;
  return `Connection failed: ${code}`;
}
