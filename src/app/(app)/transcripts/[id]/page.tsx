import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Transcript = {
  id: string;
  title: string | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_min: number | null;
  attendees: unknown;
  transcript_text: string | null;
  insights: unknown;
  summary: string | null;
  meeting_url: string | null;
  customer_id: string | null;
  customers: { name: string | null } | null;
};

export default async function TranscriptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const { id } = await params;
  const supabase = await createSupabaseServer();

  const { data } = await supabase
    .from("meeting_transcripts")
    .select(
      "id, title, status, started_at, ended_at, duration_min, attendees, transcript_text, insights, summary, meeting_url, customer_id, customers(name)",
    )
    .eq("org_id", user.orgId)
    .eq("id", id)
    .maybeSingle();
  const t = data as unknown as Transcript | null;
  if (!t) notFound();

  const attendees = normalizeAttendees(t.attendees);
  const insightLists = extractInsightLists(t.insights);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <Link
        href="/transcripts"
        className="inline-flex items-center gap-1 text-[13px] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
      >
        <ChevronLeft size={14} />
        All transcripts
      </Link>

      <header className="mt-4">
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">
          {t.title || "Untitled meeting"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-fg-muted)]">
          <span>{formatWhen(t.started_at ?? t.ended_at)}</span>
          {t.duration_min != null && <span>{t.duration_min} min</span>}
          {attendees.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users size={11} /> {attendees.length} attendees
            </span>
          )}
          {t.customers?.name && t.customer_id && (
            <Link
              href={`/customers/${t.customer_id}`}
              className="text-[var(--color-accent)] hover:underline"
            >
              {t.customers.name}
            </Link>
          )}
          {safeHttpUrl(t.meeting_url) && (
            <a
              href={safeHttpUrl(t.meeting_url)!}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--color-accent)] hover:underline"
            >
              Meeting link
            </a>
          )}
        </div>
      </header>

      {t.summary && (
        <Section title="Summary">
          <p className="text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
            {t.summary}
          </p>
        </Section>
      )}

      {insightLists.map((list) => (
        <Section key={list.label} title={list.label}>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
            {list.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Section>
      ))}

      {attendees.length > 0 && (
        <Section title="Attendees">
          <div className="flex flex-wrap gap-2">
            {attendees.map((a, i) => (
              <span
                key={i}
                className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-2.5 py-1 text-[12px] text-[var(--color-fg-secondary)]"
              >
                {a}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Transcript">
        {t.transcript_text ? (
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-4 font-sans text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
            {t.transcript_text}
          </pre>
        ) : (
          <p className="text-[13px] text-[var(--color-fg-muted)]">
            {t.status && t.status !== "completed"
              ? "Scribe is still processing this meeting — the transcript will appear after the next sync."
              : "No transcript text was returned for this meeting."}
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function normalizeAttendees(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a
    .map((x) => {
      if (typeof x === "string") return x;
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      const name = typeof o.name === "string" ? o.name : null;
      const email =
        typeof o.email === "string"
          ? o.email
          : typeof o.address === "string"
            ? o.address
            : null;
      return name && email ? `${name} (${email})` : name || email || null;
    })
    .filter((x): x is string => !!x);
}

/** Pull the common Scribe insight arrays (decisions, action items, topics). */
function extractInsightLists(
  insights: unknown,
): Array<{ label: string; items: string[] }> {
  if (!insights || typeof insights !== "object") return [];
  const o = insights as Record<string, unknown>;
  const map: Array<{ keys: string[]; label: string }> = [
    { keys: ["action_items", "actionItems", "actions"], label: "Action items" },
    { keys: ["decisions"], label: "Decisions" },
    { keys: ["key_points", "keyPoints", "highlights"], label: "Key points" },
    { keys: ["topics"], label: "Topics" },
    { keys: ["questions"], label: "Questions" },
  ];
  const out: Array<{ label: string; items: string[] }> = [];
  for (const { keys, label } of map) {
    const raw = keys.map((k) => o[k]).find((v) => Array.isArray(v)) as unknown[] | undefined;
    if (!raw || raw.length === 0) continue;
    const items = raw
      .map((it) => {
        if (typeof it === "string") return it;
        const io = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
        return (
          (typeof io.text === "string" && io.text) ||
          (typeof io.title === "string" && io.title) ||
          (typeof io.description === "string" && io.description) ||
          null
        );
      })
      .filter((x): x is string => !!x);
    if (items.length) out.push({ label, items });
  }
  return out;
}

/** Only allow http(s) hrefs — meeting_url is synced from Scribe (external). */
function safeHttpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
