/**
 * Read-only diagnostic: list every channel='email' session and whether it has
 * a linking agent_events row (and from which source).
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sessions = await admin
    .from("agent_sessions")
    .select("id, title, channel, created_at")
    .eq("channel", "email")
    .order("created_at", { ascending: false })
    .limit(50);
  console.log(`channel='email' sessions: ${sessions.data?.length ?? 0}`);

  const events = await admin
    .from("agent_events")
    .select("id, source, event_type, status, session_id, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const bySession = new Map<string, { source: string; event_type: string; status: string }>();
  for (const e of events.data ?? []) {
    if (e.session_id) bySession.set(e.session_id, e);
  }
  console.log(`agent_events rows (any source): ${events.data?.length ?? 0}`);
  const sourceCounts: Record<string, number> = {};
  for (const e of events.data ?? []) {
    sourceCounts[e.source] = (sourceCounts[e.source] ?? 0) + 1;
  }
  console.log("  by source:", sourceCounts);

  console.log("\nSessions (newest first):");
  for (const s of sessions.data ?? []) {
    const ev = bySession.get(s.id);
    console.log(
      `  ${s.created_at} ${s.id.slice(0, 8)}  source=${ev?.source ?? "—"}  status=${ev?.status ?? "—"}  title="${s.title?.slice(0, 60)}"`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
