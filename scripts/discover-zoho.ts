/**
 * Zoho CRM discovery — run AFTER connecting Zoho in Composio.
 *
 *   pnpm tsx scripts/discover-zoho.ts
 *
 * Phase 2 of the evolve plan needs the *real* Composio slugs for Zoho, not
 * guesses. This script reads them straight from Composio so we can wire the
 * tools and the new-customer / closed-won trigger against verified names.
 *
 * Prereq (manual, in the Composio dashboard):
 *   1. Create a Zoho CRM auth config (ac_xxxx).
 *   2. Connect the Onyx Zoho account via /settings/integrations (or the
 *      dashboard), bound to the same org identity as Outlook (org-<orgId>).
 *   3. (optional) Put the auth config id in .env.local as COMPOSIO_AUTH_CONFIG_ZOHO.
 *
 * What it prints:
 *   - the Zoho connected account (id, user_id, status)
 *   - available Zoho trigger types (look for "new lead/contact" and a
 *     deal/stage "closed-won" trigger) with their config field names
 *   - a sample of Zoho action slugs (e.g. ZOHO_CRM_* for read/write tools)
 *
 * Nothing is created or modified — discovery only.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const COMPOSIO_API = "https://backend.composio.dev/api/v3";
const ZOHO_SLUGS = ["zoho", "zohocrm"];

function require_(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} is not set`);
    process.exit(1);
  }
  return v;
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!res.ok) {
    console.warn(`   (HTTP ${res.status} for ${url})`);
    return null;
  }
  return res.json();
}

async function main() {
  const apiKey = require_("COMPOSIO_API_KEY");

  // 1. Find the Zoho connected account.
  console.log("⏳ Listing connected accounts to locate Zoho…");
  const accountsBody = (await getJson(
    `${COMPOSIO_API}/connected_accounts?limit=100`,
    apiKey,
  )) as { items?: Array<{ id: string; toolkit?: { slug?: string }; status?: string }> } | null;
  const accounts = accountsBody?.items ?? [];
  const zoho = accounts.find((a) =>
    ZOHO_SLUGS.includes((a.toolkit?.slug ?? "").toLowerCase()),
  );

  if (!zoho) {
    console.error(
      "✗ No Zoho connected account found. Connect Zoho via /settings/integrations first.",
    );
    console.error(
      `   Found toolkits: ${[...new Set(accounts.map((a) => a.toolkit?.slug ?? "?"))].join(", ") || "(none)"}`,
    );
    process.exit(1);
  }

  const detail = (await getJson(
    `${COMPOSIO_API}/connected_accounts/${zoho.id}`,
    apiKey,
  )) as { id: string; user_id?: string; status?: string } | null;
  console.log(
    `✓ Zoho connected account: id=${zoho.id} user_id=${detail?.user_id ?? "?"} status=${detail?.status ?? zoho.status}`,
  );

  // 2. List Zoho trigger types — we need the new-customer + closed-won slugs.
  console.log("\n⏳ Fetching Zoho trigger types…");
  for (const slug of ZOHO_SLUGS) {
    const triggers = (await getJson(
      `${COMPOSIO_API}/triggers_types?toolkit_slugs=${slug}&limit=100`,
      apiKey,
    )) as { items?: Array<{ slug?: string; name?: string; config?: { properties?: Record<string, unknown> } }> } | null;
    const items = triggers?.items ?? [];
    if (items.length) {
      console.log(`\n  Triggers for toolkit "${slug}":`);
      for (const t of items) {
        const cfg = Object.keys(t.config?.properties ?? {}).join(", ") || "(none)";
        console.log(`   - ${t.slug}  «${t.name}»  config: ${cfg}`);
      }
    }
  }

  // 3. Sample of Zoho action slugs (the read/write tools we'll wrap).
  console.log("\n⏳ Fetching a sample of Zoho action slugs…");
  for (const slug of ZOHO_SLUGS) {
    const tools = (await getJson(
      `${COMPOSIO_API}/tools?toolkit_slugs=${slug}&limit=60`,
      apiKey,
    )) as { items?: Array<{ slug?: string; name?: string }> } | null;
    const items = tools?.items ?? [];
    if (items.length) {
      console.log(`\n  Actions for toolkit "${slug}" (first ${items.length}):`);
      for (const t of items) console.log(`   - ${t.slug}  «${t.name}»`);
    }
  }

  console.log(
    "\n◌ Discovery complete. Paste the new-customer + closed-won trigger slugs and the read/write action slugs back so the Zoho tools + trigger get wired against verified names.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
