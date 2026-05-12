/**
 * Register the OUTLOOK_NEW_MESSAGE trigger for our Outlook connected account.
 *
 *   pnpm tsx scripts/register-outlook-trigger.ts          # dry-run: just inspect
 *   pnpm tsx scripts/register-outlook-trigger.ts --create # actually create
 *
 * What it does:
 *   1. Loads .env.local (COMPOSIO_API_KEY).
 *   2. Lists connected accounts and finds the Outlook one — we use the same
 *      userId the OAuth flow registered, so the trigger is bound to the right
 *      mailbox. This avoids having to know the Supabase org UUID up front.
 *   3. Fetches the trigger type schema for OUTLOOK_NEW_MESSAGE and prints the
 *      required config fields.
 *   4. (with --create) Creates the trigger.
 *
 * Composio will then POST events to the project-level webhook URL configured
 * in their dashboard — no in-process subscriber needed (we're on serverless).
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { Composio } from "@composio/core";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const TRIGGER_SLUG = "OUTLOOK_MESSAGE_TRIGGER";
const COMPOSIO_API = "https://backend.composio.dev/api/v3";
const SHOULD_CREATE = process.argv.includes("--create");

function require_(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} is not set`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const apiKey = require_("COMPOSIO_API_KEY");
  const composio = new Composio({ apiKey });

  // 1. Find the Outlook connected account
  console.log("⏳ Listing connected accounts to locate Outlook…");
  // The SDK shape varies by version — fall back to raw REST if .list isn't there.
  let accounts: Array<{
    id: string;
    userId?: string;
    toolkit?: { slug?: string };
    status?: string;
  }> = [];
  try {
    const raw = (await (composio as unknown as {
      connectedAccounts: { list: () => Promise<unknown> };
    }).connectedAccounts.list()) as { items?: typeof accounts };
    accounts = raw.items ?? [];
  } catch {
    const res = await fetch(
      "https://backend.composio.dev/api/v3/connected_accounts?limit=100",
      { headers: { "x-api-key": apiKey } },
    );
    const body = (await res.json()) as { items?: typeof accounts };
    accounts = body.items ?? [];
  }

  const outlookSummary = accounts.find(
    (a) => a.toolkit?.slug?.toLowerCase() === "outlook",
  );

  if (!outlookSummary) {
    console.error(
      "✗ No Outlook connected account found. Connect it via /settings/integrations first.",
    );
    console.error(
      `   Found toolkits: ${[...new Set(accounts.map((a) => a.toolkit?.slug ?? "?"))].join(", ") || "(none)"}`,
    );
    process.exit(1);
  }

  // The list endpoint doesn't include user_id — fetch the full row by id.
  const detailRes = await fetch(
    `${COMPOSIO_API}/connected_accounts/${outlookSummary.id}`,
    { headers: { "x-api-key": apiKey } },
  );
  const outlook = (await detailRes.json()) as {
    id: string;
    user_id?: string;
    status?: string;
  };
  if (!outlook.user_id) {
    console.error("✗ Connected account has no user_id — cannot proceed.");
    process.exit(1);
  }

  console.log(
    `✓ Outlook connected account: id=${outlook.id} user_id=${outlook.user_id} status=${outlook.status}`,
  );

  // 2. Inspect the trigger type
  console.log(`\n⏳ Fetching trigger type "${TRIGGER_SLUG}"…`);
  const typeRes = await fetch(
    `${COMPOSIO_API}/triggers_types/${TRIGGER_SLUG}`,
    { headers: { "x-api-key": apiKey } },
  );
  const typeBody = (await typeRes.json()) as {
    name?: string;
    type?: string;
    config?: { properties?: Record<string, unknown> };
  };
  console.log(
    `   name="${typeBody.name}" type=${typeBody.type} configFields=${Object.keys(typeBody.config?.properties ?? {}).length}`,
  );

  // 3. List existing trigger instances for this user to avoid duplicates
  console.log("\n⏳ Checking for existing trigger instances…");
  const existingRes = await fetch(
    `${COMPOSIO_API}/trigger_instances?user_id=${encodeURIComponent(outlook.user_id)}`,
    { headers: { "x-api-key": apiKey } },
  );
  let duplicate: { id?: string; trigger_name?: string; status?: string } | undefined;
  if (existingRes.ok) {
    const existing = (await existingRes.json()) as {
      items?: Array<{ id?: string; trigger_name?: string; status?: string }>;
    };
    duplicate = existing.items?.find((t) => t.trigger_name === TRIGGER_SLUG);
    if (duplicate) {
      console.log(
        `⚠ Trigger already exists: id=${duplicate.id} status=${duplicate.status}. Skipping create.`,
      );
    } else {
      console.log(
        `   No existing ${TRIGGER_SLUG} instance for this user (${existing.items?.length ?? 0} other instances).`,
      );
    }
  } else {
    console.log(
      `   (skipped duplicate check — HTTP ${existingRes.status}; will rely on create idempotency)`,
    );
  }

  // 4. Create if requested
  if (!SHOULD_CREATE) {
    console.log(
      "\n◌ Dry-run complete. Rerun with --create to actually register the trigger.",
    );
    return;
  }
  if (duplicate) {
    console.log("◌ Not creating — duplicate exists.");
    return;
  }

  console.log("\n⏳ Creating trigger…");
  const userId = outlook.user_id;
  const created = await (composio as unknown as {
    triggers: {
      create: (
        userId: string,
        slug: string,
        opts: { triggerConfig: Record<string, unknown> },
      ) => Promise<{ triggerId?: string; id?: string }>;
    };
  }).triggers.create(userId, TRIGGER_SLUG, {
    triggerConfig: {}, // empty = all new messages, default folder
  });
  console.log("✓ Created:", created);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
