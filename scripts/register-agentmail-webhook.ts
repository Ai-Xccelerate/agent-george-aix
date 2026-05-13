/**
 * Register the Agentmail webhook so `message.received` events POST to our
 * production webhook URL.
 *
 *   pnpm tsx scripts/register-agentmail-webhook.ts                # dry-run
 *   pnpm tsx scripts/register-agentmail-webhook.ts --create        # create
 *   pnpm tsx scripts/register-agentmail-webhook.ts --create --replace
 *       # delete any pre-existing endpoint with the same URL and recreate
 *
 * After --create, the script prints the `whsec_...` signing secret. Paste
 * that into:
 *   - .env.local as AGENTMAIL_WEBHOOK_SECRET
 *   - Vercel → Project Settings → Environment Variables → Production
 * Then trigger a redeploy.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { AgentMailClient } from "agentmail";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const TARGET_URL =
  (process.env.AGENTMAIL_WEBHOOK_URL?.trim() ||
    `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")}/api/webhooks/agentmail`) ?? "";

const SHOULD_CREATE = process.argv.includes("--create");
const SHOULD_REPLACE = process.argv.includes("--replace");

async function main() {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    console.error("✗ AGENTMAIL_API_KEY missing");
    process.exit(1);
  }
  if (!TARGET_URL || !TARGET_URL.startsWith("https://")) {
    console.error(
      `✗ Resolved target URL is not https. Got: "${TARGET_URL}". ` +
        "Set AGENTMAIL_WEBHOOK_URL or NEXT_PUBLIC_APP_URL (https://...) in .env.local.",
    );
    process.exit(1);
  }

  const client = new AgentMailClient({ apiKey });

  // List existing webhooks first — Agentmail allows multiple endpoints per
  // account, so we want to either reuse, replace, or warn about duplicates.
  console.log("⏳ Listing existing webhook endpoints…");
  let existing: Array<{ webhookId?: string; url?: string }> = [];
  try {
    const list = (await (
      client as unknown as {
        webhooks: { list: () => Promise<{ webhooks?: typeof existing; items?: typeof existing }> };
      }
    ).webhooks.list()) as { webhooks?: typeof existing; items?: typeof existing };
    existing = list.webhooks ?? list.items ?? [];
  } catch (err) {
    console.warn("   (could not list — proceeding)", err);
  }

  const samesie = existing.find((w) => w.url === TARGET_URL);
  if (samesie) {
    console.log(
      `⚠ Endpoint already exists for this URL: ${samesie.webhookId} → ${samesie.url}`,
    );
    if (SHOULD_REPLACE && SHOULD_CREATE && samesie.webhookId) {
      console.log(`⏳ Deleting ${samesie.webhookId} before recreating…`);
      await (
        client as unknown as {
          webhooks: { delete: (id: string) => Promise<unknown> };
        }
      ).webhooks.delete(samesie.webhookId);
    } else if (SHOULD_CREATE) {
      console.log(
        "   Pass --replace to delete + recreate, or fetch the existing secret manually.",
      );
      process.exit(0);
    }
  }

  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Event types: message.received`);

  if (!SHOULD_CREATE) {
    console.log("\n◌ Dry-run complete. Rerun with --create to register.");
    return;
  }

  console.log("\n⏳ Creating webhook…");
  const created = (await (
    client as unknown as {
      webhooks: {
        create: (opts: {
          url: string;
          eventTypes: string[];
        }) => Promise<{ webhookId?: string; secret?: string; url?: string }>;
      };
    }
  ).webhooks.create({
    url: TARGET_URL,
    eventTypes: ["message.received"],
  })) as { webhookId?: string; secret?: string; url?: string };

  console.log("✓ Created:");
  console.log(`   id:     ${created.webhookId}`);
  console.log(`   url:    ${created.url}`);
  console.log(`   secret: ${created.secret}`);
  console.log("\nNext: copy the secret to .env.local + Vercel as AGENTMAIL_WEBHOOK_SECRET, then redeploy.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
