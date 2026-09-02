"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { AGENT_SLUG, TIMEZONE_OPTIONS } from "@/lib/agent/agent-settings";
import { type ActionResult, requireAdmin } from "@/lib/actions";
import { clearTenantProcessCache } from "@/lib/agent/tenant-process";

const TIMEZONE_VALUES = TIMEZONE_OPTIONS.map((o) => o.value) as [string, ...string[]];

export type { ActionResult } from "@/lib/actions";

const AgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  title: z.string().trim().min(1, "Title is required").max(120),
  bio: z
    .string()
    .trim()
    .max(400)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  personality: z.enum(["concise_direct", "warm_consultative", "formal"]),
  operating_mode: z.enum(["assistant", "operator"]),
  owner_user_id: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  timezone: z.enum(TIMEZONE_VALUES),
});

export async function updateAgentSettingsAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const parsed = AgentSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title"),
    bio: formData.get("bio"),
    personality: formData.get("personality"),
    operating_mode: formData.get("operating_mode"),
    owner_user_id: formData.get("owner_user_id"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createSupabaseAdmin();

  // Guard the owner reference: it must be a member of this org. A stale/forged
  // user_id would otherwise slip past the FK (which only checks auth.users).
  if (parsed.data.owner_user_id) {
    const { data: member } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", user.orgId)
      .eq("user_id", parsed.data.owner_user_id)
      .maybeSingle();
    if (!member) return { error: "Owner must be a member of this organization." };
  }

  const { error } = await admin.from("agent_settings").upsert(
    {
      org_id: user.orgId,
      agent_slug: AGENT_SLUG,
      name: parsed.data.name,
      title: parsed.data.title,
      bio: parsed.data.bio,
      personality: parsed.data.personality,
      operating_mode: parsed.data.operating_mode,
      owner_user_id: parsed.data.owner_user_id,
      updated_by: user.id,
    },
    { onConflict: "org_id,agent_slug" },
  );
  if (error) return { error: error.message };

  // Timezone is stored on the org (the column cron scheduling reads), surfaced
  // here as part of George's identity. Keep one source of truth.
  const { error: tzError } = await admin
    .from("orgs")
    .update({ default_timezone: parsed.data.timezone })
    .eq("id", user.orgId);
  if (tzError) return { error: tzError.message };

  revalidatePath("/settings/agent");
  revalidatePath("/calendar");
  return { info: "Agent identity updated." };
}

const ALLOWED_AVATAR_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_AVATAR_BYTES = 1_000_000; // 1 MB

export async function uploadAgentAvatarAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Pick a file to upload." };
  }
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    return { error: "Use PNG, JPEG, or WebP." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: "Avatar must be 1 MB or smaller." };
  }

  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.orgId}/agent-${AGENT_SLUG}-${Date.now()}.${ext}`;

  const admin = createSupabaseAdmin();
  const upload = await admin.storage.from("org-assets").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) return { error: upload.error.message };

  const previous = await admin
    .from("agent_settings")
    .select("avatar_path")
    .eq("org_id", user.orgId)
    .eq("agent_slug", AGENT_SLUG)
    .maybeSingle();
  const previousPath = (previous.data as { avatar_path: string | null } | null)
    ?.avatar_path;

  const updated = await admin.from("agent_settings").upsert(
    {
      org_id: user.orgId,
      agent_slug: AGENT_SLUG,
      avatar_path: path,
      updated_by: user.id,
    },
    { onConflict: "org_id,agent_slug" },
  );
  if (updated.error) return { error: updated.error.message };

  if (previousPath && previousPath !== path) {
    await admin.storage.from("org-assets").remove([previousPath]);
  }

  revalidatePath("/settings/agent");
  return { info: "Avatar updated." };
}

export async function removeAgentAvatarAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const { user } = auth;
  void formData;

  const admin = createSupabaseAdmin();
  const current = await admin
    .from("agent_settings")
    .select("avatar_path")
    .eq("org_id", user.orgId)
    .eq("agent_slug", AGENT_SLUG)
    .maybeSingle();
  const path = (current.data as { avatar_path: string | null } | null)?.avatar_path;

  const { error } = await admin
    .from("agent_settings")
    .update({ avatar_path: null, updated_by: user.id })
    .eq("org_id", user.orgId)
    .eq("agent_slug", AGENT_SLUG);
  if (error) throw new Error(`Could not remove avatar: ${error.message}`);

  if (path) {
    await admin.storage.from("org-assets").remove([path]);
  }

  revalidatePath("/settings/agent");
}

/**
 * Save the onboarding cadence — when George reaches out, and what counts as
 * silence.
 *
 * Writes back into `tenant_process` rather than a settings table, because the
 * process record is what George composes from; a cadence held anywhere else
 * would be a second source of truth that the agent never reads.
 *
 * Only timings are touched. `purpose` and `ask` are read from the existing row
 * and written back unchanged: this form edits WHEN George writes, and the words
 * he writes from are a different decision on a different screen.
 */
export async function updateTouchpointCadenceAction(
  _state: { ok: boolean; message: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, message: gate.error };
  const orgId = gate.user.orgId;

  const admin = createSupabaseAdmin();
  const { data: row, error } = await admin
    .from("tenant_process")
    .select("id, touchpoints, escalation")
    .eq("org_id", orgId)
    .eq("type", "onboarding")
    .maybeSingle();
  if (error || !row) {
    return { ok: false, message: "No onboarding process to edit." };
  }

  const existing = Array.isArray(row.touchpoints)
    ? (row.touchpoints as Array<Record<string, unknown>>)
    : [];

  const num = (name: string, fallback: number, min: number, max: number) => {
    const raw = formData.get(name);
    const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  const touchpoints = existing.map((t) => {
    const key = String(t.key ?? "");
    return {
      ...t,
      day_offset: num(`day:${key}`, Number(t.day_offset ?? 0), 0, 365),
    };
  });

  // Sorted on write so every reader — prompt, scheduler, this form — sees the
  // same order without each of them remembering to sort.
  touchpoints.sort((a, b) => Number(a.day_offset) - Number(b.day_offset));

  const escalation = {
    ...(typeof row.escalation === "object" && row.escalation ? row.escalation : {}),
    silence_days: num("silence_days", 5, 1, 90),
    silence_escalate_after: num("silence_escalate_after", 2, 1, 10),
  };

  const upd = await admin
    .from("tenant_process")
    .update({ touchpoints, escalation, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (upd.error) return { ok: false, message: upd.error.message };

  // The resolver caches for 60s; without this the person who just saved would
  // watch George keep using the old cadence and reasonably conclude it failed.
  clearTenantProcessCache(orgId);
  revalidatePath("/settings/agent");
  return { ok: true, message: "Cadence saved." };
}
