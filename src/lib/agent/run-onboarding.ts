/**
 * One onboarding run: read the account, decide what moves it, write one email,
 * and put it in front of a human.
 *
 * Nothing here sends. The run ends with a draft and a decision on the Needs-you
 * queue; approving it is a separate, human action (F1 item 6).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings, personalityPrompt } from "./agent-settings";
import { buildOnboardingAgent } from "./onboarding-agent";
import {
  assessOnboarding,
  type OnboardingFacts,
  type TouchpointFact,
} from "./onboarding-state";
import { checkOnboardingPreconditions } from "./onboarding-preconditions";
import { resolveTenantProcess, type ProcessTouchpoint, type TenantProcess } from "./tenant-process";

const RUN_BUDGET_MS = 180_000;
const DAY_MS = 86_400_000;

export type StartOnboardingResult =
  | { ok: false; status: 404 | 409 | 422; failures: Array<{ code: string; reason: string }> }
  | { ok: true; touchpointId: string; sessionId: string; touchpointKey: string };

/**
 * Propose a go-live date.
 *
 * From the process, not from a guess: the last touchpoint is the one that
 * closes onboarding out, so its day offset is what the tenant has said the
 * shape of an onboarding is. Falls back to the first-value target when a
 * process somehow has no dated touchpoints.
 *
 * A proposal, not a commitment — it lands on the plan where a human can change
 * it, and George is told elsewhere never to promise a date to a customer.
 */
