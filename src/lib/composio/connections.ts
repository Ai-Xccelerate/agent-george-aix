import { getComposio, composioOrgIdentity } from "./client";

export type IntegrationSummary = {
  /** Composio auth-config id (the `ac_…` value). Required for Connect. */
  authConfigId: string;
  /** Provider slug, e.g. 'OUTLOOK', 'ZOHO', 'FIREFLIES'. */
  toolkit: string;
  /** Human-friendly name for the row. Falls back to a Titleized toolkit slug. */
  label: string;
  /** One-line copy under the label (provider description if Composio gave us one). */
  description: string;
  /** Live connection status for this org. */
  status: "connected" | "disconnected" | "error" | "unknown";
  /** Composio connected-account id, when a row is connected. Used by Disconnect. */
  accountId: string | null;
  /** Optional account display name from Composio, e.g. 'george@onyx.ai'. */
  accountLabel: string | null;
};

/**
 * Pulls every auth config the workspace has defined in Composio and joins it
 * with the connected accounts for this org. New auth configs added in the
 * Composio dashboard show up here automatically — no env-var plumbing.
 *
 * If the Composio API call fails we degrade to an empty list so the page
 * doesn't blow up; the admin will see the error banner from the action layer
 * next time they try to connect.
 */
export async function listOrgIntegrations(
  orgId: string,
): Promise<IntegrationSummary[]> {
  let configs: RawAuthConfig[] = [];
  let accounts: RawConnectedAccount[] = [];

  try {
    const composio = getComposio();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfgSurface = (composio as any).authConfigs;
    if (cfgSurface?.list) {
      const cfgList = await cfgSurface.list({});
      configs = unwrapList(cfgList) as RawAuthConfig[];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acctSurface = (composio as any).connectedAccounts;
    if (acctSurface?.list) {
      const acctList = await acctSurface.list({
        userIds: [composioOrgIdentity(orgId)],
      });
      accounts = unwrapList(acctList) as RawConnectedAccount[];
    }
  } catch {
    return [];
  }

  return configs
    .map((cfg) => buildSummary(cfg, accounts))
    .filter((r): r is IntegrationSummary => !!r)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildSummary(
  cfg: RawAuthConfig,
  accounts: RawConnectedAccount[],
): IntegrationSummary | null {
  const authConfigId = cfg.id ?? cfg.auth_config_id ?? null;
  if (!authConfigId) return null;

  const toolkit = (cfg.toolkit?.slug ?? cfg.toolkit_slug ?? cfg.appName ?? "")
    .toUpperCase();
  if (!toolkit) return null;

  // Always prefer a curated business-friendly name keyed on the toolkit
  // slug. Composio's `cfg.name` is the user-provided auth-config name and
  // commonly carries noisy suffixes like "Fireflies-ns1t60a" — never use it
  // as the display label.
  const label =
    FRIENDLY_NAME[toolkit] ??
    cfg.toolkit?.name ??
    toTitle(toolkit);
  const description =
    cfg.description ??
    cfg.toolkit?.description ??
    descriptionFor(toolkit);

  const match = accounts.find(
    (a) => (a.toolkit?.slug ?? a.appName ?? "").toUpperCase() === toolkit,
  );

  const rawStatus = (match?.status ?? "").toLowerCase();
  const status: IntegrationSummary["status"] = !match
    ? "disconnected"
    : rawStatus === "active" || rawStatus === "connected"
      ? "connected"
      : rawStatus === "error" || rawStatus === "failed"
        ? "error"
        : rawStatus
          ? "disconnected"
          : "unknown";

  return {
    authConfigId,
    toolkit,
    label,
    description,
    status,
    accountId: match?.id ?? null,
    accountLabel: match?.metadata?.account_label ?? null,
  };
}

/**
 * Curated, business-friendly display name per toolkit slug. New entries
 * land here when you want a specific label instead of the auto-titleized
 * fallback; unknown slugs are handled gracefully.
 */
const FRIENDLY_NAME: Record<string, string> = {
  OUTLOOK: "Microsoft Outlook",
  MICROSOFTOUTLOOK: "Microsoft Outlook",
  ONEDRIVE: "Microsoft OneDrive",
  MICROSOFTONEDRIVE: "Microsoft OneDrive",
  MICROSOFTTEAMS: "Microsoft Teams",
  TEAMS: "Microsoft Teams",
  GMAIL: "Gmail",
  GOOGLECALENDAR: "Google Calendar",
  GOOGLEDRIVE: "Google Drive",
  GOOGLEDOCS: "Google Docs",
  ZOHO: "Zoho CRM",
  ZOHOCRM: "Zoho CRM",
  SLACK: "Slack",
  HUBSPOT: "HubSpot",
  SALESFORCE: "Salesforce",
  NOTION: "Notion",
  LINEAR: "Linear",
  GITHUB: "GitHub",
  GITLAB: "GitLab",
  ASANA: "Asana",
  JIRA: "Jira",
  CONFLUENCE: "Confluence",
  AIRTABLE: "Airtable",
  STRIPE: "Stripe",
};

function descriptionFor(toolkit: string): string {
  switch (toolkit) {
    case "OUTLOOK":
    case "MICROSOFTOUTLOOK":
      return "Mailbox & calendar — reads inbox, drafts replies in-thread, schedules meetings.";
    case "ZOHO":
    case "ZOHOCRM":
      return "Zoho CRM — reads leads/contacts/deals, logs activity, and triggers George on new customers and closed-won deals.";
    case "ONEDRIVE":
    case "MICROSOFTONEDRIVE":
      return "Cloud file storage — shared NDAs, contracts, and working files for the team.";
    case "TEAMS":
    case "MICROSOFTTEAMS":
      return "Microsoft Teams — channels, chats, meeting links.";
    case "GMAIL":
      return "Gmail mailbox — read, draft, send via review.";
    case "GOOGLECALENDAR":
      return "Google Calendar — read availability, create events.";
    case "GOOGLEDRIVE":
      return "Google Drive — shared docs, spreadsheets, working files.";
    case "GOOGLEDOCS":
      return "Google Docs — read and edit documents.";
    case "SLACK":
      return "Slack workspace — read channels, post messages.";
    case "HUBSPOT":
      return "HubSpot CRM — contacts, deals, activity sync.";
    case "ZOHO":
    case "ZOHOCRM":
      return "Zoho CRM — contacts, leads, deals.";
    case "SALESFORCE":
      return "Salesforce — accounts, contacts, opportunities.";
    case "NOTION":
      return "Notion — read pages, append blocks.";
    case "LINEAR":
      return "Linear — issues, projects, cycles.";
    case "GITHUB":
      return "GitHub — repositories, issues, pull requests.";
    case "JIRA":
      return "Jira — issues, projects, sprints.";
    case "ASANA":
      return "Asana — tasks, projects, teams.";
    case "AIRTABLE":
      return "Airtable — bases, tables, records.";
    case "STRIPE":
      return "Stripe — customers, subscriptions, invoices.";
    default:
      return "Connected via Composio.";
  }
}

function toTitle(slug: string): string {
  return slug
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function unwrapList(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const r = raw as { items?: unknown; data?: unknown };
  if (Array.isArray(r.items)) return r.items;
  if (Array.isArray(r.data)) return r.data;
  return [];
}

type RawAuthConfig = {
  id?: string;
  auth_config_id?: string;
  name?: string;
  label?: string;
  description?: string;
  appName?: string;
  toolkit_slug?: string;
  toolkit?: {
    slug?: string;
    name?: string;
    description?: string;
  };
};

type RawConnectedAccount = {
  id?: string;
  status?: string;
  appName?: string;
  toolkit?: { slug?: string };
  metadata?: { account_label?: string };
};

// ---------------------------------------------------------------------------
// Backward-compatible facade. The MCP tool layer used to import
// `listOrgConnections` / `ConnectionSummary`; keep both names exported so
// nothing else has to change today.
// ---------------------------------------------------------------------------
export type ConnectionSummary = IntegrationSummary;

export async function listOrgConnections(
  orgId: string,
): Promise<ConnectionSummary[]> {
  return listOrgIntegrations(orgId);
}
