/**
 * The tenant's onboarding process, resolved per organisation.
 *
 * George is a product AIX sells and AIX is tenant zero. A process written into
 * the prompt is one tenant's process shipped to every tenant, so it lives in
 * `tenant_process` (migration 0004) and is read from here.
 *
 * WHY THIS FAILS CLOSED WHERE identity.ts FALLS THROUGH
 * The shape is deliberately modelled on resolveOrgIdentity — same 60s cache,
 * same single lookup — with the failure mode inverted, and the inversion is the
 * point.
 *
 * resolveOrgIdentity falls through to env when the org record is unreadable,
 * because its answer ("which domains are internal") has a safe degraded form:
 * fewer domains internal means stricter, and strict is survivable.
 *
 * This has no safe degraded form. The degraded answer to "what is this tenant's
 * onboarding process" is a process George invented, executed against a real
 * customer, in the tenant's name. So a missing or unusable record raises, and
 * onboarding refuses to start. Silence is recoverable; a plausible invention is
 * not, because nobody can tell it happened by reading the output.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantProcessType = "onboarding";

/** A named milestone between signature and go-live. */
export type ProcessStage = {
  key: string;
  name: string;
  description: string;
};

/** When to reach out, and what that contact is for. One ask each. */
export type ProcessTouchpoint = {
  key: string;
  /** Days after the plan starts. Weighted to the first 30 by default. */
  day_offset: number;
  purpose: string;
  ask: string;
};

export type ProcessEscalationRule = {
  when: string;
  action: string;
  urgency: "low" | "normal" | "high";
};

export type ProcessEscalation = {
  /** No reply for this many days counts as silence. */
  silence_days: number;
  /** How many silent touchpoints before a decision is raised. */
  silence_escalate_after: number;
  rules: ProcessEscalationRule[];
  notify: string;
};

/**
 * The milestone that means this customer got what they bought.
 *
 * `configured` is the field that matters operationally. Everything else in a
 * process has a sensible generic default; this one is genuinely
 * company-specific, and it is the only thing that lets George report whether
 * onboarding WORKED rather than whether email went out. An untuned default here
 * is not a cosmetic gap — it means George cannot tell success from activity.
 */
export type FirstValue = {
  label: string;
  definition: string;
  target_days: number;
  evidence: string;
  /** False while the seeded placeholder is still in place. */
  configured: boolean;
};

export type TenantProcess = {
  id: string;
  orgId: string;
  type: TenantProcessType;
  objective: string;
  stages: ProcessStage[];
  touchpoints: ProcessTouchpoint[];
  escalation: ProcessEscalation;
  /** Onboarding-specific tone. Overrides agent personality — see onboarding-agent.ts. */
  voice: string | null;
  firstValue: FirstValue;
};

/**
 * Raised when a tenant has no usable process. Distinct from a generic error so
 * the trigger endpoint can name the cause to the UI rather than 500-ing, and so
 * it is greppable.
 */
export class TenantProcessMissingError extends Error {
  constructor(
    readonly orgId: string,
    readonly type: TenantProcessType,
    readonly why: string,
  ) {
    super(
      `No usable '${type}' process for organisation ${orgId}: ${why}. George will not ` +
        `onboard without one — define the process rather than letting him invent it.`,
    );
    this.name = "TenantProcessMissingError";
  }
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: TenantProcess }>();

const cacheKey = (orgId: string, type: TenantProcessType) => `${orgId}:${type}`;

/** Testing seam, and a way to drop the cache after a tenant edits the process. */
export function clearTenantProcessCache(orgId?: string, type: TenantProcessType = "onboarding"): void {
  if (orgId) cache.delete(cacheKey(orgId, type));
  else cache.clear();
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Normalise the jsonb blob, filling only structural defaults — never content. */
function readFirstValue(v: unknown): FirstValue {
  const r = asRecord(v);
  return {
    label: typeof r.label === "string" ? r.label : "",
    definition: typeof r.definition === "string" ? r.definition : "",
    target_days: typeof r.target_days === "number" ? r.target_days : 0,
    evidence: typeof r.evidence === "string" ? r.evidence : "",
    // Absent means not configured. A missing flag must never read as "tuned".
    configured: r.configured === true,
  };
}

function readEscalation(v: unknown): ProcessEscalation {
  const r = asRecord(v);
  return {
    silence_days: typeof r.silence_days === "number" ? r.silence_days : 5,
    silence_escalate_after:
      typeof r.silence_escalate_after === "number" ? r.silence_escalate_after : 2,
    rules: asArray<ProcessEscalationRule>(r.rules),
    notify: typeof r.notify === "string" ? r.notify : "account owner",
  };
}

/**
 * Read the tenant's process, or refuse.
 *
 * Throws TenantProcessMissingError when there is no row, or when the row cannot
 * drive an onboarding — no stages or no touchpoints means there is nothing to
 * execute, and composing around that is the same invention as having no row at
 * all. A record that exists but says nothing is not a weaker version of a
 * process; it is the absence of one, wearing a row.
 */
export async function resolveTenantProcess(
  admin: SupabaseClient,
  orgId: string,
  type: TenantProcessType = "onboarding",
): Promise<TenantProcess> {
  const key = cacheKey(orgId, type);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let row: Record<string, unknown> | null = null;
  try {
    const { data, error } = await admin
      .from("tenant_process")
      .select("id, org_id, type, objective, stages, touchpoints, escalation, voice, first_value")
      .eq("org_id", orgId)
      .eq("type", type)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = (data ?? null) as Record<string, unknown> | null;
  } catch (err) {
    // Note the difference from identity.ts: a failed read is NOT swallowed.
    // "Could not tell" and "no process" lead to the same refusal here, because
    // proceeding on either would mean composing a process we cannot see.
    throw new TenantProcessMissingError(
      orgId,
      type,
      `the process could not be read (${(err as Error).message})`,
    );
  }

  if (!row) throw new TenantProcessMissingError(orgId, type, "no process record exists");

  const stages = asArray<ProcessStage>(row.stages);
  const touchpoints = asArray<ProcessTouchpoint>(row.touchpoints);
  if (stages.length === 0) {
    throw new TenantProcessMissingError(orgId, type, "the process defines no stages");
  }
  if (touchpoints.length === 0) {
    throw new TenantProcessMissingError(orgId, type, "the process defines no touchpoints");
  }
  const objective = typeof row.objective === "string" ? row.objective.trim() : "";
  if (!objective) {
    throw new TenantProcessMissingError(orgId, type, "the process states no objective");
  }

  const value: TenantProcess = {
    id: String(row.id),
    orgId,
    type,
    objective,
    stages,
    // Ordered here so every caller — prompt, scheduler, UI — sees the same
    // sequence without each re-sorting and one of them forgetting.
    touchpoints: [...touchpoints].sort((a, b) => a.day_offset - b.day_offset),
    escalation: readEscalation(row.escalation),
    voice: typeof row.voice === "string" && row.voice.trim() ? row.voice.trim() : null,
    firstValue: readFirstValue(row.first_value),
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Whether the tenant has defined what first value means, or is still running
 * the seeded placeholder.
 *
 * Read by the prompt and by /settings/agent. Kept as a named function rather
 * than an inline `.configured` check because both callers must agree, and
 * because "has a label" is NOT the test — the placeholder has a perfectly
 * plausible label, which is exactly what makes it dangerous.
 */
export function isFirstValueConfigured(process: TenantProcess): boolean {
  return process.firstValue.configured === true;
}
