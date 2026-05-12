"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { chunkMarkdown, extractTitle } from "@/lib/knowledge/chunk";

const ADMIN_ROLES = new Set(["owner", "admin"]);

function normalisePath(raw: string): string {
  let p = raw.trim().toLowerCase().replace(/\s+/g, "-");
  p = p.replace(/^\/+|\/+$/g, "");
  if (!p.endsWith(".md")) p = `${p}.md`;
  if (!/^[a-z0-9._\-/]+$/.test(p)) {
    throw new Error(
      "Path must be lowercase letters, numbers, dashes, underscores, dots, and forward slashes only.",
    );
  }
  return p;
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!ADMIN_ROLES.has(user.role)) redirect("/settings/profile");
  return user;
}

async function rechunk(
  admin: ReturnType<typeof createSupabaseAdmin>,
  args: { docId: string; orgId: string; path: string; title: string; content: string },
) {
  const del = await admin.from("knowledge_chunks").delete().eq("doc_id", args.docId);
  if (del.error) throw del.error;

  const chunks = chunkMarkdown(args.content);
  if (chunks.length === 0) return;

  const rows = chunks.map((c, i) => ({
    doc_id: args.docId,
    org_id: args.orgId,
    ordinal: i,
    content: c,
    metadata: { source_path: args.path, title: args.title },
  }));
  const ins = await admin.from("knowledge_chunks").insert(rows);
  if (ins.error) throw ins.error;
}

export async function createDocAction(formData: FormData) {
  const user = await requireAdmin();
  const path = normalisePath(String(formData.get("path") ?? ""));
  const titleRaw = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  const isCore = formData.get("is_core") === "on";

  if (!content.trim()) throw new Error("Content is required.");
  const title = titleRaw || extractTitle(content) || path.replace(/\.md$/, "");

  const admin = createSupabaseAdmin();
  const { data: doc, error } = await admin
    .from("knowledge_docs")
    .insert({
      org_id: user.orgId,
      path,
      title,
      content_md: content,
      source: "ui",
      is_core: isCore,
      updated_by: user.id,
      version: 1,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`A doc at path "${path}" already exists.`);
    throw error;
  }

  await rechunk(admin, {
    docId: doc.id,
    orgId: user.orgId,
    path,
    title,
    content,
  });

  revalidatePath("/settings/knowledge");
  redirect(`/settings/knowledge/${doc.id}`);
}

export async function updateDocAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing doc id.");

  const path = normalisePath(String(formData.get("path") ?? ""));
  const titleRaw = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  const isCore = formData.get("is_core") === "on";

  if (!content.trim()) throw new Error("Content is required.");
  const title = titleRaw || extractTitle(content) || path.replace(/\.md$/, "");

  const admin = createSupabaseAdmin();
  const { data: existing, error: readErr } = await admin
    .from("knowledge_docs")
    .select("id, version, source")
    .eq("id", id)
    .eq("org_id", user.orgId)
    .single();
  if (readErr || !existing) throw new Error("Doc not found.");

  // Once an admin edits a doc through the UI, the UI becomes its source of
  // truth — flip source to "ui" so `pnpm sync:knowledge` won't overwrite or
  // prune it on the next run.
  const { error: updateErr } = await admin
    .from("knowledge_docs")
    .update({
      path,
      title,
      content_md: content,
      is_core: isCore,
      source: "ui",
      updated_by: user.id,
      version: existing.version + 1,
    })
    .eq("id", id);
  if (updateErr) {
    if (updateErr.code === "23505") {
      throw new Error(`A doc at path "${path}" already exists.`);
    }
    throw updateErr;
  }

  await rechunk(admin, { docId: id, orgId: user.orgId, path, title, content });

  revalidatePath("/settings/knowledge");
  revalidatePath(`/settings/knowledge/${id}`);
}

export async function deleteDocAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing doc id.");

  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("knowledge_docs")
    .delete()
    .eq("id", id)
    .eq("org_id", user.orgId);
  if (error) throw error;

  revalidatePath("/settings/knowledge");
  redirect("/settings/knowledge");
}
