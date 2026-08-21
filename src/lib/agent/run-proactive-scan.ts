import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { runGeorgeAutonomous } from "./run-autonomous";
import { getManagerContact } from "./process-event";

/**
 * George's proactive book sweep. On a cadence the cron tick wakes George once
 * per org to look across his channels and DECIDE what to do — not just chase
 * objectives a human already created. He reviews:
 *   - upcoming meetings (prep + context),
 *   - newly-recorded transcripts not yet acted on,
 *   - renewal clocks + health drift + accounts gone quiet,
 *   - objectives whose follow-up is due,
 * then acts (create/advance objectives, draft prep/recaps) or escalates.
 *
 * Trust boundary is the same as inbound email: internal sends allowed, external
 * draft-only. The run is recorded as a 'cron' session so the rollup shows in
 * chat history for the PM to review.
 */
export type ProactiveScanResult = {
  org_id: string;
  status: "succeeded" | "failed" | "timed_out" | "skipped";
  session_id: string | null;
  error: string | null;
};

export async function runProactiveScan(
  orgId: string,
  opts?: { timeBudgetMs?: number },
): Promise<ProactiveScanResult> {
  const admin = createSupabaseAdmin();
  const manager = await getManagerContact(admin, orgId);

  const sessionInsert = await admin
    .from("agent_sessions")
    .insert({
      org_id: orgId,
      user_id: null,
      channel: "cron",
      title: "Proactive scan",
    })
    .select("id")
    .single();
  if (sessionInsert.error || !sessionInsert.data) {
    return {
      org_id: orgId,
      status: "failed",
      session_id: null,
      error: sessionInsert.error?.message ?? "could not create session",
    };
  }
  const sessionId = sessionInsert.data.id as string;

  await admin.from("agent_messages").insert({
    session_id: sessionId,
    role: "user",
    content: "**Proactive scan** — review the book and decide what to do next.",
  });

  const result = await runGeorgeAutonomous({
    orgId,
    userPrompt: buildScanPrompt(manager),
    timeBudgetMs: opts?.timeBudgetMs ?? 240_000,
    clientAppTag: "agent-george-scan/0.1",
    sessionId,
    emailSendPolicy: "internal_only",
  });

  if (result.summary) {
    await admin.from("agent_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: result.summary,
    });
  }
  if (result.sdkSessionId) {
    await admin
      .from("agent_sessions")
      .update({ sdk_session_id: result.sdkSessionId })
      .eq("id", sessionId);
  }

  return { org_id: orgId, status: result.status, session_id: sessionId, error: result.error };
}

function buildScanPrompt(manager: { name: string | null; email: string | null } | null): string {
  const managerLine = manager?.email
    ? `${manager.name ?? "your manager"} <${manager.email}>`
    : "your manager (none configured — note it in your summary)";
  return [
    "Proactive scan. You're running autonomously — nobody is waiting on a reply.",
    "Sweep your book and decide what should happen next. Don't wait to be asked.",
    "",
    "## Review",
    "1. **Upcoming meetings** — `list_calendar` for the next 48 hours. For each, make",
    "   sure you have context on the customer (`get_customer`); jot prep notes / an",
    "   agenda. Flag any meeting with no customer tied to it.",
    "2. **New transcripts** — `list_transcripts`. Any recent meeting whose decisions",
    "   aren't yet reflected in the customer's plan/objectives? Act on it.",
    "3. **Renewal + health** — `list_customers`. Watch renewal clocks (T-90 / T-60 /",
    "   T-30 from contract end), at-risk health, and accounts with no recent touch.",
    "4. **Due objectives** — `list_due_objectives`; advance or follow up.",
    "5. **Open escalations** — `list_open_decisions`; for anything unresolved and",
    "   stale (> ~24h), send the manager a brief internal re-ping so it doesn't rot.",
    "",
    "## Act (don't just observe)",
    "- Create or advance objectives (`create_objective` / `update_objective`) for",
    "  anything that needs to move.",
    "- Draft prep notes, agendas, and nudges. Customer-facing email is always",
    "  draft-only for human review; short internal nudges you may send.",
    "- MEETING RECAPS ARE ALWAYS DRAFT-ONLY, internal recipients included. Summarising",
    "  a meeting to the people who were in it is not your job — draft it and let a",
    "  human decide who sees it.",
    `- When you don't know what to do or it needs a human call, use \`raise_decision\` (it lands on the team's Needs-you queue) and send a one-line heads-up to your manager: ${managerLine}.`,
    "- Don't invent pricing, SKUs, or commitments; ground customer-facing work in the",
    "  playbook (`read_knowledge_doc`).",
    "",
    "Keep it focused — surface the few things that actually matter this cycle, not a",
    "dump of everything. Finish with the structured Actions / Awaiting review / Notes",
    "summary.",
  ].join("\n");
}
