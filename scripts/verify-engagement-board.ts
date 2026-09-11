/**
 * Run the board against the live database and print it.
 *
 * The unit tests use the 2026-09-04 figures as fixtures; this proves the
 * loader feeds the same numbers the scorer was tested on. Rahul's acceptance
 * test was explicit: if Amnet Digital is not at or near the top, the
 * thresholds are wrong.
 *
 *   pnpm tsx scripts/verify-engagement-board.ts
 */
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { loadEngagementFacts } from "@/lib/agent/engagement-facts";
import { rankEngagement } from "@/lib/agent/engagement-board";

const ORG = process.argv[2] ?? "b716e8dd-db8f-4f68-9ff2-f4babda9ddd2";

async function main() {

  const facts = await loadEngagementFacts(createSupabaseAdmin(), ORG);
  const { scored, unscored } = rankEngagement(facts);

  const line = (n: string, s: string, d: string, r: string, t: string) =>
    `${n.padEnd(24)}${s.padEnd(14)}${d.padStart(8)}  ${r.padStart(10)}  ${t}`;

  console.log("\n" + line("ACCOUNT", "STATE", "DRIFT", "SILENT", "TREND"));
  console.log("-".repeat(78));
  for (const r of scored) {
    console.log(
      line(
        r.name,
        r.state,
        r.drift === null ? "—" : `${r.drift.toFixed(1)}x`,
        r.silentDays === null ? "never" : `${r.silentDays}d`,
        r.trend,
      ),
    );
  }
  console.log("\n-- not enough history " + "-".repeat(55));
  for (const r of unscored) {
    console.log(
      line(r.name, r.state, "—", r.silentDays === null ? "never" : `${r.silentDays}d`, r.trend),
    );
  }

  const top = scored[0];
  const amnetRank = scored.findIndex((r) => r.name.startsWith("Amnet"));
  console.log(`\nACCEPTANCE: Amnet Digital rank ${amnetRank + 1} of ${scored.length} scored`);
  console.log(`            top of board: ${top?.name} (${top?.state}, ${top?.drift}x)`);
  if (amnetRank !== 0) {
    console.log(`            NOTE: not first — check thresholds`);
  }
  const fabricated = [...scored, ...unscored].filter(
    (r) => r.drift !== null && r.contactWeeks < 2,
  );
  console.log(`            fabricated scores (contactWeeks < 2 with a drift): ${fabricated.length}`);

}

main();
