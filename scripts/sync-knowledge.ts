/**
 * Sync markdown files from `george/knowledge/**` into Supabase.
 *
 *  - Each file becomes one `knowledge_docs` row (path = relative path from
 *    `knowledge/`, title = first H1 or filename, content_md = raw text,
 *    version bumped each run).
 *  - Each file is chunked into `knowledge_chunks` rows. Embeddings are left
 *    NULL for now; we'll backfill in a separate step once an embedding
 *    provider is wired up. `search_knowledge` works on these chunks via
 *    `ilike` until then.
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

const ONYX_ORG_ID = "00000000-0000-0000-0000-000000000001";
const KNOWLEDGE_DIR = path.resolve(process.cwd(), "knowledge");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env. Did .env.local load?");
  }

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
    // always loaded fully into George's system prompt at session start.
    // Everything else stays as chunked supplemental knowledge (RAG path).
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
      const rows = chunks.map((c, i) => ({
        doc_id: doc.id,
        org_id: ONYX_ORG_ID,
        ordinal: i,
        content: c,
        metadata: { source_path: relPath, title },
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
