import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Mic, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getScribeConnection } from "@/lib/agent/scribe";
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
  const supabase = await createSupabaseServer();
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
    <div className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Transcripts</h1>
          <p className="mt-1 max-w-[560px] text-sm text-[var(--color-fg-secondary)]">
            Meeting transcripts from George&apos;s note-taker (Scribe). They sync
            automatically after each meeting and become a source George reads from.
          </p>
        </div>
        {scribe.connected && <SyncButton />}
      </header>

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
        <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/transcripts/${r.id}`}
                className="flex items-start gap-4 px-4 py-3.5 hover:bg-[var(--color-surface-3)]"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                  <Mic size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
                      {r.title || "Untitled meeting"}
                    </span>
                    {r.status && r.status !== "completed" && (
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                        {r.status}
                      </span>
                    )}
                  </div>
                  {r.summary && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--color-fg-secondary)]">
                      {plainText(r.summary)}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-fg-muted)]">
                    <span>{formatWhen(r.ended_at)}</span>
                    {r.duration_min != null && <span>{r.duration_min} min</span>}
                    {attendeeCount(r.attendees) > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users size={10} /> {attendeeCount(r.attendees)}
                      </span>
                    )}
                    {r.customers?.name && (
                      <span className="text-[var(--color-accent)]">{r.customers.name}</span>
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <FileText size={20} />
      </div>
      <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">{title}</h2>
      <p className="max-w-[440px] text-sm text-[var(--color-fg-secondary)]">{text}</p>
    </div>
  );
}
