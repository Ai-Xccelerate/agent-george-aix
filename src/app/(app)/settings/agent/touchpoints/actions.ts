"use server";

/**
 * The one write path for "when may George send email nobody asked for".
 *
 * WHY THIS IS SEPARATE FROM updateTouchpointCadenceAction
 * That action edits timings only, and says so: it reads `purpose` and `ask`
 * from the stored row and writes them back untouched, on the grounds that
 * "reach out sooner" and "say something else" are different decisions. The
 * reasoning was sound and the consequence was that the second decision had no
 * screen at all — you could move a touchpoint but not add one, remove one, or
 * change what it asks for. The whole schedule was editable only in SQL.
 *
 * So this replaces the array. It is the deliberate, reviewed screen that note
 * asked for, rather than a row of number inputs bolted onto the identity page.
 *
 * WHY IT REFUSES TO SAVE AN EMPTY LIST
 * `resolveTenantProcess` throws when a process defines no touchpoints, and
 * onboarding then refuses to run — correct, and a terrible thing to discover
 * from a failed onboarding two days later. Zero touchpoints is a legitimate
 * intent ("George should never write first"), but it has to be expressed as
 * that rather than as an empty form, so it is refused here with the reason.
 *
 * WHY KEYS MUST BE UNIQUE
 * `onboarding_touchpoint.touchpoint_key` is how a sent contact is matched back
 * to the plan entry that caused it. Two rows sharing a key makes that history
 * ambiguous after the fact, and nothing downstream would report it.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { type ActionResult, requireAdmin } from "@/lib/actions";
import { clearTenantProcessCache } from "@/lib/agent/tenant-process";

export type { ActionResult } from "@/lib/actions";

/** Lower-case, underscore-separated — it is an identifier, not a title. */
const KEY_RE = /^[a-z][a-z0-9_]{1,59}$/;

const TouchpointSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(KEY_RE, "Use lower-case letters, digits and underscores, e.g. week_one_check_in."),
  day_offset: z.coerce.number().int().min(0).max(365),
  purpose: z.string().trim().min(1, "Say what the contact is for.").max(300),
  ask: z.string().trim().min(1, "Say what it asks the customer for.").max(300),
});

const EscalationSchema = z.object({
  silence_days: z.coerce.number().int().min(1).max(90),
  silence_escalate_after: z.coerce.number().int().min(1).max(10),
});

export async function updateTouchpointsAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error };
  const orgId = gate.user.orgId;

  const count = Number.parseInt(String(formData.get("count") ?? "0"), 10);
  if (!Number.isFinite(count) || count < 0 || count > 40) {
    return { error: "Could not read the form." };
  }

  const rows: Array<z.infer<typeof TouchpointSchema>> = [];
  for (let i = 0; i < count; i++) {
    // A removed row is dropped client-side, so a gap in the indexes is normal
    // rather than an error.
    const key = formData.get(`key:${i}`);
    if (key == null) continue;
    const parsed = TouchpointSchema.safeParse({
      key,
      day_offset: formData.get(`day:${i}`),
      purpose: formData.get(`purpose:${i}`),
      ask: formData.get(`ask:${i}`),
    });
    if (!parsed.success) {
      return { error: `Contact ${i + 1}: ${parsed.error.issues[0]?.message ?? "invalid."}` };
    }
    rows.push(parsed.data);
  }

  if (rows.length === 0) {
    return {
      error:
        "Save at least one contact. An empty schedule makes George refuse to onboard " +
        "rather than stay quiet, and you would find out from a failed onboarding. " +
        "To stop George writing first, switch the operating model to assistant mode.",
    };
  }

  const dupes = rows
    .map((r) => r.key)
    .filter((k, i, all) => all.indexOf(k) !== i);
  if (dupes.length > 0) {
    return {
      error: `Two contacts share the key "${dupes[0]}". Each needs its own — the key is how a sent email is matched back to the contact that caused it.`,
    };
  }

  const escalation = EscalationSchema.safeParse({
    silence_days: formData.get("silence_days"),
    silence_escalate_after: formData.get("silence_escalate_after"),
  });
  if (!escalation.success) {
    return { error: escalation.error.issues[0]?.message ?? "Invalid silence settings." };
  }

  const admin = createSupabaseAdmin();
  const { data: existing, error: readError } = await admin
    .from("tenant_process")
    .select("id, escalation")
    .eq("org_id", orgId)
    .eq("type", "onboarding")
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!existing) {
    return {
      error:
        "This organisation has no onboarding process record, so there is nothing to " +
        "schedule against. Migration 0004 seeds one for every org — if it is missing, " +
        "that is the thing to fix first.",
    };
  }

  // Sorted on write so every reader — the prompt, the scheduler, this form —
  // sees the same order without each of them remembering to sort.
  const touchpoints = [...rows].sort((a, b) => a.day_offset - b.day_offset);

  // `rules` and `notify` are part of the escalation blob and belong to a
  // different screen. Merge rather than replace, or saving a cadence would
  // silently drop them.
  const prior =
    typeof existing.escalation === "object" && existing.escalation
      ? (existing.escalation as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("tenant_process")
    .update({
      touchpoints,
      escalation: { ...prior, ...escalation.data },
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) return { error: error.message };

  // The resolver caches for 60s. Without this the person who just saved would
  // watch George keep using the old schedule and reasonably conclude it failed.
  clearTenantProcessCache(orgId);
  revalidatePath("/settings/agent/touchpoints");
  revalidatePath("/settings/agent");

  return {
    info: `Saved. George may now write ${touchpoints.length} time${
      touchpoints.length === 1 ? "" : "s"
    } without being asked, on the days shown.`,
  };
}
