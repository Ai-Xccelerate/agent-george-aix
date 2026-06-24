/**
 * One-shot: delete every channel='email' agent_sessions row (with their
 * agent_messages cascade) and every agent_events row that targets them.
 * Use after disabling firehose triggers / before adding sender-allowlist
 * filters to wipe spam/cold-outreach noise.
 *
 *   pnpm tsx scripts/cleanup-outlook-sessions.ts           # dry-run
 *   pnpm tsx scripts/cleanup-outlook-sessions.ts --apply   # actually delete
 *
 * Chat-channel sessions (your conversations with George) are preserved.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("✗ Supabase env vars missing");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. All email-channel sessions, then all events that target them.
  const sessionRes = await admin
    .from("agent_sessions")
    .select("id")
    .eq("channel", "email");
  if (sessionRes.error) {
    console.error("✗ Failed to read agent_sessions:", sessionRes.error.message);
    process.exit(1);
  }
  const sessionIds = (sessionRes.data ?? []).map((s) => s.id as string);

  // Capture every event that points at one of those sessions, plus any orphan
  // composio events not (yet) linked to a session.
  const eventsBySession = await admin
    .from("agent_events")
    .select("id")
    .in("session_id", sessionIds.length ? sessionIds : ["00000000-0000-0000-0000-000000000000"]);
  const eventsBySource = await admin
    .from("agent_events")
    .select("id")
    .in("source", ["composio"]);
  const eventIds = [
    ...new Set([
      ...(eventsBySession.data ?? []).map((e) => e.id as string),
      ...(eventsBySource.data ?? []).map((e) => e.id as string),
    ]),
  ];

  console.log(`Email-channel sessions:        ${sessionIds.length}`);
  console.log(`agent_events to delete:        ${eventIds.length}`);

  if (sessionIds.length > 0) {
    const msgCount = await admin
      .from("agent_messages")
      .select("id", { count: "exact", head: true })
      .in("session_id", sessionIds);
    console.log(`agent_messages in those:       ${msgCount.count ?? "?"}`);
  }

  if (!APPLY) {
    console.log("\n◌ Dry-run. Rerun with --apply to actually delete.");
    return;
  }

  // 2. Delete in dependency order.
  if (sessionIds.length > 0) {
    const mDel = await admin
      .from("agent_messages")
      .delete()
      .in("session_id", sessionIds);
    if (mDel.error) {
      console.error("✗ agent_messages delete failed:", mDel.error.message);
      process.exit(1);
    }
    console.log("✓ Deleted agent_messages rows for those sessions");
  }

  if (eventIds.length > 0) {
    const eDel = await admin
      .from("agent_events")
      .delete()
      .in("id", eventIds);
    if (eDel.error) {
      console.error("✗ agent_events delete failed:", eDel.error.message);
      process.exit(1);
    }
    console.log(`✓ Deleted ${eventIds.length} agent_events rows`);
  }

  if (sessionIds.length > 0) {
    const sDel = await admin
      .from("agent_sessions")
      .delete()
      .in("id", sessionIds);
    if (sDel.error) {
      console.error("✗ agent_sessions delete failed:", sDel.error.message);
      process.exit(1);
    }
    console.log(`✓ Deleted ${sessionIds.length} agent_sessions rows`);
  }

  console.log("\nDone. Chat-channel sessions are untouched.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
