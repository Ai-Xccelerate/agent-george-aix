/**
 * Per-org on/off for George's integrations.
 *
 * WHAT "OFF" MEANS, AND WHY IT MATTERS MORE THAN IT SOUNDS
 * Off means the integration's tools are NOT REGISTERED. Not registered and
 * refusing — absent. A model cannot call a tool it does not have, and that is
 * the only form of "no" that has held up.
 *
 * On 20 August `send_email_draft` was registered while a prompt said not to use
 * it for recaps. Three other sources agreed with the prompt. George sent 16
 * emails anyway, correctly following the one instruction nearest the task.
 * Capability present with prose saying don't is not a control. So every toggle
 * here removes capability rather than adding a warning.
 *
 * TWO FACTS, BOTH REQUIRED
 *   configured  a credential exists for this org
 *   enabled     a human said yes, and we know which human and when
 *
 * Either alone is not enough. Configured-but-not-enabled is the normal state of
 * a newly provisioned tenant, and it must do nothing until somebody opts in —
 * a customer's data is not a default.
 *
 * DEFAULT OFF
 * A tenant appearing with working credentials must not have George acting on
 * their behalf because a variable happened to be set. That is how the shared
 * Scribe token ended up writing into three organisations that never asked.
 *
 * TOGGLING OFF DOES NOT DISCARD THE CREDENTIAL
 * Off, on, works again, no re-entering tokens. If turning something off costs a
 * credential nobody has to hand, nobody turns it off in the emergency where it
 * matters — which is precisely when they need to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Integrations whose on/off state lives in the `integrations` table.
 *
 * These are the values migration 0002 added to the integration_provider enum,
 * plus parchment which was already there. AgentDB is deliberately absent: it has
 * no row here because its enablement lives in AgentDB itself, gated on a Core
 * entitlement check that needs a human's Clerk token. Its toggle already exists
 * and works differently for a good reason.
 */
export const TOGGLEABLE = ["nylas", "scribe", "parchment"] as const;
export type ToggleableIntegration = (typeof TOGGLEABLE)[number];

export type ToggleState = {
  integration: ToggleableIntegration;
  /** A credential exists for this org. */
  configured: boolean;
  /** A human turned it on. */
  enabled: boolean;
  /** enabled AND configured — the only state in which tools register. */
  active: boolean;
  /** Who flipped it last, and when. */
  changedBy: string | null;
  changedAt: string | null;
  /** Why it is not active, when it is not. */
  reason: string | null;
};

type Row = {
  status: string | null;
  metadata: Record<string, unknown> | null;
};

async function readRow(
  admin: SupabaseClient,
  orgId: string,
  integration: ToggleableIntegration,
): Promise<Row | null> {
  const { data } = await admin
    .from("integrations")
    .select("status, metadata")
    .eq("org_id", orgId)
    .eq("provider", integration)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/**
 * Resolve on/off for one integration.
 *
 * `configured` is supplied by the caller because only the caller knows what a
 * credential looks like for its integration — a Nylas grant, a Scribe token, a
 * Parchment workspace. This module owns the human's decision, not the plumbing.
 *
 * Never throws: a lookup failure yields NOT active, because an integration whose
 * state cannot be read must not act.
 */
export async function toggleState(
  admin: SupabaseClient,
  orgId: string,
  integration: ToggleableIntegration,
  configured: boolean,
): Promise<ToggleState> {
  let row: Row | null = null;
  try {
    row = await readRow(admin, orgId, integration);
  } catch {
    return {
      integration,
      configured,
      enabled: false,
      active: false,
      changedBy: null,
      changedAt: null,
      reason: "Could not read this integration's settings, so it is treated as off.",
    };
  }

  const meta = (row?.metadata ?? {}) as Record<string, unknown>;
  // Absent row or absent flag means never turned on. Default off is the point.
  const enabled = meta.enabled === true && row?.status === "connected";

  const active = enabled && configured;
  return {
    integration,
    configured,
    enabled,
    active,
    changedBy: typeof meta.changed_by === "string" ? meta.changed_by : null,
    changedAt: typeof meta.changed_at === "string" ? meta.changed_at : null,
    reason: active
      ? null
      : !configured && !enabled
        ? "Not configured, and not switched on."
        : !configured
          ? "Switched on, but there is no credential for this organisation yet."
          : "Configured, but nobody has switched it on for this organisation.",
  };
}

/**
 * Turn one integration on or off for one org.
 *
 * The credential is untouched — only the flag moves — so off and back on costs
 * nothing. `changed_by` and `changed_at` are recorded because the question after
 * an incident is always "when did this stop, and who did it", and an absent
 * answer sends someone reading deploy logs for an afternoon.
 */
export async function setEnabled(
  admin: SupabaseClient,
  orgId: string,
  integration: ToggleableIntegration,
  enabled: boolean,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let existing: Row | null = null;
  try {
    existing = await readRow(admin, orgId, integration);
  } catch {
    /* upsert below still creates the row */
  }

  const metadata = {
    ...((existing?.metadata ?? {}) as Record<string, unknown>),
    enabled,
    changed_by: actor,
    changed_at: new Date().toISOString(),
  };

  const { error } = await admin.from("integrations").upsert(
    {
      org_id: orgId,
      provider: integration,
      // 'connected' is the table's word for on. Turning off records
      // 'disconnected' rather than deleting the row, so the credential and the
      // history of who changed what both survive.
      status: enabled ? "connected" : "disconnected",
      metadata,
    },
    { onConflict: "org_id,provider" },
  );

  if (error) return { ok: false, error: error.message };

  await admin.from("audit_log").insert({
    org_id: orgId,
    actor,
    action: enabled ? "integration.enabled" : "integration.disabled",
    payload: { integration },
  });

  return { ok: true };
}

/** Convenience for the tool-registration paths: may this integration act? */
export async function isActive(
  admin: SupabaseClient,
  orgId: string,
  integration: ToggleableIntegration,
  configured: boolean,
): Promise<boolean> {
  return (await toggleState(admin, orgId, integration, configured)).active;
}
