/**
 * How long does /customers/[id] actually spend in the database?
 *
 * Written before changing anything, because "the UI is slow" has at least three
 * plausible causes — server render, database round-trips, and bundle size — and
 * optimising the wrong one is work that produces no change the user can feel.
 *
 * This measures the middle one: the exact query sequence the page performs, in
 * the order it performs it, with the waterfall depth made visible. Round-trip
 * depth is the number that matters on a hosted database — five queries issued
 * together cost one latency; five issued in sequence cost five.
 *
 *   pnpm tsx scripts/profile-customer-page.ts <customerId>
 */
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import { checkOnboardingPreconditions } from "@/lib/agent/onboarding-preconditions";

const customerId = process.argv[2];
if (!customerId) {
  console.error("usage: pnpm tsx scripts/profile-customer-page.ts <customerId>");
  process.exit(1);
}

type Stage = { name: string; ms: number; queries: number; depth: number };
const stages: Stage[] = [];

async function stage<T>(name: string, queries: number, depth: number, fn: () => Promise<T>) {
  const t0 = performance.now();
  const out = await fn();
  stages.push({ name, ms: performance.now() - t0, queries, depth });
  return out;
}

async function main() {
  const db = createSupabaseAdmin();

  const cust = await db.from("customers").select("org_id").eq("id", customerId).maybeSingle();
  const orgId = cust.data?.org_id as string | undefined;
  if (!orgId) throw new Error(`no customer ${customerId}`);

  // Warm the connection so the first stage is not charged for TLS setup.
  await db.from("orgs").select("id").limit(1);

  await stage("batch 1 (customer + contacts)", 2, 1, () =>
    Promise.all([
      db.from("customers").select("*").eq("id", customerId).maybeSingle(),
      db.from("contacts").select("*").eq("customer_id", customerId),
    ]),
  );

  await stage("batch 2 (plan + steps + health)", 3, 1, () =>
    Promise.all([
      db.from("onboarding_plans").select("*").eq("customer_id", customerId).limit(1),
      db.from("onboarding_steps").select("*").eq("customer_id", customerId),
      db.from("customer_health").select("*").eq("customer_id", customerId).limit(10),
    ]),
  );

  await stage("getAgentSettings", 1, 1, () => getAgentSettings(db, orgId));

  // PostgREST builders are thenable but not Promises, so each is awaited inside
  // the callback rather than returned from it.
  await stage("escalations", 1, 1, async () => {
    await db.from("escalations").select("*").eq("customer_id", customerId).limit(20);
  });

  await stage("org members (approver names)", 1, 1, async () => {
    await db.from("org_members").select("user_id, role").eq("org_id", orgId);
  });

  await stage("checkOnboardingPreconditions", 5, 3, () =>
    checkOnboardingPreconditions(db, orgId, customerId),
  );

  const total = stages.reduce((a, s) => a + s.ms, 0);
  const depth = stages.reduce((a, s) => a + s.depth, 0);
  const queries = stages.reduce((a, s) => a + s.queries, 0);

  console.log("");
  console.log("stage                              ms     queries  round-trips");
  console.log("-".repeat(64));
  for (const s of stages) {
    console.log(
      s.name.padEnd(34) +
        s.ms.toFixed(0).padStart(5) +
        String(s.queries).padStart(10) +
        String(s.depth).padStart(13),
    );
  }
  console.log("-".repeat(64));
  console.log(
    "TOTAL".padEnd(34) + total.toFixed(0).padStart(5) + String(queries).padStart(10) + String(depth).padStart(13),
  );
  console.log("");
  console.log(`Sequential round-trips before the page can render: ${depth}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
