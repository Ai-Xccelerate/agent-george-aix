"use server";

import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type UploadedAttachment = {
  document_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size: number;
};

export type UploadResult =
  | { ok: true; attachments: UploadedAttachment[] }
  | { ok: false; error: string };

/**
 * Back-compat shim: the old single-file action that also wrote an
 * agent_messages row. Kept until the chat client is migrated to the
 * multi-file flow. New code should use `uploadFilesAction`.
 */
export async function uploadAttachmentAction(
  formData: FormData,
): Promise<
  | { ok: true; attachment: UploadedAttachment & { message_id: string } }
  | { ok: false; error: string }
> {
  // Rewrap to the multi-file signature so we share validation + upload.
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file attached." };
  const newFd = new FormData();
  newFd.set("session_id", String(formData.get("session_id") ?? ""));
  newFd.append("files", file);
  const res = await uploadFilesAction(newFd);
  if (!res.ok) return res;
  const a = res.attachments[0];

  // Preserve the legacy behavior of inserting a placeholder user message
  // so existing UI keeps working until the multi-file send path lands.
  const { getCurrentUser } = await import("@/lib/supabase/current-user");
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const admin = createSupabaseAdmin();
  const sessionId = String(formData.get("session_id") ?? "");
  const messageInsert = await admin
    .from("agent_messages")
    .insert({
      session_id: sessionId,
      role: "user",
      content: `[Attached file: ${a.original_name} (${a.mime_type}, document_id=${a.document_id})]`,
      content_json: { attachments: [a] },
    })
    .select("id")
    .single();
  if (messageInsert.error) {
    return {
      ok: false,
      error: `Uploaded, but could not record message: ${messageInsert.error.message}`,
    };
  }
  return {
    ok: true,
    attachment: { ...a, message_id: messageInsert.data.id as string },
  };
}

/** 25 MB ceiling per file. Office docs run bigger than PDFs. */
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES_PER_TURN = 10;

/**
 * Accepted MIME types. Office docs + plain text + images + PDFs. Some
 * browsers emit empty `file.type` for `.md`; we fall back to the file
 * extension below when that happens.
 */
const ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/x-markdown",
]);

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  markdown: "text/markdown",
};

/**
 * Upload one or more attachments to the chat session. This action only
 * stores files + writes `documents` rows; it does NOT insert an
 * `agent_messages` row. The chat send path (POST /api/chat) is
 * responsible for persisting the user's message with attachments embedded
 * in `content_json.attachments`. That keeps the message + its prompt
 * atomic: one user turn, one row, one entry in the SDK transcript.
 */
export async function uploadFilesAction(
  formData: FormData,
): Promise<UploadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) return { ok: false, error: "Missing session id." };

  const rawFiles = formData.getAll("files");
  const files = rawFiles.filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, error: "No files attached." };
  if (files.length > MAX_FILES_PER_TURN) {
    return {
      ok: false,
      error: `Too many files in one turn (max ${MAX_FILES_PER_TURN}).`,
    };
  }

  const admin = createSupabaseAdmin();

  // Confirm the session belongs to this org once, up front.
  const sessionLookup = await admin
    .from("agent_sessions")
    .select("id, org_id")
    .eq("id", sessionId)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (sessionLookup.error || !sessionLookup.data) {
    return { ok: false, error: "Session not found in your org." };
  }

  // Validate every file first so we don't half-upload a batch.
  for (const file of files) {
    if (file.size === 0) {
      return { ok: false, error: `"${file.name}" is empty.` };
    }
    if (file.size > MAX_FILE_SIZE) {
      return {
        ok: false,
        error: `"${file.name}" is too large (${prettyBytes(file.size)}). Max is ${prettyBytes(MAX_FILE_SIZE)}.`,
      };
    }
    const effectiveType = resolveMimeType(file);
    if (!effectiveType || !ALLOWED_MIME.has(effectiveType)) {
      return {
        ok: false,
        error: `Unsupported type for "${file.name}". Accepted: PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, images.`,
      };
    }
  }

  const uploaded: UploadedAttachment[] = [];
  // Per-file: stage to storage, then write the documents row. If any step
  // fails we roll back the storage objects already created in this batch
  // so we don't leak orphans.
  const storagePaths: string[] = [];
  for (const file of files) {
    const mimeType = resolveMimeType(file)!;
    const docId = randomUUID();
    const safeName = sanitizeFilename(file.name);
    const storagePath = `${user.orgId}/${docId}-${safeName}`;
    const buf = Buffer.from(await file.arrayBuffer());

    const upload = await admin.storage
      .from("customer-docs")
      .upload(storagePath, buf, { contentType: mimeType, upsert: false });
    if (upload.error) {
      await admin.storage.from("customer-docs").remove(storagePaths);
      return {
        ok: false,
        error: `Upload failed for "${file.name}": ${upload.error.message}`,
      };
    }
    storagePaths.push(storagePath);

    const docInsert = await admin
      .from("documents")
      .insert({
        id: docId,
        org_id: user.orgId,
        session_id: sessionId,
        uploaded_by: user.id,
        storage_path: storagePath,
        original_name: file.name,
        mime_type: mimeType,
        file_size: file.size,
      })
      .select("id")
      .single();
    if (docInsert.error) {
      await admin.storage.from("customer-docs").remove(storagePaths);
      return {
        ok: false,
        error: `Could not record "${file.name}": ${docInsert.error.message}`,
      };
    }

    uploaded.push({
      document_id: docId,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: mimeType,
      file_size: file.size,
    });
  }

  // Audit each upload separately so the /inbox audit feed shows each file.
  await Promise.all(
    uploaded.map((a) =>
      admin.from("audit_log").insert({
        org_id: user.orgId,
        actor: user.id,
        action: "document.uploaded",
        session_id: sessionId,
        payload: {
          document_id: a.document_id,
          original_name: a.original_name,
          mime_type: a.mime_type,
          file_size: a.file_size,
        },
      }),
    ),
  );

  return { ok: true, attachments: uploaded };
}

/**
 * Mint a short-lived signed URL the chat UI can use to download an
 * attachment (e.g. when the user clicks the file chip). Org-scoped via
 * the documents row.
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

function resolveMimeType(file: File): string | null {
  if (file.type && ALLOWED_MIME.has(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  // Some browsers send the right MIME with a quirky charset suffix.
  if (file.type) {
    const stripped = file.type.split(";")[0].trim();
    if (ALLOWED_MIME.has(stripped)) return stripped;
  }
  return null;
}

function sanitizeFilename(name: string): string {
  const noPath = name.replace(/^.*[\\/]/, "");
  const safe = noPath.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
