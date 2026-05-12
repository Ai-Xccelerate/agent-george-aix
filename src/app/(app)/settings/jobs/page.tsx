import { redirect } from "next/navigation";
import { Play, Trash2 } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { NewJobForm } from "./_job-form";
import {
  createJobAction,
  deleteJobAction,
  runJobNowAction,
  toggleJobAction,
} from "./actions";

export const dynamic = "force-dynamic";
// "Run now" awaits the full agent run synchronously; bump the function ceiling
// so it doesn't hit Vercel's default 10–15s server-action limit.
export const maxDuration = 300;

type JobRow = {
  id: string;
  name: string;
  directive: string;
  cron: string;
  timezone: string | null;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  running_run_id: string | null;
};

type RunRow = {
  id: string;
  job_id: string;
  status: "pending" | "running" | "succeeded" | "failed" | "timed_out";
  trigger: "schedule" | "manual";
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
};

export default async function JobsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const [jobsRes, runsRes] = await Promise.all([
    admin
      .from("agent_jobs")
      .select(
        "id, name, directive, cron, timezone, enabled, next_run_at, last_run_at, running_run_id",
      )
      .eq("org_id", user.orgId)
      .order("created_at", { ascending: false }),
    admin
      .from("agent_job_runs")
      .select("id, job_id, status, trigger, started_at, finished_at, summary, error")
      .eq("org_id", user.orgId)
      .order("started_at", { ascending: false })
      .limit(60),
  ]);

  const jobs = (jobsRes.data ?? []) as JobRow[];
  const runs = (runsRes.data ?? []) as RunRow[];
  const runsByJob = new Map<string, RunRow[]>();
  for (const r of runs) {
    const list = runsByJob.get(r.job_id) ?? [];
    list.push(r);
    runsByJob.set(r.job_id, list);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Standing jobs</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          Recurring tasks George runs on his own — utilization sweeps, cadence
          prep, inbox triage. Each job is a natural-language directive plus a
          cron schedule.
        </p>
      </header>

      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-[var(--color-fg)]">
          New job
        </h2>
        <NewJobForm action={createJobAction} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
          Existing jobs
        </h2>
        {jobs.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 text-[13px] text-[var(--color-fg-muted)]">
            No jobs yet. Use the form above to add one.
          </div>
        )}
        {jobs.map((job) => {
          const jobRuns = runsByJob.get(job.id) ?? [];
          return (
            <JobCard key={job.id} job={job} runs={jobRuns.slice(0, 5)} />
          );
        })}
      </section>
    </div>
  );
}

function JobCard({ job, runs }: { job: JobRow; runs: RunRow[] }) {
  const isRunning = Boolean(job.running_run_id);
  return (
    <article className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
      <header className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-[var(--color-fg)]">
              {job.name}
            </h3>
            <Badge tone={job.enabled ? "accent" : "info"}>
              {job.enabled ? "enabled" : "disabled"}
            </Badge>
            {isRunning && <Badge tone="info">running</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--color-fg-muted)]">
            <span>
              Cron <code className="text-[var(--color-fg-secondary)]">{job.cron}</code>
            </span>
            <span>Timezone {job.timezone ?? "(org default)"}</span>
            <span>Next run {formatTime(job.next_run_at)}</span>
            {job.last_run_at && <span>Last run {formatTime(job.last_run_at)}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <form action={runJobNowAction}>
            <input type="hidden" name="job_id" value={job.id} />
            <button
              type="submit"
              disabled={isRunning}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              <Play size={12} /> Run now
            </button>
          </form>
          <form action={toggleJobAction}>
            <input type="hidden" name="job_id" value={job.id} />
            <input type="hidden" name="enabled" value={job.enabled ? "" : "on"} />
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
            >
              {job.enabled ? "Disable" : "Enable"}
            </button>
          </form>
          <form action={deleteJobAction}>
            <input type="hidden" name="job_id" value={job.id} />
            <button
              type="submit"
              aria-label="Delete job"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]"
            >
              <Trash2 size={12} />
            </button>
          </form>
        </div>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-[13px] text-[var(--color-fg-secondary)]">
        {job.directive}
      </p>

      {runs.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-[12px] font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            Recent runs ({runs.length})
          </summary>
          <div className="mt-3 space-y-2">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function RunRow({ run }: { run: RunRow }) {
  const tone =
    run.status === "succeeded"
      ? "accent"
      : run.status === "failed" || run.status === "timed_out"
      ? "warning"
      : "info";
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
        <Badge tone={tone}>{run.status}</Badge>
        <span>{run.trigger}</span>
        <span>{formatTime(run.started_at)}</span>
        {run.finished_at && <span>→ {formatTime(run.finished_at)}</span>}
      </div>
      {run.summary && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[12px] text-[var(--color-fg-secondary)]">
          {run.summary}
        </pre>
      )}
      {run.error && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[12px] text-[var(--color-error)]">
          {run.error}
        </pre>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
