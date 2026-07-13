"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { type ActionResult } from "@/lib/actions";

export type { ActionResult } from "@/lib/actions";

const ProfileSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(60),
  last_name: z.string().trim().min(1, "Last name is required").max(60),
  timezone: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  locale: z
    .string()
    .trim()
    .max(16)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});

export async function updateProfileAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };

  const parsed = ProfileSchema.safeParse({
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    timezone: formData.get("timezone"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { first_name, last_name, timezone, locale } = parsed.data;
  const fullName = `${first_name} ${last_name}`.trim();

  const admin = createSupabaseAdmin();
  // full_name/timezone/locale live on the local org_members mirror; the
  // canonical name is owned by Clerk (edited in AIX Core), but George reads
  // this row for its own UI so we keep it in sync from here.
  const update = await admin
    .from("org_members")
    .update({ full_name: fullName, timezone, locale })
    .eq("org_id", user.orgId)
    .eq("user_id", user.id);
  if (update.error) return { error: update.error.message };

  revalidatePath("/settings/profile");
  return { info: "Profile updated." };
}
