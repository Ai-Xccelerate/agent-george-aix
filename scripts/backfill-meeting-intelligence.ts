/**
 * One-time backfill: generate sentiment + learnings for transcripts that were
 * synced before meeting-intelligence existed. Normal sync skips meetings that
 * already have transcript text, so those rows never get enriched otherwise.
 *
 * Targets rows with transcript_text set and no `insights.sentiment` yet.
 *
 * Usage:  pnpm tsx scripts/backfill-meeting-intelligence.ts
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { analyzeMeetingIntelligence } from "../src/lib/agent/meeting-intelligence";

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
  title: string | null;
  summary: string | null;
  transcript_text: string | null;
  insights: unknown;
};

function hasSentiment(insights: unknown): boolean {
  return (
    !!insights &&
    typeof insights === "object" &&
    typeof (insights as Record<string, unknown>).sentiment === "string"
  );
}

async function main() {
  const { data, error } = await supabase
    .from("meeting_transcripts")
    .select("id, title, summary, transcript_text, insights")
    .not("transcript_text", "is", null);
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  const todo = rows.filter((r) => r.transcript_text && !hasSentiment(r.insights));
  console.log(
    `${rows.length} transcript(s) with text; ${todo.length} missing sentiment — backfilling.`,
  );

  let done = 0;
  for (const r of todo) {
    const label = r.title || r.id;
    const intel = await analyzeMeetingIntelligence({
      transcriptText: r.transcript_text,
      summary: r.summary,
    });
    if (!intel) {
      console.warn(`  · ${label} — analysis returned nothing, skipping`);
      continue;
    }
    const base =
      r.insights && typeof r.insights === "object"
        ? (r.insights as Record<string, unknown>)
        : {};
    const insights = {
      ...base,
      sentiment: intel.sentiment,
      sentiment_rationale: intel.sentiment_rationale,
      learnings: intel.learnings,
    };
    const upd = await supabase
      .from("meeting_transcripts")
      .update({ insights })
      .eq("id", r.id);
    if (upd.error) {
      console.error(`  · ${label} — update failed: ${upd.error.message}`);
      continue;
    }
    done++;
    console.log(`  ✓ ${label} — ${intel.sentiment} · ${intel.learnings.length} learnings`);
  }

  console.log(`Backfill complete: ${done}/${todo.length} enriched.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
