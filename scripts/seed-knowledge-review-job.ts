/**
 * Seed (idempotent) the weekly "knowledge review" standing job.
 *
 *   pnpm tsx scripts/seed-knowledge-review-job.ts
 *
 * Each week, George compiles the knowledge he's proposed since the last review
 * and drafts a digest to the configured knowledge reviewers (e.g. Nawaz, John)
 * so they can approve or reject in Settings → Agent George → Knowledge review.
 *
 * Runs through the normal standing-jobs path (autonomous → drafts only, never
 * sends; never publishes knowledge). Re-running updates the directive/cron in
 * place without resetting the clock.
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { computeNextRun } from "../src/lib/agent/cron";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const JOB_NAME = "Weekly knowledge review";
const CRON = "0 9 * * 1"; // Monday 09:00, in the org's timezone
const DIRECTIVE = [
  "Weekly knowledge review digest for the knowledge reviewers.",
  "Call list_pending_knowledge to get every knowledge proposal awaiting review.",
  "If there are none, note that no new knowledge was proposed this week and stop — do not draft an empty email.",
  "Otherwise draft a single digest email to the configured knowledge reviewers (named in your identity settings) that lists each pending proposal: its title, type, the source it came from, and a one-line rationale, grouped so the most useful land first.",
  "Tell them they can approve or reject each in Settings → Agent George → Knowledge review. Leave it as a draft — do not send. Do not approve or publish anything yourself; approval is a human action.",
].join(" ");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const orgRes = await supabase
    .from("orgs")
    .select("id, default_timezone, domain, name")
    .order("created_at", { ascending: true });
  if (orgRes.error) throw new Error(orgRes.error.message);
  const orgs = orgRes.data ?? [];
  const org =
    orgs.find((o) => (o.domain ?? "").toLowerCase() === "getonyx.ai") ?? orgs[0];
  if (!org) throw new Error("No org found to attach the knowledge-review job to.");
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
    console.log("✓ Updated existing knowledge-review job:", upd.data);
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
  console.log(`✓ Created knowledge-review job for org "${org.name}" (tz=${tz}):`, ins.data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
