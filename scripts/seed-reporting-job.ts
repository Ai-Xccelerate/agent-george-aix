/**
 * Seed (idempotent) the weekly "owner status reports" standing job.
 *
 *   pnpm tsx scripts/seed-reporting-job.ts
 *
 * Creates one recurring agent_jobs row that, each week, has George draft a
 * status digest to each customer's relationship owner. Re-running updates the
 * directive/cron in place (matched by org + name) without resetting the clock.
 *
 * The job runs through the normal standing-jobs path (runGeorgeJob, autonomous
 * mode → drafts only, reviewed by a human). The cron now fires in-process via
 * src/instrumentation.ts, so once seeded this runs on schedule.
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { computeNextRun } from "../src/lib/agent/cron";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const JOB_NAME = "Weekly owner reports";
const CRON = "0 8 * * 1"; // Monday 08:00, in the org's timezone
const DIRECTIVE = [
  "Weekly owner status reports.",
  "Group the org's active customers (lifecycle onboarding / active / at_risk) by their relationship owner, and draft EACH owner a single digest email covering their customers — in a done / pending / at-risk / next-milestone shape, two or three things that matter per customer (never a catalog).",
  "Pull the real state first: list_customers (active/onboarding/at_risk), then per customer get_customer (owner, objectives, plan, health) and list_objectives. Flag objectives stuck past their nudge limit and any slipping deadlines, and lead with anything at-risk.",
  "Leave the emails as drafts for review — do not send.",
  "Follow the 'Reporting to owners' guidance in core/03-agent-george-lifecycle-steps.md.",
].join(" ");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  // Single-tenant: resolve the org (prefer getonyx.ai, else the only one).
  const orgRes = await supabase
    .from("orgs")
    .select("id, default_timezone, domain, name")
    .order("created_at", { ascending: true });
  if (orgRes.error) throw new Error(orgRes.error.message);
  const orgs = orgRes.data ?? [];
  const org =
    orgs.find((o) => (o.domain ?? "").toLowerCase() === "getonyx.ai") ?? orgs[0];
  if (!org) throw new Error("No org found to attach the reporting job to.");
  const tz = org.default_timezone ?? "UTC";

  const existing = await supabase
    .from("agent_jobs")
    .select("id")
    .eq("org_id", org.id)
    .eq("name", JOB_NAME)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  if (existing.data) {
    const upd = await supabase
      .from("agent_jobs")
      .update({ directive: DIRECTIVE, cron: CRON, timezone: tz, enabled: true })
      .eq("id", existing.data.id)
      .select("id, name, cron, next_run_at")
      .single();
    if (upd.error) throw new Error(upd.error.message);
    console.log("✓ Updated existing reporting job:", upd.data);
    return;
  }

  const nextRun = computeNextRun(CRON, tz);
  const ins = await supabase
    .from("agent_jobs")
    .insert({
      org_id: org.id,
      name: JOB_NAME,
      directive: DIRECTIVE,
      cron: CRON,
      timezone: tz,
      enabled: true,
      next_run_at: nextRun.toISOString(),
    })
    .select("id, name, cron, timezone, next_run_at")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  console.log(`✓ Created reporting job for org "${org.name}" (tz=${tz}):`, ins.data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
