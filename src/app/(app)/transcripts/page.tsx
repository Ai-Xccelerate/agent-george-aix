import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Mic, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getScribeConnection } from "@/lib/agent/scribe";
import { Badge } from "@/components/ui/badge";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { SyncButton } from "./_sync-button";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string | null;
  status: string | null;
  ended_at: string | null;
  duration_min: number | null;
  attendees: unknown;
  summary: string | null;
  customer_id: string | null;
  customers: { name: string | null } | null;
};

export default async function TranscriptsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const supabase = createSupabaseAdmin();
  const scribe = getScribeConnection();

  const { data } = await supabase
    .from("meeting_transcripts")
    .select(
      "id, title, status, ended_at, duration_min, attendees, summary, customer_id, customers(name)",
    )
    .eq("org_id", user.orgId)
    .order("ended_at", { ascending: false, nullsFirst: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div
      data-aix-id="AIX-110"
      className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12"
    >
      <PageBreadcrumb
        pageTitle="Transcripts"
        description="Meeting transcripts from George's note-taker (Scribe). They sync automatically after each meeting and become a source George reads from."
        actions={scribe.connected ? <SyncButton /> : undefined}
      />

      {!scribe.connected ? (
        <Empty
          title="Scribe isn't connected"
          text="Connect George's note-taker to pull meeting transcripts. Check Settings → AIX George."
        />
      ) : rows.length === 0 ? (
        <Empty
          title="No transcripts yet"
          text="Once Scribe records a meeting George was invited to, the transcript and insights land here within a few minutes."
        />
      ) : (
        <ul
          data-aix-id="AIX-110.2"
          className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/transcripts/${r.id}`}
                className="flex items-start gap-4 px-4 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
                  <Mic size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                      {r.title || "Untitled meeting"}
                    </span>
                    {r.status && r.status !== "completed" && (
                      <Badge tone="neutral" withDot={false}>
                        {r.status}
                      </Badge>
                    )}
                  </div>
                  {r.summary && (
                    <p className="mt-0.5 line-clamp-2 text-theme-xs text-gray-500 dark:text-gray-400">
                      {plainText(r.summary)}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
                    <span>{formatWhen(r.ended_at)}</span>
                    {r.duration_min != null && <span>{r.duration_min} min</span>}
                    {attendeeCount(r.attendees) > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users size={10} /> {attendeeCount(r.attendees)}
                      </span>
                    )}
                    {r.customers?.name && (
                      <span className="font-medium text-brand-500">{r.customers.name}</span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function attendeeCount(a: unknown): number {
  return Array.isArray(a) ? a.length : 0;
}

/** Strip markdown syntax so the list preview reads as plain prose. */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // bullet markers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2") // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/\s+/g, " ") // collapse whitespace/newlines
    .trim();
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center dark:border-gray-700 dark:bg-white/[0.03]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
        <FileText size={20} />
      </div>
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h2>
      <p className="max-w-[440px] text-sm text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  );
}
