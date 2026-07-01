"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { runGeorgeJob } from "@/lib/agent/run-job";
import { computeNextRun } from "@/lib/agent/cron";

export type ActionResult = { error?: string; info?: string };

const JobSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  directive: z
    .string()
    .trim()
    .min(10, "Directive should describe what George should do.")
    .max(4000),
  cron: z.string().trim().min(1, "Cron expression is required").max(120),
  timezone: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  enabled: z.preprocess((v) => v === "on" || v === true, z.boolean()),
});

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." as const };
  if (user.role !== "owner" && user.role !== "admin")
    return { error: "Admins only." as const };
  return { user };
}

function validateCron(expr: string, tz: string | null): string | null {
  try {
    CronExpressionParser.parse(expr, { tz: tz ?? "UTC" });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid cron expression.";
  }
}

async function resolveTimezone(orgId: string, jobTz: string | null) {
  if (jobTz) return jobTz;
  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from("orgs")
    .select("default_timezone")
    .eq("id", orgId)
    .maybeSingle();
  return data?.default_timezone ?? "UTC";
}

export async function createJobAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const parsed = JobSchema.safeParse({
    name: formData.get("name"),
    directive: formData.get("directive"),
    cron: formData.get("cron"),
    timezone: formData.get("timezone"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const cronError = validateCron(parsed.data.cron, parsed.data.timezone);
  if (cronError) return { error: `Cron error: ${cronError}` };

  const effectiveTz = await resolveTimezone(user.orgId, parsed.data.timezone);
  const nextRunAt = computeNextRun(parsed.data.cron, effectiveTz);

  const admin = createSupabaseAdmin();
  const { error } = await admin.from("agent_jobs").insert({
    org_id: user.orgId,
    name: parsed.data.name,
    directive: parsed.data.directive,
    cron: parsed.data.cron,
    timezone: parsed.data.timezone,
    enabled: parsed.data.enabled,
    next_run_at: nextRunAt.toISOString(),
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/jobs");
  return { info: `Job "${parsed.data.name}" created.` };
}

export async function toggleJobAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const jobId = String(formData.get("job_id") ?? "");
  const enabled = formData.get("enabled") === "on";
  if (!jobId) return;

  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("agent_jobs")
    .update({ enabled })
    .eq("id", jobId)
    .eq("org_id", auth.user.orgId);
  if (error) throw new Error(`Could not toggle job: ${error.message}`);
  revalidatePath("/settings/jobs");
}

export async function deleteJobAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return;
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("agent_jobs")
    .delete()
    .eq("id", jobId)
    .eq("org_id", auth.user.orgId);
  if (error) throw new Error(`Could not delete job: ${error.message}`);
  revalidatePath("/settings/jobs");
}

export async function runJobNowAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return;

  // Make sure it's an org-owned job before we spawn an agent on its behalf.
  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from("agent_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("org_id", auth.user.orgId)
    .maybeSingle();
  if (!data) return;

  const result = await runGeorgeJob({
    jobId,
    trigger: "manual",
    triggeredBy: auth.user.id,
  });
  if (!result.skipped && result.error) {
    throw new Error(`Job failed: ${result.error}`);
  }

  revalidatePath("/settings/jobs");
}
