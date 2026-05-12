/**
 * One-shot, non-streaming George runner for standing jobs (backlog #16).
 *
 * Wraps the generic `runGeorgeAutonomous` helper with the job-specific
 * persistence + atomic-claim plumbing: pending → running → success/fail/
 * timeout in `agent_job_runs`, plus a `running_run_id` claim on `agent_jobs`
 * so two cron ticks can't double-spawn the same job.
 *
 * Used by both `/api/cron/run-jobs` and the admin "Run now" server action.
 */
import { runGeorgeAutonomous } from "./run-autonomous";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type RunJobInput = {
  jobId: string;
  trigger: "schedule" | "manual";
  triggeredBy?: string | null;
  /** Hard ceiling on the agent's wall time. Defaults to 4 minutes. */
  timeBudgetMs?: number;
};

export type RunJobResult =
  | { skipped: true; reason: "already_running" | "not_found" | "disabled" }
  | {
      skipped: false;
      runId: string;
      status: "succeeded" | "failed" | "timed_out";
      summary: string | null;
      error: string | null;
    };

type JobRow = {
  id: string;
  org_id: string;
  name: string;
  directive: string;
  enabled: boolean;
  running_run_id: string | null;
  customer_id: string | null;
};

export async function runGeorgeJob(input: RunJobInput): Promise<RunJobResult> {
  const admin = createSupabaseAdmin();

  // 1) Load the job.
  const jobLookup = await admin
    .from("agent_jobs")
    .select("id, org_id, name, directive, enabled, running_run_id, customer_id")
    .eq("id", input.jobId)
    .maybeSingle();
  if (jobLookup.error || !jobLookup.data) {
    return { skipped: true, reason: "not_found" };
  }
  const job = jobLookup.data as JobRow;
  if (!job.enabled) return { skipped: true, reason: "disabled" };

  // 2) Create a pending run row.
  const runInsert = await admin
    .from("agent_job_runs")
    .insert({
      job_id: job.id,
      org_id: job.org_id,
      status: "pending",
      trigger: input.trigger,
      triggered_by: input.triggeredBy ?? null,
    })
    .select("id")
    .single();
  if (runInsert.error || !runInsert.data) {
    return {
      skipped: false,
      runId: "",
      status: "failed",
      summary: null,
      error: runInsert.error?.message ?? "could not create run row",
    };
  }
  const runId = runInsert.data.id as string;

  // 3) Atomic claim: only the request that flips running_run_id from null to
  //    this runId gets to execute. Two concurrent ticks racing on the same
  //    job won't double-spawn George.
  const claim = await admin
    .from("agent_jobs")
    .update({ running_run_id: runId })
    .eq("id", job.id)
    .is("running_run_id", null)
    .select("id");
  if (claim.error || !claim.data || claim.data.length === 0) {
    // Someone else holds the claim; roll back the run row.
    await admin.from("agent_job_runs").delete().eq("id", runId);
    return { skipped: true, reason: "already_running" };
  }

  // 4) Mark running.
  await admin
    .from("agent_job_runs")
    .update({ status: "running" })
    .eq("id", runId);

  // 5) Run George autonomously. The runner handles the time budget +
  //    autonomous-mode prompt + tool allowlist; we just hand it a framed
  //    user prompt.
  const userPrompt = `[Standing job: ${job.name}]\n\n${job.directive}`;
  const result = await runGeorgeAutonomous({
    orgId: job.org_id,
    userPrompt,
    timeBudgetMs: input.timeBudgetMs,
    userId: input.triggeredBy ?? null,
    clientAppTag: "agent-george-job/0.1",
  });

  // 6) Persist run outcome.
  await admin
    .from("agent_job_runs")
    .update({
      status: result.status,
      finished_at: new Date().toISOString(),
      summary: result.summary,
      error: result.error,
      sdk_session_id: result.sdkSessionId,
    })
    .eq("id", runId);

  // 7) Release the claim. Caller handles next_run_at + last_run_at updates so
  //    "Run now" doesn't disturb the schedule.
  await admin
    .from("agent_jobs")
    .update({ running_run_id: null, last_run_at: new Date().toISOString() })
    .eq("id", job.id);

  return {
    skipped: false,
    runId,
    status: result.status,
    summary: result.summary,
    error: result.error,
  };
}
