import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, FileText, Plus, Sparkles, Upload } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import ParchmentPanel from "./_parchment-panel";

/** Keeps the page's layout stable while the live Parchment check resolves. */
function ParchmentPanelSkeleton() {
  return (
    <div className="h-[132px] animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)]" />
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
          <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Knowledge base</h1>
          <p className="mt-1 max-w-[640px] text-sm text-[var(--color-fg-secondary)]">
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
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            <Upload size={14} />
            Upload .md
          </Link>
          <Link
            href="/settings/knowledge/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
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
            icon={<Sparkles size={14} className="text-[var(--color-accent)]" />}
            docs={core}
            chunkCounts={chunkCounts}
          />
          <Section
            title="Supplemental"
            subtitle="Listed in the manifest below core; otherwise treated the same. Add long-form references, playbooks, FAQs here."
            icon={<FileText size={14} className="text-[var(--color-fg-muted)]" />}
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
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-fg)]">
          {title}
        </h2>
        <span className="text-[12px] text-[var(--color-fg-muted)]">({docs.length})</span>
      </div>
      <p className="px-1 text-[12px] text-[var(--color-fg-muted)]">{subtitle}</p>

      {docs.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-6 text-center text-[13px] text-[var(--color-fg-muted)]">
          No {title.toLowerCase()} docs yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-3)] text-[12px] uppercase tracking-wide text-[var(--color-fg-secondary)]">
              <tr>
                <Th>Title</Th>
                <Th>Path</Th>
                <Th>Source</Th>
                <Th className="text-right">Chunks</Th>
                <Th className="text-right">Updated</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-3)]"
                >
                  <Td>
                    <Link
                      href={`/settings/knowledge/${d.id}`}
                      className="font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                    >
                      {d.title ?? d.path}
                    </Link>
                  </Td>
                  <Td className="text-[var(--color-fg-secondary)]">
                    <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[12px]">
                      {d.path}
                    </code>
                  </Td>
                  <Td className="text-[var(--color-fg-muted)]">{sourceLabel(d.source)}</Td>
                  <Td className="text-right text-[var(--color-fg-secondary)]">
                    {chunkCounts.get(d.id) ?? 0}
                  </Td>
                  <Td className="text-right text-[var(--color-fg-muted)]">
                    {formatDate(d.updated_at)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
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
  return <th className={`px-4 py-2.5 font-medium ${className ?? ""}`}>{children}</th>;
}
function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-middle ${className ?? ""}`}>{children}</td>;
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <BookOpen size={20} />
      </div>
      <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">No knowledge yet</h2>
      <p className="max-w-[420px] text-sm text-[var(--color-fg-secondary)]">
        Add the playbooks, policies, and reference material George should know. Every
        chat starts with a manifest of these docs; George reads them in full on demand.
        Mark a doc as <em>core</em> to pin it to the top of the manifest.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Link
          href="/settings/knowledge/upload"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
        >
          <Upload size={14} />
          Upload .md files
        </Link>
        <Link
          href="/settings/knowledge/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
        >
          <Plus size={14} />
          Create the first doc
        </Link>
      </div>
    </div>
  );
}
