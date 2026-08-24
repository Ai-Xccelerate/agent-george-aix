/**
 * Which mailbox and calendar George is actually operating from.
 *
 * WHY THIS EXISTS
 * Two settings screens describe George's accounts, and both used to read the
 * Composio connection directly. Once George has its own Nylas mailbox that
 * becomes a lie: the Identity page would show a team member's Outlook address
 * while George sends from george@aiwkr.com. A screen that misreports which
 * mailbox an agent uses is worse than one that says nothing, because someone
 * will act on it.
 *
 * So both screens ask this one question instead, and it answers for whichever
 * provider is actually in use.
 *
 * The two providers are genuinely different in kind, and the UI should reflect
 * that rather than flatten it:
 *
 *   nylas    George's OWN mailbox, provisioned by API. Nothing to connect, no
 *            OAuth, no user action — it simply exists. Presenting it with a
 *            "Connect" button would offer an action that does not exist.
 *   composio A person's Microsoft 365 account, linked by OAuth. Someone has to
 *            sign in, and it can be disconnected.
 */
import { createNylasClient, isNylasEnabled, nylasConfig } from "@/lib/nylas/client";
import { mailSelection } from "./mail-selection";
import {
  listOrgIntegrations,
  type IntegrationSummary,
} from "@/lib/composio/connections";

/** First connected account among the given toolkits. Mirrors what the Identity
 *  page did inline before this helper existed. */
function connectedAccountLabel(
  integrations: IntegrationSummary[],
  toolkits: string[],
): string | null {
  const set = new Set(toolkits);
  const match = integrations.find((i) => set.has(i.toolkit) && i.status === "connected");
  if (!match) return null;
  return match.accountLabel ?? match.label;
}

export type MailProviderStatus = {
  provider: "nylas" | "composio" | "none";
  /** The mailbox address, or a human label when there isn't one. */
  mailbox: string | null;
  /** How the calendar should be described. */
  calendar: string | null;
  /** Reachable right now — for Nylas this is a live check. */
  connected: boolean;
  /** Whether a human can connect or disconnect it from the UI. */
  userConnectable: boolean;
  /** Extra detail for the status card (folder count, or why it failed). */
  detail: string | null;
};

/**
 * George's own mailbox needs no per-org lookup today (one mailbox, from env), so
 * orgId is only used for the Composio path. It stays in the signature because
 * per-org mailboxes are the obvious next step and every caller already has it.
 */
export async function getMailProviderStatus(orgId: string): Promise<MailProviderStatus> {
  if (mailSelection().provider === "nylas" && mailSelection().configured) {
    const cfg = nylasConfig()!;
    const configured = cfg.fromEmail ?? "George's own mailbox";

    // Live check, so "connected" means connected now rather than "was configured
    // at some point". Fails soft: an outage should degrade this card, not break
    // the settings page.
    const grant = await createNylasClient(cfg).grant();
    if (!grant.ok) {
      return {
        provider: "nylas",
        mailbox: configured,
        calendar: "George's own calendar",
        connected: false,
        userConnectable: false,
        detail: grant.error,
      };
    }

    const address = grant.data.email ?? configured;
    const folders = await createNylasClient(cfg).listFolders();
    const folderCount = folders.ok ? folders.data.length : null;

    return {
      provider: "nylas",
      mailbox: address,
      calendar: "George's own calendar",
      connected: grant.data.grant_status === "valid",
      userConnectable: false,
      detail:
        folderCount !== null
          ? `${folderCount} folders · primary calendar`
          : "mailbox reachable",
    };
  }

  // Composio: a person's account, linked by OAuth.
  const result = await listOrgIntegrations(orgId);
  const integrations = result.ok ? result.integrations : [];
  const label = connectedAccountLabel(integrations, [
    "OUTLOOK",
    "MICROSOFTOUTLOOK",
    "GMAIL",
  ]);

  if (!label) {
    return {
      provider: "none",
      mailbox: null,
      calendar: null,
      connected: false,
      userConnectable: true,
      detail: result.ok ? null : result.error,
    };
  }

  return {
    provider: "composio",
    mailbox: label,
    calendar: `Synced with ${label}`,
    connected: true,
    userConnectable: true,
    detail: "Linked Microsoft 365 account",
  };
}
