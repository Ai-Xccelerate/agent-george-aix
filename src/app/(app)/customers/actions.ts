"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { prettyBytes, sanitizeFilename } from "@/lib/actions";

// All actions return { ok, error?, ...data } so client dialogs can render
// inline errors without throwing.
export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const LIFECYCLES = ["prospect", "onboarding", "active", "at_risk", "churned"] as const;
type Lifecycle = (typeof LIFECYCLES)[number];

const MAX_DOC_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "text/markdown",
]);

function trimmedOrNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

function asLifecycle(v: FormDataEntryValue | null): Lifecycle {
  const s = typeof v === "string" ? v : "";
  return (LIFECYCLES as readonly string[]).includes(s)
    ? (s as Lifecycle)
    : "prospect";
}

// ---------------------------------------------------------------------------
// createPartnerAction — new top-level (channel) partner.
// ---------------------------------------------------------------------------
export async function createPartnerAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const name = trimmedOrNull(formData.get("name"));
  if (!name) return { ok: false, error: "Name is required." };

  const lifecycle = asLifecycle(formData.get("lifecycle"));
  const domain = trimmedOrNull(formData.get("domain"));
  const industry = trimmedOrNull(formData.get("industry"));
  const size = trimmedOrNull(formData.get("size"));
  const notes = trimmedOrNull(formData.get("notes"));

  const admin = createSupabaseAdmin();

  // One partner per domain — surface the existing one instead of duplicating.
  if (domain) {
    const existing = await admin
      .from("customers")
      .select("id, name")
      .eq("org_id", user.orgId)
      .ilike("domain", domain)
      .maybeSingle();
    if (existing.data) {
      return {
        ok: false,
        error: `A partner with domain ${domain} already exists: ${existing.data.name}.`,
      };
    }
  }

  const insert = await admin
    .from("customers")
    .insert({
      org_id: user.orgId,
      name,
      domain,
      lifecycle,
      industry,
      size,
      notes,
      customer_kind: "partner",
      parent_customer_id: null,
      owner_user_id: user.id,
    })
    .select("id")
    .single();
  if (insert.error || !insert.data) {
    const dupe = insert.error?.code === "23505";
    return {
      ok: false,
      error: dupe
        ? `A partner with domain ${domain} already exists.`
        : insert.error?.message ?? "Could not create partner.",
    };
  }

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "customer.created",
    customer_id: insert.data.id,
    payload: { name, kind: "partner", via: "ui" },
  });

  revalidatePath("/customers");
  return { ok: true, id: insert.data.id as string };
}

