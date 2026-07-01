"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { AGENT_SLUG } from "@/lib/agent/agent-settings";
import { type ActionResult, requireAdmin } from "@/lib/actions";
import {
  POLICY_CATALOG,
  type PolicyOverrides,
  type PolicyValue,
} from "@/lib/agent/operating-model";

export type { ActionResult } from "@/lib/actions";

/**
 * Reads every catalog policy from the form, validates it, and stores only the
 * values that differ from the catalog default — keeping the override blob
 * sparse so a new policy added in code auto-applies its default everywhere.
 */
export async function updateOperatingPolicyAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const overrides: PolicyOverrides = {};

  for (const p of POLICY_CATALOG) {
    let value: PolicyValue;

    if (p.kind === "toggle") {
      // An unchecked checkbox sends nothing; "on" means checked.
      value = formData.get(p.id) === "on";
    } else if (p.kind === "number") {
      const raw = Number(formData.get(p.id));
      if (Number.isNaN(raw)) return { error: `${p.label} must be a number.` };
      if (raw < p.min || raw > p.max) {
        return { error: `${p.label} must be between ${p.min} and ${p.max}.` };
      }
      value = Math.round(raw);
    } else if (p.kind === "select") {
      const raw = String(formData.get(p.id) ?? "");
      if (!p.options.some((o) => o.value === raw)) {
        return { error: `Invalid choice for ${p.label}.` };
      }
      value = raw;
    } else {
      // text
      const raw = String(formData.get(p.id) ?? "").trim();
      if (raw.length > p.maxLength) {
        return { error: `${p.label} must be ${p.maxLength} characters or fewer.` };
      }
      value = raw;
    }

    if (value !== p.default) overrides[p.id] = value;
  }

  const admin = createSupabaseAdmin();
  const { error } = await admin.from("agent_settings").upsert(
    {
      org_id: user.orgId,
      agent_slug: AGENT_SLUG,
      operating_policy: overrides,
      updated_by: user.id,
    },
    { onConflict: "org_id,agent_slug" },
  );
  if (error) return { error: error.message };

  revalidatePath("/settings/agent/policy");
  return { info: "Operating model updated." };
}
