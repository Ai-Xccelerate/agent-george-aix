"use server";

import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type UploadedAttachment = {
  document_id: string;
  message_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size: number;
};

export type UploadResult =
  | { ok: true; attachment: UploadedAttachment }
  | { ok: false; error: string };

/** 10 MB ceiling for chat attachments — bigger files need a different flow. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * MIME allowlist. We accept the formats George can usefully inspect: PDFs +
 * common office docs + screenshots. Reject everything else so the bucket
 * stays a known-contents store.
 */
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

/**
 * Upload a single attachment into a chat session.
 *
 * Flow:
 *   1. Validate the user, the session, and the file.
 *   2. Stream the file into the `customer-docs` Supabase Storage bucket
 *      under `<org_id>/<doc_uuid>-<sanitized_name>`.
 *   3. Insert one `documents` row + one `agent_messages` row in the chat
 *      session so George sees the attachment as the next user message
 *      (with the full metadata in `content_json.attachments`).
 *
 * Server-only — the calling client posts a multipart FormData to this
 * action. Errors are returned, not thrown, so the UI can show them inline.
 */
export async function uploadAttachmentAction(
  formData: FormData,
): Promise<UploadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) return { ok: false, error: "Missing session id." };

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file attached." };
  }
  if (file.size === 0) {
    return { ok: false, error: "File is empty." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `File too large — ${prettyBytes(file.size)}. Max is ${prettyBytes(MAX_FILE_SIZE)}.`,
    };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `Unsupported type "${file.type || "unknown"}". Accepted: PDF, images, Office docs, plain text, CSV, Markdown.`,
    };
  }

  const admin = createSupabaseAdmin();

  // Confirm the session belongs to this org before writing to it.
  const sessionLookup = await admin
    .from("agent_sessions")
    .select("id, org_id")
    .eq("id", sessionId)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (sessionLookup.error || !sessionLookup.data) {
    return { ok: false, error: "Session not found in your org." };
  }

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
      session_id: sessionId,
      uploaded_by: user.id,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    })
    .select("id")
    .single();
  if (docInsert.error) {
    // Roll back the storage object so we don't leak orphans.
    await admin.storage.from("customer-docs").remove([storagePath]);
    return {
      ok: false,
      error: `Could not record document: ${docInsert.error.message}`,
    };
  }

  // Drop a user-role message into the session so the agent SDK sees the
  // attachment next turn, and the chat UI can render the file chip.
  // Text mirrors the structured payload for the SDK's text-only context.
  const attachmentPayload = {
    document_id: docId,
    storage_path: storagePath,
    original_name: file.name,
    mime_type: file.type,
    file_size: file.size,
  };
  // The placeholder text is what George actually sees in his prompt — the
  // chat route forwards message.content as plain text, not the structured
  // attachments. Embed the document_id inline so George can pass it to
  // `read_document` without us also having to plumb content_json into the
  // SDK prompt.
  const messageInsert = await admin
    .from("agent_messages")
    .insert({
      session_id: sessionId,
      role: "user",
      content: `[Attached file: ${file.name} (${file.type}, ${prettyBytes(file.size)}, document_id=${docId})]`,
      content_json: { attachments: [attachmentPayload] },
    })
    .select("id")
    .single();
  if (messageInsert.error) {
    // Storage + documents are kept — the file is real even if the message
    // row failed. Surface the error so the user can retry the send.
    return {
      ok: false,
      error: `Uploaded, but could not record message: ${messageInsert.error.message}`,
    };
  }

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "document.uploaded",
    session_id: sessionId,
    payload: {
      document_id: docId,
      original_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    },
  });

  return {
    ok: true,
    attachment: {
      document_id: docId,
      message_id: messageInsert.data.id as string,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    },
  };
}

/**
 * Mint a short-lived signed URL the chat UI can use to download an
 * attachment (e.g. when the user clicks the file chip). Org-scoped via
 * the session lookup — service-role client could otherwise hand out any
 * doc by id.
 */
export async function getAttachmentDownloadUrl(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const admin = createSupabaseAdmin();
  const lookup = await admin
    .from("documents")
    .select("storage_path, org_id")
    .eq("id", documentId)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (lookup.error || !lookup.data) {
    return { ok: false, error: "Document not found." };
  }

  const signed = await admin.storage
    .from("customer-docs")
    .createSignedUrl(lookup.data.storage_path, 300);
  if (signed.error || !signed.data) {
    return {
      ok: false,
      error: `Could not sign URL: ${signed.error?.message ?? "unknown error"}`,
    };
  }
  return { ok: true, url: signed.data.signedUrl };
}

function sanitizeFilename(name: string): string {
  const noPath = name.replace(/^.*[\\/]/, "");
  const safe = noPath.replace(/[^a-zA-Z0-9._-]+/g, "_");
  // Cap absurdly long names — Supabase tolerates up to 1024 but most file
  // systems wheeze well before that.
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
