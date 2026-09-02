/**
 * Objectives scan — the time-based half of the macro layer.
 *
 * Each tick: find objectives whose follow-up clock is due (status='awaiting',
 * next_followup_at <= now), group them by customer, and wake George once per
 * customer to judge-and-act — is each objective achieved? if not, follow up; if
 * past the nudge limit or the deadline, escalate to the owner.
 *
 * Anti-respin lease: before handing a customer's objectives to George, advance
 * their next_followup_at to now + interval. A crashed/erroring run then can't
 * make the same objective re-fire every minute — worst case it retries one
 * interval later. George's own update_objective(bump_followup) on a real nudge
 * recomputes the same now+interval, so the lease is harmless on success.
 *
 * Only customers actually processed this tick are leased; the rest stay due and
 * get picked up on a later tick (a backlog drains a few customers per minute).
 *
 * Correctness leans on per-row state (status + next_followup_at), not locks;
 * overlapping ticks at current volume are a non-issue and the lease bounds
 * duplicate work — same reasoning as the standing-jobs claim.
 */
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { runGeorgeAutonomous } from "./run-autonomous";

const DEFAULT_MAX_CUSTOMERS_PER_TICK = 3;
const PER_RUN_BUDGET_MS = 180_000;
const MIN_RUN_BUDGET_MS = 30_000; // don't start a run with less than this left

type DueObjective = {
  id: string;
  org_id: string;
  customer_id: string;
  title: string;
  description: string | null;
  responsible_side: "customer" | "onyx";
  responsible_contact_id: string | null;
  owner_side_user_id: string | null;
  cc_emails: string[] | null;
  due_date: string | null;
  followup_interval_hours: number;
  followup_count: number;
  max_followups: number;
  thread_conversation_id: string | null;
  customers: { id: string; name: string; owner_user_id: string | null } | null;
};

type Group = {
  orgId: string;
  customerId: string;
  customerName: string;
  objectives: DueObjective[];
};

export type ObjectivesScanResult = {
  customers_processed: number;
  objectives_due: number;
  runs: Array<{ customerId: string; status: string; error?: string | null }>;
};

