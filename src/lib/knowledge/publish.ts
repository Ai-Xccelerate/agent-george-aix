/**
 * Publish an approved knowledge proposal into the live knowledge base.
 *
 * This is the one place a George-authored concept becomes retrievable. It runs
 * only on explicit human approval (the Review Queue), never autonomously —
 * the knowledge analog of requiring a human to hit "send" on an email draft.
 *
 * Steps: upsert the concept into knowledge_docs (status 'active') → replace its
 * chunks and embed them (so search picks it up) → append an audit-log entry
 * (the change history) → mark the proposal approved.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHUNK_OVERLAP, CHUNK_TARGET, chunkMarkdown } from "./chunk";
import { embedBatch, hasEmbeddingProvider } from "./embeddings";
import { serializeFrontmatter } from "./frontmatter";

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export type PublishResult =
  | { ok: true; docId: string; chunks: number }
  | { ok: false; error: string };

/*
 * NOTE — why nothing is pushed to Parchment here.
 *
 * An earlier version mirrored every approved concept into Parchment's `/ingest`.
 * That cannot work on the internal agent path: it grants exactly the `agent`
 * role, and `/ingest` refuses it with "Requires editor role; credential has
 * agent" (verified against staging, HTTP 403). Writing back therefore needs
 * either an editor-role key or Parchment's proposal tools, which are MCP-only.
 *
 * So the direction of travel is one-way for now: Parchment holds the
 * organisation's knowledge and George reads it; George's own approved concepts
 * stay in its local knowledge base. Pushing them back is a follow-up that needs
 * the MCP transport, not a missing line here.
 */

type Proposal = {
  id: string;
  org_id: string;
  path: string;
  concept_type: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  links: string[] | null;
  content_md: string;
  proposed_by: string | null;
  status: string;
};

export async function publishProposal(
  admin: SupabaseClient,
  proposalId: string,
  reviewerId: string | null,
  reviewNote?: string | null,
): Promise<PublishResult> {
  const { data: p, error: pErr } = await admin
    .from("knowledge_proposals")
    .select(
      "id, org_id, path, concept_type, title, description, tags, links, content_md, proposed_by, status",
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (pErr) return { ok: false, error: pErr.message };
  if (!p) return { ok: false, error: "Proposal not found." };
  const prop = p as Proposal;
  if (prop.status !== "pending") {
    return { ok: false, error: `Proposal is already ${prop.status}.` };
  }

  const isCore = prop.path.startsWith("core/");
  const body = prop.content_md;
  // Store the full OKF document (frontmatter + body) so it round-trips and the
  // graph/editor can read the metadata back out.
  const frontmatter = serializeFrontmatter({
    type: prop.concept_type ?? undefined,
    title: prop.title ?? undefined,
    description: prop.description ?? undefined,
    tags: prop.tags ?? undefined,
    links: prop.links ?? undefined,
  });
  const fullDoc = frontmatter + body;

  // Bump version if the concept already exists (a proposed edit).
  const { data: existing } = await admin
    .from("knowledge_docs")
    .select("id, version")
    .eq("org_id", prop.org_id)
    .eq("path", prop.path)
    .maybeSingle();

  const { data: doc, error: docErr } = await admin
    .from("knowledge_docs")
    .upsert(
      {
        org_id: prop.org_id,
        path: prop.path,
        title: prop.title,
        content_md: fullDoc,
        source: "george",
        is_core: isCore,
        version: ((existing as { version?: number } | null)?.version ?? 0) + 1,
        concept_type: prop.concept_type,
        description: prop.description,
        tags: prop.tags ?? [],
        links: prop.links ?? [],
        status: "active",
        proposed_by: prop.proposed_by,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "org_id,path" },
    )
    .select("id")
    .single();
  if (docErr) return { ok: false, error: docErr.message };

  // Replace chunks and embed the body so retrieval picks the concept up.
  await admin.from("knowledge_chunks").delete().eq("doc_id", doc.id);
  const chunks = chunkMarkdown(body, CHUNK_TARGET, CHUNK_OVERLAP);
  if (chunks.length > 0) {
    const embeddingsEnabled = hasEmbeddingProvider();
    const embeddings = embeddingsEnabled ? await embedBatch(chunks) : [];
    const rows = chunks.map((c, i) => ({
      doc_id: doc.id,
      org_id: prop.org_id,
      ordinal: i,
      content: c,
      metadata: { source_path: prop.path, title: prop.title },
      embedding: embeddingsEnabled ? toVectorLiteral(embeddings[i]) : null,
    }));
    const ins = await admin.from("knowledge_chunks").insert(rows);
    if (ins.error) return { ok: false, error: ins.error.message };
  }

  // Audit-log entry — the OKF-style change history for George-authored knowledge.
  await admin.from("audit_log").insert({
    org_id: prop.org_id,
    actor: reviewerId ?? "system",
    action: "knowledge.published",
    payload: {
      proposal_id: prop.id,
      path: prop.path,
      title: prop.title,
      version: ((existing as { version?: number } | null)?.version ?? 0) + 1,
      chunks: chunks.length,
      review_note: reviewNote ?? null,
    },
  });

  const { error: markErr } = await admin
    .from("knowledge_proposals")
    .update({
      status: "approved",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote ?? null,
    })
    .eq("id", prop.id);
  if (markErr) return { ok: false, error: markErr.message };

  return { ok: true, docId: doc.id, chunks: chunks.length };
}
