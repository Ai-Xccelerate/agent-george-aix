"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

export type ActionResult = { error?: string; info?: string };

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
  const update = await admin
    .from("org_members")
    .update({ full_name: fullName, timezone, locale })
    .eq("org_id", user.orgId)
    .eq("user_id", user.id);
  if (update.error) return { error: update.error.message };

  // Keep auth metadata in sync so the name is right in invite/magic-link
  // emails and anything else that reads user_metadata.
  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { full_name: fullName },
  });

  revalidatePath("/settings/profile");
  return { info: "Profile updated." };
}

const PasswordSchema = z
  .object({
    new_password: z.string().min(8, "Password must be at least 8 characters."),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Passwords don't match.",
    path: ["confirm_password"],
  });

export async function updatePasswordAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const parsed = PasswordSchema.safeParse({
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password." };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.new_password,
  });
  if (error) return { error: error.message };

  return { info: "Password updated." };
}
