/**
 * Manually run a mailbox + calendar sync for the Onyx org.
 *
 *   pnpm tsx scripts/sync-mailbox.ts
 *
 * Idempotent — safe to run repeatedly; a second run should be a near no-op
 * (delta tokens round-trip, upserts converge on (org_id, external_id)).
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

import { syncMailbox } from "../src/lib/agent/mailbox-sync";

const ORG = process.env.ONYX_ORG_ID ?? "00000000-0000-0000-0000-000000000001";

(async () => {
  console.log(`Syncing mailbox for org ${ORG} …`);
  const r = await syncMailbox(ORG);
  console.log(JSON.stringify(r, null, 2));
  if (r.errors.length) process.exitCode = 1;
})();
