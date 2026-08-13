import { redirect } from "next/navigation";
import { BookOpen, CheckCircle2, Clock } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import { ReviewCard, type Proposal } from "./_review-card";
import { ReviewersForm } from "./_reviewers-form";

export const dynamic = "force-dynamic";

export default async function KnowledgeReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();

  const [pendingRes, recentRes, statsRes] = await Promise.all([
    admin
      .from("knowledge_proposals")
      .select(
        "id, path, kind, concept_type, title, description, tags, links, content_md, source, rationale, created_at",
      )
      .eq("org_id", user.orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    admin
      .from("knowledge_proposals")
      .select("id, path, title, status, reviewed_at")
      .eq("org_id", user.orgId)
      .in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false })
      .limit(10),
    admin
      .from("knowledge_docs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", user.orgId)
      .eq("status", "active"),
  ]);

  const agent = await getAgentSettings(admin, user.orgId);
  const pending = (pendingRes.data ?? []) as Proposal[];
  const recent = (recentRes.data ?? []) as {
    id: string;
    path: string;
    title: string | null;
    status: string;
    reviewed_at: string | null;
  }[];
  const activeCount = statsRes.count ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Knowledge review</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          George proposes new knowledge from conversations, emails, and meetings.
          Nothing enters his knowledge base until you approve it here — the
          knowledge version of &ldquo;draft, never auto-send.&rdquo; Approving
          embeds the concept into retrieval immediately.
        </p>
      </header>

      <div className="flex gap-3">
        <Stat icon={Clock} label="Pending review" value={pending.length} />
        <Stat icon={BookOpen} label="Active concepts" value={activeCount} />
      </div>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Reviewers</h2>
        <p className="mt-1 mb-3 text-theme-xs text-gray-400 dark:text-gray-500">
          Who reviews George&apos;s knowledge proposals on the weekly cadence.
        </p>
        <ReviewersForm reviewers={agent.knowledge_reviewers} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Pending proposals
        </h2>
        {pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-10 text-center">
            <CheckCircle2 size={20} className="text-success-500" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nothing waiting for review. George will queue proposals here as he
              learns from conversations.
            </p>
          </div>
        ) : (
          pending.map((p) => <ReviewCard key={p.id} p={p} />)
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Recently reviewed
          </h2>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] divide-y divide-gray-100 dark:divide-gray-800">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-theme-sm text-gray-800 dark:text-white/90">
                  {r.title ?? r.path}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-theme-xs font-medium ${
                    r.status === "approved"
                      ? "bg-success-50 dark:bg-success-500/15 text-success-500"
                      : "bg-gray-50 dark:bg-white/[0.03] text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <Icon size={16} />
      </div>
      <div>
        <div className="text-lg font-bold leading-none text-gray-800 dark:text-white/90">{value}</div>
        <div className="mt-0.5 text-theme-xs text-gray-400 dark:text-gray-500">{label}</div>
      </div>
    </div>
  );
}
