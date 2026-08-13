import { redirect } from "next/navigation";
import { Network } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { KnowledgeGraph, type GraphEdge, type GraphNode } from "./_graph";

export const dynamic = "force-dynamic";

type DocRow = {
  path: string;
  title: string | null;
  concept_type: string | null;
  is_core: boolean;
  links: string[] | null;
};

// OKF links may be bundle-absolute ("/core/x.md") or relative ("x.md"); the node
// id is the stored path ("core/x.md"). Normalize to compare.
function normalize(link: string): string {
  return link.replace(/^\//, "").trim();
}

export default async function KnowledgeGraphPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from("knowledge_docs")
    .select("path, title, concept_type, is_core, links")
    .eq("org_id", user.orgId)
    .eq("status", "active")
    .order("path");

  const docs = (data ?? []) as DocRow[];
  const ids = new Set(docs.map((d) => d.path));

  const nodes: GraphNode[] = docs.map((d) => ({
    id: d.path,
    title: d.title ?? d.path,
    type: d.concept_type ?? "reference",
    isCore: d.is_core,
  }));

  // Only keep edges to concepts that actually exist (OKF tolerates broken links).
  const edges: GraphEdge[] = [];
  let broken = 0;
  for (const d of docs) {
    for (const raw of d.links ?? []) {
      const to = normalize(raw);
      if (ids.has(to)) edges.push({ from: d.path, to });
      else broken++;
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Knowledge graph</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          George&apos;s knowledge as a connected map — concepts colored by type,
          linked by their OKF cross-references. It grows as proposals are
          approved in Knowledge review.
        </p>
      </header>

      {nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-12 text-center">
          <Network size={22} className="text-gray-400 dark:text-gray-500" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No concepts yet. Run the knowledge sync, or approve proposals in
            Knowledge review, and they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <KnowledgeGraph nodes={nodes} edges={edges} />
      )}

      {broken > 0 && (
        <p className="text-theme-xs text-gray-400 dark:text-gray-500">
          {broken} link{broken === 1 ? "" : "s"} point to concepts that don&apos;t
          exist yet (tolerated by OKF) — not drawn.
        </p>
      )}
    </div>
  );
}