export async function runObjectivesScan(opts?: {
  maxCustomers?: number;
  budgetMsRemaining?: number;
}): Promise<ObjectivesScanResult> {
  const admin = createSupabaseAdmin();
  const maxCustomers = opts?.maxCustomers ?? DEFAULT_MAX_CUSTOMERS_PER_TICK;
  const budget = opts?.budgetMsRemaining ?? PER_RUN_BUDGET_MS;
  const scanStart = Date.now();

  const due = await admin
    .from("objectives")
    .select(
      "id, org_id, customer_id, title, description, responsible_side, responsible_contact_id, owner_side_user_id, cc_emails, due_date, followup_interval_hours, followup_count, max_followups, thread_conversation_id, customers!inner(id, name, owner_user_id)",
    )
    .eq("status", "awaiting")
    // Archived customers do not get chased. The embed is `!inner`, so this
    // drops the parent objective rather than just blanking the join — true of
    // both PostgREST and the Postgres shim.
    .is("customers.archived_at", null)
    .not("next_followup_at", "is", null)
    .lte("next_followup_at", new Date().toISOString())
    .order("next_followup_at", { ascending: true })
    .limit(50);

  if (due.error) {
    throw new Error(`objectives scan: load failed — ${due.error.message}`);
  }
  const rows = (due.data ?? []) as unknown as DueObjective[];
  if (rows.length === 0) {
    return { customers_processed: 0, objectives_due: 0, runs: [] };
  }

  // Group by (org, customer) so George handles a partner's whole set in one run
  // (and can batch related asks into one email).
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.org_id}:${r.customer_id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        orgId: r.org_id,
        customerId: r.customer_id,
        customerName: r.customers?.name ?? "(unknown)",
        objectives: [],
      };
      groups.set(key, g);
    }
    g.objectives.push(r);
  }

  const runs: ObjectivesScanResult["runs"] = [];
  let processed = 0;

  for (const group of groups.values()) {
    if (processed >= maxCustomers) break;
    const remaining = budget - (Date.now() - scanStart);
    if (remaining < MIN_RUN_BUDGET_MS) break;
    processed += 1;

    // Lease: advance the clock for this customer's due objectives so a failed
    // run can't respin them every minute.
    for (const o of group.objectives) {
      const next = new Date(
        Date.now() + (o.followup_interval_hours ?? 48) * 3_600_000,
      ).toISOString();
      await admin.from("objectives").update({ next_followup_at: next }).eq("id", o.id);
    }

    // Session so the run + any drafts are reviewable in /chat and /actions.
    const sessionInsert = await admin
      .from("agent_sessions")
      .insert({
        org_id: group.orgId,
        user_id: null,
        channel: "cron",
        title: `Follow-ups: ${group.customerName}`.slice(0, 120),
        customer_id: group.customerId,
      })
      .select("id")
      .single();
    const sessionId = (sessionInsert.data?.id as string | undefined) ?? null;

    const prompt = buildScanPrompt(group);
    if (sessionId) {
      await admin
        .from("agent_messages")
        .insert({ session_id: sessionId, role: "user", content: prompt });
    }

    const result = await runGeorgeAutonomous({
      orgId: group.orgId,
      userPrompt: prompt,
      sessionId,
      userId: null,
      clientAppTag: "agent-george-objectives/0.1",
      timeBudgetMs: Math.min(PER_RUN_BUDGET_MS, remaining),
    });

    if (sessionId && result.summary) {
      await admin
        .from("agent_messages")
        .insert({ session_id: sessionId, role: "assistant", content: result.summary });
      if (result.sdkSessionId) {
        await admin
          .from("agent_sessions")
          .update({ sdk_session_id: result.sdkSessionId })
          .eq("id", sessionId);
      }
    }

    runs.push({
      customerId: group.customerId,
      status: result.status,
      error: result.error,
    });
  }

  return { customers_processed: processed, objectives_due: rows.length, runs };
}

function buildScanPrompt(group: Group): string {
  const lines = group.objectives
    .map((o) => {
      const parts = [
        `- objective_id=${o.id} · "${o.title}" (side=${o.responsible_side}, follow-up ${o.followup_count}/${o.max_followups})`,
        o.responsible_contact_id
          ? `    responsible_contact_id=${o.responsible_contact_id}`
          : null,
        o.owner_side_user_id ? `    owner_side_user_id=${o.owner_side_user_id}` : null,
        o.cc_emails && o.cc_emails.length ? `    cc=${o.cc_emails.join(", ")}` : null,
        o.due_date ? `    due_date=${o.due_date}` : null,
        o.thread_conversation_id
          ? `    thread_conversation_id=${o.thread_conversation_id}`
          : null,
        o.description ? `    notes: ${o.description}` : null,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n");

  return [
    `Objectives follow-up cycle for **${group.customerName}**. The objectives below are due. Their clocks have already been advanced for this cycle — do NOT recompute timing.`,
    ``,
    lines,
    ``,
    `For EACH objective, follow the "Objectives & the clock" section of \`core/03-agent-george-lifecycle-steps.md\` (read it with read_knowledge_doc):`,
    `1. Judge achievement from the ACTUAL deliverable: use get_thread(thread_conversation_id) for the full thread (or search_emails when you lack the id) and check whether the real thing arrived. A reply or out-of-office is NOT achievement. If achieved → update_objective(status='achieved').`,
    `2. If not achieved and within the follow-up limit → draft a short, polite follow-up to the responsible party (CC the objective's cc list), then update_objective(bump_followup=true).`,
    `3. If the follow-up limit is reached, or due_date has passed / is imminent → escalate: draft a note to the customer's owner with full context, then update_objective(status='blocked').`,
    `4. When in doubt (who to contact, what exactly is needed) → ask the owner and leave the objective awaiting.`,
    `Batch related asks to the same person into ONE email — two or three actions, not many.`,
  ].join("\n");
}
