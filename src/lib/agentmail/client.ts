import { AgentMailClient } from "agentmail";

/**
 * Agentmail is George's inbound-email channel for partners who'd rather
 * email a dedicated address (`george-onyx@agentmail.to`) than route through
 * the org's Outlook mailbox. Unlike Composio's notify-then-fetch model,
 * Agentmail delivers the full message body inside the webhook payload.
 *
 * Identity model: there is no per-org user_id on Agentmail's side. The
 * inbox itself (`AGENTMAIL_INBOX`) is the shared identity, and webhook
 * payloads include `message.inbox_id` so we can route on it later.
 *
 * Server-only — `AGENTMAIL_API_KEY` is workspace-scoped. Don't import this
 * from a client component.
 */
let cached: AgentMailClient | null = null;

export function getAgentmail(): AgentMailClient {
  if (cached) return cached;
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AGENTMAIL_API_KEY is not set. Add it to .env.local and reload.",
    );
  }
  cached = new AgentMailClient({ apiKey });
  return cached;
}
