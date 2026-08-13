import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, FileText, Plus, Sparkles, Upload } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ParchmentPanel from "./_parchment-panel";

/** Keeps the page's layout stable while the live Parchment check resolves. */
function ParchmentPanelSkeleton() {
  return (
    <div className="h-[132px] animate-pulse rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03]" />
  );
}

export const dynamic = "force-dynamic";

type DocRow = {
  id: string;
  path: string;
  title: string | null;
  source: string;
  is_core: boolean;
  version: number;
  updated_at: string;
};

export default async function KnowledgePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const { data: docs } = await admin
    .from("knowledge_docs")
    .select("id, path, title, source, is_core, version, updated_at")
    .eq("org_id", user.orgId)
    .order("is_core", { ascending: false })
    .order("path");

  const rows = (docs ?? []) as DocRow[];

  // Chunk counts in one query to avoid an N+1.
  const { data: chunkRows } = await admin
    .from("knowledge_chunks")
    .select("doc_id")
    .eq("org_id", user.orgId);
  const chunkCounts = new Map<string, number>();
  for (const r of (chunkRows ?? []) as { doc_id: string }[]) {
    chunkCounts.set(r.doc_id, (chunkCounts.get(r.doc_id) ?? 0) + 1);
  }

  const core = rows.filter((r) => r.is_core);
  const supplemental = rows.filter((r) => !r.is_core);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Knowledge base</h1>
          <p className="mt-1 max-w-[640px] text-sm text-gray-500 dark:text-gray-400">
            Docs George reads when answering for {user.orgName}. Every chat starts with
            a manifest of all docs (path + title only); George fetches the full content
            on demand via <code>read_knowledge_doc</code> or searches across all docs
            with <code>search_knowledge</code>. <strong>Core</strong> docs are pinned to
            the top of the manifest as &ldquo;read these first&rdquo;.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/settings/knowledge/upload"
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90"
          >
            <Upload size={14} />
            Upload .md
          </Link>
          <Link
            href="/settings/knowledge/new"
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
          >
            <Plus size={14} />
            New doc
          </Link>
        </div>
      </header>

      {/* Where organisational knowledge actually lives. Rendered above the doc
          lists because "which knowledge base is George searching?" is the first
          thing an admin needs to know before reading the lists below. Suspended
          so a slow Parchment never delays the rest of the page. */}
      <Suspense fallback={<ParchmentPanelSkeleton />}>
        <ParchmentPanel />
      </Suspense>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Section
            title="Core playbook"
            subtitle="Pinned to the top of the manifest as 'read these first'. Reserve for foundational role / process / lifecycle docs."
            icon={<Sparkles size={14} className="text-brand-500 dark:text-brand-400" />}
            docs={core}
            chunkCounts={chunkCounts}
          />
          <Section
            title="Supplemental"
            subtitle="Listed in the manifest below core; otherwise treated the same. Add long-form references, playbooks, FAQs here."
            icon={<FileText size={14} className="text-gray-400 dark:text-gray-500" />}
            docs={supplemental}
            chunkCounts={chunkCounts}
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon,
  docs,
  chunkCounts,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  docs: DocRow[];
  chunkCounts: Map<string, number>;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        {icon}
        <h2 className="text-theme-sm font-semibold uppercase tracking-wide text-gray-800 dark:text-white/90">
          {title}
        </h2>
        <span className="text-theme-xs text-gray-400 dark:text-gray-500">({docs.length})</span>
      </div>
      <p className="px-1 text-theme-xs text-gray-400 dark:text-gray-500">{subtitle}</p>

      {docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-4 py-6 text-center text-theme-sm text-gray-400 dark:text-gray-500">
          No {title.toLowerCase()} docs yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
          <Table className="w-full text-left text-sm">
            <TableHeader className="border-b border-gray-200 bg-gray-50 text-theme-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
              <TableRow>
                <Th>Title</Th>
                <Th>Path</Th>
                <Th>Source</Th>
                <Th className="text-right">Chunks</Th>
                <Th className="text-right">Updated</Th>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
              {docs.map((d) => (
                <TableRow
                  key={d.id}
                  className="transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                >
                  <Td>
                    <Link
                      href={`/settings/knowledge/${d.id}`}
                      className="font-medium text-gray-800 dark:text-white/90 hover:text-brand-500 dark:hover:text-brand-400"
                    >
                      {d.title ?? d.path}
                    </Link>
                  </Td>
                  <Td className="text-gray-500 dark:text-gray-400">
                    <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1.5 py-0.5 text-theme-xs">
                      {d.path}
                    </code>
                  </Td>
                  <Td className="text-gray-400 dark:text-gray-500">{sourceLabel(d.source)}</Td>
                  <Td className="text-right text-gray-500 dark:text-gray-400">
                    {chunkCounts.get(d.id) ?? 0}
                  </Td>
                  <Td className="text-right text-gray-400 dark:text-gray-500">
                    {formatDate(d.updated_at)}
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TableCell isHeader className={`px-4 py-2.5 font-medium ${className ?? ""}`}>
      {children}
    </TableCell>
  );
}
function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TableCell className={`px-4 py-3 align-middle ${className ?? ""}`}>
      {children}
    </TableCell>
  );
}

function sourceLabel(source: string) {
  switch (source) {
    case "manual":
      return "git";
    case "ui":
      return "settings";
    default:
      return source;
  }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <BookOpen size={20} />
      </div>
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">No knowledge yet</h2>
      <p className="max-w-[420px] text-sm text-gray-500 dark:text-gray-400">
        Add the playbooks, policies, and reference material George should know. Every
        chat starts with a manifest of these docs; George reads them in full on demand.
        Mark a doc as <em>core</em> to pin it to the top of the manifest.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Link
          href="/settings/knowledge/upload"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 py-2 text-sm font-medium text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
        >
          <Upload size={14} />
          Upload .md files
        </Link>
        <Link
          href="/settings/knowledge/new"
          className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
        >
          <Plus size={14} />
          Create the first doc
        </Link>
      </div>
    </div>
  );
}
