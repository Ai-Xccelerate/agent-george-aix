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

  // ── Wave 1. Everything that needs only (orgId, customerId). ───────────
  // Depth 3, not 1: checkOnboardingPreconditions is itself a three-deep chain,
  // so the batch cannot finish sooner than its slowest member.
  await stage("wave 1 (9 reads, incl. preconditions)", 9, 3, () =>
    Promise.all([
      db.from("customers").select("*").eq("id", customerId).maybeSingle(),
      db.from("contacts").select("*").eq("customer_id", customerId),
      db.from("contracts").select("*").eq("customer_id", customerId),
      db.from("onboarding_plans").select("*").eq("customer_id", customerId).limit(1),
      db.from("customer_health").select("*").eq("customer_id", customerId).limit(10),
      getAgentSettings(db, orgId),
      checkOnboardingPreconditions(db, orgId, customerId),
      db.from("customer_observations").select("*").eq("customer_id", customerId).limit(25),
      // migration 0009 — the account narrative.
      db.from("customer_narrative").select("*").eq("customer_id", customerId).maybeSingle(),
    ]),
  );

  // ── Wave 2. Needs the customer row from wave 1. ────────────────────────
  await stage("wave 2 (10 reads, incl. evidence counts)", 10, 1, () =>
    Promise.all([
      db.from("customers").select("*").eq("parent_customer_id", customerId),
      db.from("cadences").select("*").eq("customer_id", customerId).limit(1),
      db.from("documents").select("*").eq("customer_id", customerId).limit(100),
      db.from("objectives").select("*").eq("customer_id", customerId),
      db.from("org_members").select("*").eq("org_id", orgId).limit(1),
      db.from("agent_sessions").select("*").eq("customer_id", customerId).limit(8),
      db.from("audit_log").select("*").eq("customer_id", customerId).limit(8),
      db
        .from("meeting_transcripts")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId),
      db
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId),
      db.from("onboarding_steps").select("*").eq("customer_id", customerId),
    ]),
  );

  // ── Wave 3. Source resolution + escalations + the named approver. ──────
  // These were three sequential awaits when first written, which put depth back
  // to 8. Batched, they cost one latency between them.
  await stage("wave 3 (sources + decisions + approver)", 3, 1, () =>
    Promise.all([
      db.from("meeting_transcripts").select("id, title, started_at").limit(25),
      db.from("escalations").select("*").eq("customer_id", customerId).limit(10),
      db.from("agent_settings").select("owner_user_id").eq("org_id", orgId).limit(1),
    ]),
  );

  // ── In front of all of it: getCurrentUser. ─────────────────────────────
  // On a cache hit this is the ONE query it still makes — the role lookup, kept
  // live because it gates permissions. The five round-trips and two Clerk API
  // calls it replaced are what made every page slow, not this page's own reads.
  await stage("getCurrentUser warm path", 1, 1, async () => {
    await db.from("org_members").select("role").eq("org_id", orgId).limit(1);
  });

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
