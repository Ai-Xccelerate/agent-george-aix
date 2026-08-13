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
  Cloud,
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
import { Badge } from "@/components/ui/badge";
import { connectToolkitAction, disconnectToolkitAction } from "./actions";

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
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const result = await listOrgIntegrations(user.orgId);
  const scribe = getScribeConnection();
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Integrations</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          George talks to the outside world through Composio. Add auth configs
          in the Composio dashboard and they&apos;ll show up here automatically.
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

      <div className="space-y-3">
        <ScribeRow scribe={scribe} />

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

function ScribeRow({
  scribe,
}: {
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

      <span
        className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500"
        title="Scribe is configured via SCRIBE_MCP_URL / SCRIBE_MCP_TOKEN in the server environment, not through Composio."
      >
        Managed in environment
      </span>
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
