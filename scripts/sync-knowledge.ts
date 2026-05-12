/**
 * Sync markdown files from `george/knowledge/**` into Supabase.
 *
 *  - Each file becomes one `knowledge_docs` row (path = relative path from
 *    `knowledge/`, title = first H1 or filename, content_md = raw text,
 *    version bumped each run).
 *  - Each file is chunked into `knowledge_chunks` rows. When
 *    `OPENAI_API_KEY` is set, each chunk is embedded with
 *    `text-embedding-3-small` and written to the `embedding` column —
 *    `search_knowledge` then uses pgvector cosine distance. Without the
 *    key, chunks are inserted with NULL embeddings and search falls back
 *    to ilike scoring.
 *  - A backfill pass at the end embeds any pre-existing chunks that were
 *    inserted before the key was provisioned.
 *
 * Usage:  pnpm sync:knowledge
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CHUNK_OVERLAP,
  CHUNK_TARGET,
  chunkMarkdown,
  extractTitle,
} from "../src/lib/knowledge/chunk";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

import {
  embedBatch,
  hasEmbeddingProvider,
} from "../src/lib/knowledge/embeddings";

const ONYX_ORG_ID = "00000000-0000-0000-0000-000000000001";
const KNOWLEDGE_DIR = path.resolve(process.cwd(), "knowledge");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// pgvector accepts the textual form "[0.1,0.2,...]" when written via PostgREST.
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env. Did .env.local load?");
  }

  const embeddingsEnabled = hasEmbeddingProvider();
  console.log(
    `[sync-knowledge] Embeddings: ${embeddingsEnabled ? "ENABLED (text-embedding-3-small)" : "DISABLED (set OPENAI_API_KEY to enable)"}`,
  );

  const files = await walk(KNOWLEDGE_DIR);
  console.log(`[sync-knowledge] Found ${files.length} markdown file(s) under ${KNOWLEDGE_DIR}`);

  const seenPaths: string[] = [];

  for (const absPath of files) {
    const relPath = path.relative(KNOWLEDGE_DIR, absPath).split(path.sep).join("/");
    seenPaths.push(relPath);

    const content = await fs.readFile(absPath, "utf8");
    const title = extractTitle(content) ?? path.basename(absPath, ".md");

    const { data: existing } = await supabase
      .from("knowledge_docs")
      .select("id, version, content_md")
      .eq("org_id", ONYX_ORG_ID)
      .eq("path", relPath)
      .maybeSingle();

    if (existing && existing.content_md === content) {
      console.log(`  · unchanged  ${relPath}`);
      continue;
    }

    // Convention: anything under `knowledge/core/...` is core knowledge —
    // surfaced first in the manifest. Search spans the whole KB regardless.
    const isCore = relPath.startsWith("core/");

    const upsertRow = {
      org_id: ONYX_ORG_ID,
      path: relPath,
      title,
      content_md: content,
      source: "manual",
      is_core: isCore,
      version: (existing?.version ?? 0) + 1,
    };

    const { data: doc, error: docErr } = await supabase
      .from("knowledge_docs")
      .upsert(upsertRow, { onConflict: "org_id,path" })
      .select("id")
      .single();
    if (docErr) throw docErr;

    // Replace chunks (delete then insert — simpler than diffing).
    const del = await supabase.from("knowledge_chunks").delete().eq("doc_id", doc.id);
    if (del.error) throw del.error;

    const chunks = chunkMarkdown(content, CHUNK_TARGET, CHUNK_OVERLAP);
    if (chunks.length > 0) {
      const embeddings = embeddingsEnabled ? await embedBatch(chunks) : [];
      const rows = chunks.map((c, i) => ({
        doc_id: doc.id,
        org_id: ONYX_ORG_ID,
        ordinal: i,
        content: c,
        metadata: { source_path: relPath, title },
        embedding: embeddingsEnabled ? toVectorLiteral(embeddings[i]) : null,
      }));
      const ins = await supabase.from("knowledge_chunks").insert(rows);
      if (ins.error) throw ins.error;
    }

    console.log(
      `  ✓ ${existing ? "updated" : "created"}  ${relPath}  ${isCore ? "[CORE]" : "[supplemental]"} (${chunks.length} chunks)`,
    );
  }

  // Prune docs that no longer have a file on disk.
  const { data: stale } = await supabase
    .from("knowledge_docs")
    .select("id, path")
    .eq("org_id", ONYX_ORG_ID)
    .eq("source", "manual");
  const toDelete = (stale ?? []).filter((r) => !seenPaths.includes(r.path));
  if (toDelete.length > 0) {
    const ids = toDelete.map((r) => r.id);
    await supabase.from("knowledge_docs").delete().in("id", ids);
    console.log(`  · deleted ${toDelete.length} doc(s) no longer on disk`);
  }

  // Backfill any chunks left with NULL embeddings (e.g. from past runs
  // before the key was provisioned, or docs the loop above marked
  // "unchanged"). Processes in batches to stay under request limits.
  if (embeddingsEnabled) {
    let backfilled = 0;
    while (true) {
      const { data: pending, error } = await supabase
        .from("knowledge_chunks")
        .select("id, content")
        .eq("org_id", ONYX_ORG_ID)
        .is("embedding", null)
        .limit(128);
      if (error) throw error;
      if (!pending || pending.length === 0) break;

      const vectors = await embedBatch(pending.map((r) => r.content ?? ""));
      for (let i = 0; i < pending.length; i++) {
        const { error: updErr } = await supabase
          .from("knowledge_chunks")
          .update({ embedding: toVectorLiteral(vectors[i]) })
          .eq("id", pending[i].id);
        if (updErr) throw updErr;
      }
      backfilled += pending.length;
      console.log(`  · backfilled ${backfilled} chunk embedding(s) so far`);
    }
    if (backfilled > 0) {
      console.log(`  ✓ backfill complete (${backfilled} chunk embedding(s))`);
    }
  }

  console.log("[sync-knowledge] Done.");
}

async function walk(dir: string): Promise<string[]> {
  let entries: import("fs").Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

main().catch((err) => {
  console.error("[sync-knowledge] FAILED:", err);
  process.exit(1);
});
