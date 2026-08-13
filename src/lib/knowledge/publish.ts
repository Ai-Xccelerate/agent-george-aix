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
import { isParchmentEnabled, parchment } from "@/lib/parchment/client";

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export type PublishResult =
  | { ok: true; docId: string; chunks: number; parchment?: ParchmentMirror }
  | { ok: false; error: string };

/** Outcome of mirroring an approved concept into Parchment, when connected. */
export type ParchmentMirror =
  | { mirrored: true; jobId: string }
  | { mirrored: false; reason: string };

/**
 * Push an approved concept into Parchment, which holds the organisation's
 * knowledge once it is connected.
 *
 * WHY APPROVAL IS THE HANDOFF POINT, NOT PROPOSAL
 * Parchment's REST API has no "propose" endpoint — staging a learning for review
 * is MCP-only. Rather than add a second protocol, review stays in George, where
 * the reviewers are already configured (`/settings/agent/knowledge`), and only
 * approved knowledge crosses over. That keeps the human gate exactly where it
 * was and means Parchment never holds anything unreviewed.
 *
 * `/ingest` MERGES on `source_file`: matching sections update in place, new ones
 * append, omitted ones are kept. So re-approving an edited concept updates it
 * rather than duplicating — which is why the path is used as the source_file.
 *
 * Fails open and never throws. Publishing must not depend on Parchment being
 * reachable: the concept is already live in George's own knowledge base by this
 * point, and blocking a reviewer's approval on an unrelated outage would be
 * indefensible. A failed mirror is recorded in the audit log so it can be
 * replayed rather than silently lost.
 */
async function mirrorToParchment(
  path: string,
  content: string,
): Promise<ParchmentMirror> {
  if (!isParchmentEnabled()) {
    return { mirrored: false, reason: "Parchment not configured" };
  }
  const res = await parchment.ingest({ source_file: path, content });
  if (!res.ok) return { mirrored: false, reason: res.error };
  return { mirrored: true, jobId: res.data.job_id };
}

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

  // Hand the approved concept to Parchment, if connected. Deliberately after the
  // local publish succeeded: George's own knowledge base is the thing that must
  // be correct, and the mirror is additive.
  const mirror = await mirrorToParchment(prop.path, fullDoc);
  if (!mirror.mirrored && isParchmentEnabled()) {
    console.warn(`[knowledge] Parchment mirror failed for ${prop.path}: ${mirror.reason}`);
  }

  // Audit-log entry — the OKF-style change history for George-authored knowledge.
  // The mirror outcome is recorded here so a failed hand-off is recoverable
  // rather than invisible.
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
      parchment: mirror,
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

  return { ok: true, docId: doc.id, chunks: chunks.length, parchment: mirror };
}
