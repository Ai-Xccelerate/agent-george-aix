/**
 * One-time backfill: generate `suggested_actions` for open escalations raised
 * before the field existed (empty suggested_actions). New decisions get them
 * from George directly via raise_decision.
 *
 * Usage:  pnpm tsx scripts/backfill-escalation-actions.ts
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { generateSuggestedActions } from "../src/lib/agent/escalation-actions";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.ANTHROPIC_API_KEY
) {
  console.error(
    "Missing env — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type Row = {
  id: string;
  title: string;
  detail: string | null;
  recommendation: string | null;
  suggested_actions: unknown;
};

async function main() {
  const { data, error } = await supabase
    .from("escalations")
    .select("id, title, detail, recommendation, suggested_actions")
    .eq("status", "open");
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  const todo = rows.filter(
    (r) => !Array.isArray(r.suggested_actions) || r.suggested_actions.length === 0,
  );
  console.log(`${rows.length} open decision(s); ${todo.length} missing suggested actions.`);

  let done = 0;
  for (const r of todo) {
    const actions = await generateSuggestedActions({
      title: r.title,
      detail: r.detail,
      recommendation: r.recommendation,
    });
    if (!actions) {
      console.warn(`  · ${r.title} — nothing generated, skipping`);
      continue;
    }
    const upd = await supabase
      .from("escalations")
      .update({ suggested_actions: actions })
      .eq("id", r.id);
    if (upd.error) {
      console.error(`  · ${r.title} — update failed: ${upd.error.message}`);
      continue;
    }
    done++;
    console.log(`  ✓ ${r.title} — ${actions.map((a) => a.label).join(" | ")}`);
  }

  console.log(`Backfill complete: ${done}/${todo.length} enriched.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
