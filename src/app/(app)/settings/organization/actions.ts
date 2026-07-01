"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { type ActionResult, requireAdmin } from "@/lib/actions";

export type { ActionResult } from "@/lib/actions";

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];

const OrgSchema = z.object({
  name: z.string().trim().min(1, "Legal name is required").max(120),
  display_name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  customer_brand_name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  domain: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v && v.length ? v.toLowerCase() : null)),
  tagline: z
    .string()
    .trim()
    .max(280)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  brand_color: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length ? v : null))
    .refine((v) => v === null || HEX_COLOR.test(v ?? ""), {
      message: "Brand color must be a hex value like #6D45F5.",
    }),
  default_timezone: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  bh_start: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  bh_end: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});

export async function updateOrganizationAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const parsed = OrgSchema.safeParse({
    name: formData.get("name"),
    display_name: formData.get("display_name"),
    customer_brand_name: formData.get("customer_brand_name"),
    domain: formData.get("domain"),
    tagline: formData.get("tagline"),
    brand_color: formData.get("brand_color"),
    default_timezone: formData.get("default_timezone"),
    bh_start: formData.get("bh_start"),
    bh_end: formData.get("bh_end"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const selectedDays = formData.getAll("bh_days").map(String) as Day[];
  const days = selectedDays.filter((d): d is Day => (DAYS as readonly string[]).includes(d));
  const business_hours =
    parsed.data.bh_start || parsed.data.bh_end || days.length
      ? {
          start: parsed.data.bh_start,
          end: parsed.data.bh_end,
          days,
        }
      : null;

  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("orgs")
    .update({
      name: parsed.data.name,
      display_name: parsed.data.display_name,
      customer_brand_name: parsed.data.customer_brand_name,
      domain: parsed.data.domain,
      tagline: parsed.data.tagline,
      brand_color: parsed.data.brand_color,
      default_timezone: parsed.data.default_timezone,
      business_hours,
      updated_by: user.id,
    })
    .eq("id", user.orgId);

  if (error) return { error: error.message };

  revalidatePath("/settings/organization");
  return { info: "Organization updated." };
}

const ALLOWED_LOGO_TYPES = new Set([
  "image/png",
  "image/svg+xml",
  "image/jpeg",
  "image/webp",
]);
const MAX_LOGO_BYTES = 1_000_000; // 1 MB

export async function uploadOrgLogoAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const variant = String(formData.get("variant") ?? "");
  if (variant !== "square" && variant !== "wordmark") {
    return { error: "Unknown logo variant." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Pick a file to upload." };
  }
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return { error: "Use PNG, SVG, JPEG, or WebP." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: "Logo must be 1 MB or smaller." };
  }

  const ext =
    file.type === "image/svg+xml"
      ? "svg"
      : file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
      ? "webp"
      : "jpg";
  // Cache-bust with a timestamp so updates show immediately.
  const path = `${user.orgId}/logo-${variant}-${Date.now()}.${ext}`;

  const admin = createSupabaseAdmin();
  const upload = await admin.storage.from("org-assets").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) return { error: upload.error.message };

  const column = variant === "square" ? "logo_square_path" : "logo_wordmark_path";

  // Best-effort: remove the previous file so we don't accumulate dead blobs.
  const previous = await admin
    .from("orgs")
    .select(column)
    .eq("id", user.orgId)
    .maybeSingle();
  const previousPath = (previous.data as Record<string, string | null> | null)?.[column];

  const updated = await admin
    .from("orgs")
    .update({ [column]: path, updated_by: user.id })
    .eq("id", user.orgId);
  if (updated.error) return { error: updated.error.message };

  if (previousPath && previousPath !== path) {
    await admin.storage.from("org-assets").remove([previousPath]);
  }

  revalidatePath("/settings/organization");
  return { info: `${variant === "square" ? "Square" : "Wordmark"} logo updated.` };
}

export async function removeOrgLogoAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const { user } = auth;

  const variant = String(formData.get("variant") ?? "");
  if (variant !== "square" && variant !== "wordmark") return;
  const column = variant === "square" ? "logo_square_path" : "logo_wordmark_path";

  const admin = createSupabaseAdmin();
  const current = await admin
    .from("orgs")
    .select(column)
    .eq("id", user.orgId)
    .maybeSingle();
  const path = (current.data as Record<string, string | null> | null)?.[column];

  await admin
    .from("orgs")
    .update({ [column]: null, updated_by: user.id })
    .eq("id", user.orgId);

  if (path) {
    await admin.storage.from("org-assets").remove([path]);
  }

  revalidatePath("/settings/organization");
}