// ---------------------------------------------------------------------------
// createEndCustomerAction — under a specific partner.
// ---------------------------------------------------------------------------
export async function createEndCustomerAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parentId = trimmedOrNull(formData.get("parent_customer_id"));
  if (!parentId) return { ok: false, error: "Parent partner is required." };

  const name = trimmedOrNull(formData.get("name"));
  if (!name) return { ok: false, error: "Name is required." };

  const lifecycle = asLifecycle(formData.get("lifecycle"));
  const domain = trimmedOrNull(formData.get("domain"));
  const industry = trimmedOrNull(formData.get("industry"));
  const size = trimmedOrNull(formData.get("size"));
  const notes = trimmedOrNull(formData.get("notes"));

  const admin = createSupabaseAdmin();

  // Verify parent is a partner in this org. Otherwise the customers CHECK
  // constraint will reject the insert with a less-helpful message.
  const parent = await admin
    .from("customers")
    .select("id, customer_kind, org_id")
    .eq("id", parentId)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (!parent.data) return { ok: false, error: "Parent partner not found." };
  if (parent.data.customer_kind !== "partner") {
    return { ok: false, error: "Parent must be a partner, not an end customer." };
  }

  const insert = await admin
    .from("customers")
    .insert({
      org_id: user.orgId,
      name,
      domain,
      lifecycle,
      industry,
      size,
      notes,
      customer_kind: "end_customer",
      parent_customer_id: parentId,
      owner_user_id: user.id,
    })
    .select("id")
    .single();
  if (insert.error || !insert.data) {
    return {
      ok: false,
      error: insert.error?.message ?? "Could not create end customer.",
    };
  }

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "customer.created",
    customer_id: insert.data.id,
    payload: { name, kind: "end_customer", parent_id: parentId, via: "ui" },
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${parentId}`);
  return { ok: true, id: insert.data.id as string };
}

// ---------------------------------------------------------------------------
// updateCustomerAction — edit basic fields on an existing customer.
// ---------------------------------------------------------------------------
export async function updateCustomerAction(
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const id = trimmedOrNull(formData.get("id"));
  if (!id) return { ok: false, error: "Missing customer id." };

  const name = trimmedOrNull(formData.get("name"));
  if (!name) return { ok: false, error: "Name is required." };

  const lifecycle = asLifecycle(formData.get("lifecycle"));
  const domain = trimmedOrNull(formData.get("domain"));
  const industry = trimmedOrNull(formData.get("industry"));
  const size = trimmedOrNull(formData.get("size"));
  const notes = trimmedOrNull(formData.get("notes"));

  const admin = createSupabaseAdmin();
  const update = await admin
    .from("customers")
    .update({ name, domain, lifecycle, industry, size, notes })
    .eq("id", id)
    .eq("org_id", user.orgId)
    .select("id, parent_customer_id")
    .maybeSingle();
  if (update.error || !update.data) {
    return {
      ok: false,
      error: update.error?.message ?? "Could not update customer.",
    };
  }

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "customer.updated",
    customer_id: id,
    payload: { via: "ui" },
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  if (update.data.parent_customer_id) {
    revalidatePath(`/customers/${update.data.parent_customer_id}`);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
/**
 * Contact roles George will accept, matching the `contact_role` enum.
 *
 * Validated rather than passed through: an unrecognised value would fail at
 * the database with a type error the form has no way to explain, and an empty
 * string must become NULL (no role) rather than an invalid enum member.
 */
const CONTACT_ROLES = new Set([
  "champion",
  "economic_buyer",
  "executive_sponsor",
  "project_manager",
  "technical_lead",
  "billing",
  "end_user",
  "other",
]);

function contactRole(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return CONTACT_ROLES.has(s) ? s : null;
}

// ---------------------------------------------------------------------------
// addContactAction — new contact under a customer.
// ---------------------------------------------------------------------------
export async function addContactAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const customerId = trimmedOrNull(formData.get("customer_id"));
  if (!customerId) return { ok: false, error: "Missing customer id." };

  const fullName = trimmedOrNull(formData.get("full_name"));
  if (!fullName) return { ok: false, error: "Name is required." };

  const email = trimmedOrNull(formData.get("email"));
  const title = trimmedOrNull(formData.get("title"));
  const phone = trimmedOrNull(formData.get("phone"));
  const timezone = trimmedOrNull(formData.get("timezone"));
  const isPrimary = formData.get("is_primary") === "on";
  const role = contactRole(formData.get("role"));

  const admin = createSupabaseAdmin();

  // Verify the customer belongs to this org.
  const cust = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (!cust.data) return { ok: false, error: "Customer not found." };

  // If marking as primary, demote any existing primary (the partial unique
  // index would otherwise reject the insert).
  if (isPrimary) {
    await admin
      .from("contacts")
      .update({ is_primary: false })
      .eq("customer_id", customerId)
      .eq("is_primary", true);
  }

  const insert = await admin
    .from("contacts")
    .insert({
      customer_id: customerId,
      full_name: fullName,
      role,
      email,
      title,
      phone,
      timezone,
      is_primary: isPrimary,
    })
    .select("id")
    .single();
  if (insert.error || !insert.data) {
    return {
      ok: false,
      error: insert.error?.message ?? "Could not add contact.",
    };
  }

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "contact.created",
    customer_id: customerId,
    payload: { name: fullName, via: "ui" },
  });

  revalidatePath(`/customers/${customerId}`);
  return { ok: true, id: insert.data.id as string };
}

// ---------------------------------------------------------------------------
// updateContactAction — edit an existing contact.
// ---------------------------------------------------------------------------
export async function updateContactAction(
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const id = trimmedOrNull(formData.get("id"));
  if (!id) return { ok: false, error: "Missing contact id." };

  const fullName = trimmedOrNull(formData.get("full_name"));
  if (!fullName) return { ok: false, error: "Name is required." };

  const email = trimmedOrNull(formData.get("email"));
  const title = trimmedOrNull(formData.get("title"));
  const phone = trimmedOrNull(formData.get("phone"));
  const timezone = trimmedOrNull(formData.get("timezone"));
  const isPrimary = formData.get("is_primary") === "on";
  const role = contactRole(formData.get("role"));

  const admin = createSupabaseAdmin();

  // Load contact + parent customer org for an org check + primary-demotion.
  const contact = await admin
    .from("contacts")
    .select("id, customer_id, is_primary, customers!inner(org_id)")
    .eq("id", id)
    .maybeSingle();
  if (!contact.data) return { ok: false, error: "Contact not found." };

  const parentOrg = (
    contact.data.customers as { org_id?: string } | { org_id?: string }[] | null
  );
  const parentOrgId = Array.isArray(parentOrg)
    ? parentOrg[0]?.org_id
    : parentOrg?.org_id;
  if (parentOrgId !== user.orgId) {
    return { ok: false, error: "Contact not in your org." };
  }

  const customerId = contact.data.customer_id as string;

  if (isPrimary && !contact.data.is_primary) {
    await admin
      .from("contacts")
      .update({ is_primary: false })
      .eq("customer_id", customerId)
      .eq("is_primary", true);
  }

  const update = await admin
    .from("contacts")
    .update({
      full_name: fullName,
      role,
      email,
      title,
      phone,
      timezone,
      is_primary: isPrimary,
    })
    .eq("id", id);
  if (update.error) {
    return {
      ok: false,
      error: update.error.message ?? "Could not update contact.",
    };
  }

  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// uploadCustomerDocumentAction — upload a file scoped to a customer.
// Same shape as chat's uploadAttachmentAction but bound to a customer
// instead of a session, so it appears in the Documents tab.
// ---------------------------------------------------------------------------
export async function uploadCustomerDocumentAction(
  formData: FormData,
): Promise<
  ActionResult<{
    document_id: string;
    storage_path: string;
    original_name: string;
    mime_type: string;
    file_size: number;
  }>
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const customerId = trimmedOrNull(formData.get("customer_id"));
  if (!customerId) return { ok: false, error: "Missing customer id." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file attached." };
  if (file.size === 0) return { ok: false, error: "File is empty." };
  if (file.size > MAX_DOC_SIZE) {
    return {
      ok: false,
      error: `File too large — ${prettyBytes(file.size)}. Max is ${prettyBytes(MAX_DOC_SIZE)}.`,
    };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `Unsupported type "${file.type || "unknown"}". Accepted: PDF, images, Office docs, plain text, CSV, Markdown.`,
    };
  }

  const admin = createSupabaseAdmin();
  const cust = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (!cust.data) return { ok: false, error: "Customer not found." };

  const docId = randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storagePath = `${user.orgId}/${docId}-${safeName}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const upload = await admin.storage
    .from("customer-docs")
    .upload(storagePath, buf, {
      contentType: file.type,
      upsert: false,
    });
  if (upload.error) {
    return { ok: false, error: `Upload failed: ${upload.error.message}` };
  }

  const docInsert = await admin
    .from("documents")
    .insert({
      id: docId,
      org_id: user.orgId,
      customer_id: customerId,
      uploaded_by: user.id,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    })
    .select("id")
    .single();
  if (docInsert.error) {
    await admin.storage.from("customer-docs").remove([storagePath]);
    return {
      ok: false,
      error: `Could not record document: ${docInsert.error.message}`,
    };
  }

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "document.uploaded",
    customer_id: customerId,
    payload: {
      document_id: docId,
      original_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    },
  });

  revalidatePath(`/customers/${customerId}`);
  return {
    ok: true,
    document_id: docId,
    storage_path: storagePath,
    original_name: file.name,
    mime_type: file.type,
    file_size: file.size,
  };
}

// ---------------------------------------------------------------------------
// getCustomerDocumentDownloadUrl — short-lived signed URL for the Documents
// tab download button. Org-scoped via the customer's org check.
// ---------------------------------------------------------------------------
export async function getCustomerDocumentDownloadUrl(
  documentId: string,
): Promise<ActionResult<{ url: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const admin = createSupabaseAdmin();
  const doc = await admin
    .from("documents")
    .select("storage_path, org_id")
    .eq("id", documentId)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (!doc.data) return { ok: false, error: "Document not found." };

  const signed = await admin.storage
    .from("customer-docs")
    .createSignedUrl(doc.data.storage_path, 300);
  if (signed.error || !signed.data) {
    return {
      ok: false,
      error: `Could not sign URL: ${signed.error?.message ?? "unknown error"}`,
    };
  }
  return { ok: true, url: signed.data.signedUrl };
}
