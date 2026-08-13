import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { DocForm } from "../_doc-form";
import { deleteDocAction, updateDocAction } from "../actions";

export const dynamic = "force-dynamic";

type DocRow = {
  id: string;
  path: string;
  title: string | null;
  content_md: string;
  is_core: boolean;
  version: number;
  source: string;
  updated_at: string;
};

export default async function EditKnowledgeDocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const { data: docData, error } = await admin
    .from("knowledge_docs")
    .select("id, path, title, content_md, is_core, version, source, updated_at")
    .eq("id", id)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (error || !docData) notFound();
  const doc = docData as DocRow;

  const { count: chunkCount } = await admin
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("doc_id", doc.id);

  return (
    <div className="space-y-5">
      <Link
        href="/settings/knowledge"
        className="inline-flex items-center gap-1 text-theme-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white/90"
      >
        <ChevronLeft size={14} />
        All knowledge
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">
            {doc.title ?? doc.path}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1.5 py-0.5 text-theme-xs">
              {doc.path}
            </code>
            <span className="mx-2 text-gray-400 dark:text-gray-500">·</span>
            {chunkCount ?? 0} chunk{chunkCount === 1 ? "" : "s"}
            <span className="mx-2 text-gray-400 dark:text-gray-500">·</span>
            updated {new Date(doc.updated_at).toLocaleString()}
          </p>
        </div>
        {doc.is_core && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-500/15 px-2.5 py-1 text-theme-xs font-medium text-brand-500 dark:text-brand-400">
            <Sparkles size={12} />
            Core
          </span>
        )}
      </header>

      <DocForm
        mode="edit"
        initial={{
          id: doc.id,
          path: doc.path,
          title: doc.title ?? "",
          content_md: doc.content_md,
          is_core: doc.is_core,
          version: doc.version,
          source: doc.source,
        }}
        saveAction={updateDocAction}
        deleteAction={deleteDocAction}
      />
    </div>
  );
}
