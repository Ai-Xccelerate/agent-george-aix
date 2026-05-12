/**
 * Sanity check Composio wiring before clicking Connect.
 *
 *   pnpm tsx scripts/verify-composio.ts
 *
 * Reports: API key validity, auth config existence + toolkit, expected redirect URL shape.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const API_KEY = process.env.COMPOSIO_API_KEY;
const AUTH_CFG = {
  OUTLOOK: process.env.COMPOSIO_AUTH_CONFIG_OUTLOOK,
  FIREFLIES: process.env.COMPOSIO_AUTH_CONFIG_FIREFLIES,
  ONEDRIVE: process.env.COMPOSIO_AUTH_CONFIG_ONEDRIVE,
};

if (!API_KEY) {
  console.error("✗ COMPOSIO_API_KEY missing");
  process.exit(1);
}

const BASE = "https://backend.composio.dev/api/v3";

async function call(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}

async function main() {
  console.log("⏳ Verifying COMPOSIO_API_KEY…");
  const me = await call("/auth_configs?limit=1");
  if (me.status === 401 || me.status === 403) {
    console.error(`✗ API key rejected (HTTP ${me.status}). Check COMPOSIO_API_KEY.`);
    process.exit(1);
  }
  if (me.status >= 400) {
    console.error(`✗ Unexpected HTTP ${me.status} on /auth_configs:`, me.body);
    process.exit(1);
  }
  console.log("✓ API key is valid (project responded).");

  for (const [name, id] of Object.entries(AUTH_CFG)) {
    if (!id) {
      console.log(`◌ ${name}: not set`);
      continue;
    }
    process.stdout.write(`⏳ Verifying ${name} auth config ${id}… `);
    const r = await call(`/auth_configs/${id}`);
    if (r.status === 200) {
      const ac = r.body as {
        id?: string;
        toolkit?: { slug?: string; name?: string };
        authScheme?: string;
        deprecated?: { isDeprecated?: boolean };
      };
      const tk = ac.toolkit?.slug?.toUpperCase() ?? ac.toolkit?.name ?? "?";
      const expected = name;
      const match = tk === expected ? "✓" : `✗ toolkit mismatch (got ${tk}, expected ${expected})`;
      console.log(`HTTP 200 — toolkit=${tk} scheme=${ac.authScheme ?? "?"}  ${match}`);
    } else if (r.status === 404) {
      console.log(`HTTP 404 — auth config not found in this project`);
    } else {
      console.log(`HTTP ${r.status} —`, r.body);
    }
  }

  console.log("\nCallback URL the connect flow will use:");
  console.log(
    `  ${process.env.NEXT_PUBLIC_APP_URL ?? "(NEXT_PUBLIC_APP_URL not set)"}/api/integrations/composio/callback`,
  );
  console.log("\nWhen you click Connect, the redirect target will be Microsoft (for Outlook),");
  console.log("Fireflies, or OneDrive's OAuth screen — never Composio's login.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