export function proposeGoLive(start: Date, process: TenantProcess): string {
  const last = process.touchpoints.reduce((m, t) => Math.max(m, t.day_offset), 0);
  const days = last > 0 ? last : process.firstValue.target_days || 30;
  return new Date(start.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Which touchpoint this run is writing.
 *
 * The earliest one that is due and has not been written yet. Deliberately not
 * "the one matching today's day number": an account started late, or paused, or
 * resumed after a gap would otherwise skip everything it slept through, and the
 * customer would receive a day-30 close-out having never had a welcome.
 */
export function nextTouchpoint(
  process: TenantProcess,
  daysSinceStart: number,
  alreadyWritten: Set<string>,
): ProcessTouchpoint | null {
  const pending = process.touchpoints.filter((t) => !alreadyWritten.has(t.key));
  if (!pending.length) return null;
  const due = pending.filter((t) => t.day_offset <= daysSinceStart);
  // If none is due yet this is an early start — write the first one rather than
  // refusing, because a human just asked for it.
  return due[0] ?? pending[0];
}

async function gatherFacts(
  admin: SupabaseClient,
  customerId: string,
  process: TenantProcess,
): Promise<{ facts: OnboardingFacts; planId: string; start: Date }> {
  const [contractRes, planRes, healthRes, objectivesRes, tpRes] = await Promise.all([
    admin
      .from("contracts")
      .select("signed_at, start_date, end_date")
      .eq("customer_id", customerId)
      .order("signed_at", { ascending: false })
      .limit(1),
    admin
      .from("onboarding_plans")
      .select("id, start_date, target_end_date, status")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1),
    admin
      .from("customer_health")
      .select("band, reason, measured_at")
      .eq("customer_id", customerId)
      .order("measured_at", { ascending: false })
      .limit(1),
    admin
      .from("objectives")
      .select("title, status, due_date, responsible_side")
      .eq("customer_id", customerId)
      .not("status", "in", "(achieved,cancelled)"),
    admin
      .from("onboarding_touchpoint")
      .select("touchpoint_key, status, sent_at, replied_at")
      .eq("customer_id", customerId),
  ]);

  const contract = (contractRes.data ?? [])[0] ?? null;
  let plan = (planRes.data ?? [])[0] ?? null;

  const start = new Date(
    Date.parse(plan?.start_date ?? contract?.signed_at ?? contract?.start_date ?? "") ||
      Date.now(),
  );

  // The plan is created as step one of onboarding — it is what the stages and
  // the go-live date hang off, and without it there is nowhere to record that
  // anything happened.
  if (!plan) {
    const insert = await admin
      .from("onboarding_plans")
      .insert({
        customer_id: customerId,
        status: "in_progress",
        start_date: start.toISOString().slice(0, 10),
        target_end_date: proposeGoLive(start, process),
      })
      .select("id, start_date, target_end_date, status")
      .single();
    if (insert.error) throw new Error(`could not create onboarding plan: ${insert.error.message}`);
    plan = insert.data;
  }

  const steps = await admin
    .from("onboarding_steps")
    .select("title, status, due_date, ordinal")
    .eq("plan_id", plan.id)
    .order("ordinal");

  return {
    planId: plan.id as string,
    start,
    facts: {
      now: new Date(),
      contract,
      plan: {
        start_date: plan.start_date,
        target_end_date: plan.target_end_date,
        status: plan.status,
      },
      steps: (steps.data ?? []) as OnboardingFacts["steps"],
      objectives: (objectivesRes.data ?? []) as OnboardingFacts["objectives"],
      health: (healthRes.data ?? [])[0] ?? null,
      touchpoints: (tpRes.data ?? []) as TouchpointFact[],
      silenceDays: process.escalation.silence_days,
      firstValue: process.firstValue,
    },
  };
}

/**
 * After the run, tie the draft George wrote to the decision he raised.
 *
 * George produces these with two separate tools and nothing joins them, so the
 * join is made here from the session both were written under. Without it the
 * approval card has a decision with no email in it, and "approve" would mean
 * approving a description of an email rather than the email.
 *
 * Reads the draft body from the `email.drafted` audit row rather than the
 * provider: that row is snapshotted at draft time and survives the draft being
 * edited or deleted, so the card always renders what was actually written.
 */
async function bindDraftToDecision(
  admin: SupabaseClient,
  orgId: string,
  sessionId: string,
): Promise<{ draftId: string | null; escalationId: string | null }> {
  const [draftRes, escRes] = await Promise.all([
    admin
      .from("audit_log")
      .select("payload, created_at")
      .eq("org_id", orgId)
      .in("action", ["email.drafted", "email.reply_drafted"])
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("escalations")
      .select("id, created_at")
      .eq("org_id", orgId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const draft = ((draftRes.data ?? []) as Array<{ payload: { draft_id?: string; session_id?: string } | null }>)
    .find((r) => r.payload?.session_id === sessionId || r.payload?.draft_id);
  const draftId = draft?.payload?.draft_id ?? null;
  const escalationId = ((escRes.data ?? [])[0]?.id as string) ?? null;

  if (escalationId && draftId) {
    await admin.from("escalations").update({ draft_id: draftId }).eq("id", escalationId);
  }
  return { draftId, escalationId };
}

export async function startOnboarding(args: {
  orgId: string;
  customerId: string;
  userId: string | null;
}): Promise<StartOnboardingResult> {
  const admin = createSupabaseAdmin();

  const pre = await checkOnboardingPreconditions(admin, args.orgId, args.customerId);
  if (!pre.ok) {
    const notFound = pre.failures.some((f) => f.code === "customer_not_found");
    const conflict = pre.failures.some((f) => f.code === "already_running");
    return {
      ok: false,
      status: notFound ? 404 : conflict ? 409 : 422,
      failures: pre.failures.map((f) => ({ code: f.code, reason: f.reason })),
    };
  }

  const process = await resolveTenantProcess(admin, args.orgId);
  const { facts, planId } = await gatherFacts(admin, args.customerId, process);
  const assessment = assessOnboarding(facts);

  const written = new Set(facts.touchpoints.map((t) => t.touchpoint_key));
  const touchpoint = nextTouchpoint(process, assessment.daysSinceStart ?? 0, written);
  if (!touchpoint) {
    return {
      ok: false,
      status: 409,
      failures: [
        {
          code: "no_touchpoints_left",
          reason:
            "Every touchpoint in this process has already been written for this account. " +
            "Onboarding is complete, or the process needs another touchpoint.",
        },
      ],
    };
  }

  const { data: customer } = await admin
    .from("customers")
    .select("name")
    .eq("id", args.customerId)
    .maybeSingle();

  const session = await admin
    .from("agent_sessions")
    .insert({
      org_id: args.orgId,
      user_id: args.userId,
      channel: "cron",
      title: `Onboarding: ${customer?.name ?? "customer"} — ${touchpoint.key}`,
      customer_id: args.customerId,
    })
    .select("id")
    .single();
  if (session.error) throw new Error(`could not create session: ${session.error.message}`);
  const sessionId = session.data.id as string;

  // Claim the touchpoint before the run, so a second click cannot start a
  // second one — the preconditions check reads these rows.
  const tp = await admin
    .from("onboarding_touchpoint")
    .upsert(
      {
        org_id: args.orgId,
        customer_id: args.customerId,
        plan_id: planId,
        touchpoint_key: touchpoint.key,
        status: "drafted",
        session_id: sessionId,
        recipient_email: pre.recipient.email,
        recipient_contact_id: pre.recipient.id,
        scheduled_for: new Date().toISOString(),
      },
      { onConflict: "plan_id,touchpoint_key" },
    )
    .select("id")
    .single();
  if (tp.error) throw new Error(`could not record touchpoint: ${tp.error.message}`);
  const touchpointId = tp.data.id as string;

  const settings = await getAgentSettings(admin, args.orgId);
  const accountBlock = [
    "# Account",
    "",
    `- Name: ${customer?.name ?? "(unnamed)"}`,
    `- Customer id: \`${args.customerId}\``,
    facts.contract?.signed_at ? `- Contract signed: ${facts.contract.signed_at}` : null,
    facts.plan?.target_end_date ? `- Target go-live: ${facts.plan.target_end_date}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const agent = buildOnboardingAgent({
    process,
    assessment,
    touchpoint,
    recipient: { email: pre.recipient.email, name: pre.recipient.name, role: pre.recipient.role },
    accountBlock,
    personalityPrompt: personalityPrompt(settings.personality),
    requireApproval: true,
  });

  const run = await runGeorgeAutonomousLazy({
    orgId: args.orgId,
    userId: args.userId,
    sessionId,
    asAgent: agent,
    // Draft-only. The tool is not in the agent's grant either — this is the
    // second of the two locks, not the only one.
    emailSendPolicy: "none",
    timeBudgetMs: RUN_BUDGET_MS,
    clientAppTag: "agent-george-onboarding/0.1",
    userPrompt:
      `Write the ${touchpoint.key} email for this account now. Draft it with draft_email to ` +
      `${pre.recipient.email}, then raise a decision so a human can review and approve it. ` +
      `Do not describe the email in the decision — draft it.`,
  });

  const { draftId, escalationId } = await bindDraftToDecision(admin, args.orgId, sessionId);

  await admin
    .from("onboarding_touchpoint")
    .update({
      status: run.status === "succeeded" && draftId ? "awaiting_approval" : "drafted",
      draft_id: draftId,
      escalation_id: escalationId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", touchpointId);

  return { ok: true, touchpointId, sessionId, touchpointKey: touchpoint.key };
}

/** Imported lazily so the SDK and its native binary stay out of the edge/build graph. */
async function runGeorgeAutonomousLazy(
  input: Parameters<typeof import("./run-autonomous").runGeorgeAutonomous>[0],
) {
  const { runGeorgeAutonomous } = await import("./run-autonomous");
  return runGeorgeAutonomous(input);
}
