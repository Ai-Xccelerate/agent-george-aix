import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ExternalLink, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Markdown } from "@/components/markdown";
import { LifecycleBadge } from "@/components/ui/badge";
import { TranscriptPanel } from "./_transcript-panel";

export const dynamic = "force-dynamic";

type Customer = {
  name: string | null;
  lifecycle: string | null;
  industry: string | null;
  size: string | null;
};

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
  customers: Customer | null;
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
      "id, title, status, started_at, ended_at, duration_min, attendees, transcript_text, insights, summary, meeting_url, customer_id, customers(name, lifecycle, industry, size)",
    )
    .eq("org_id", user.orgId)
    .eq("id", id)
    .maybeSingle();
  const t = data as unknown as Transcript | null;
  if (!t) notFound();

  const attendees = normalizeAttendees(t.attendees);
  const insightLists = extractInsightLists(t.insights);
  const sentiment = extractScalar(t.insights, ["sentiment", "overall_sentiment", "mood", "tone"]);
  const meetingUrl = safeHttpUrl(t.meeting_url);

  return (
    <div className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
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
          {meetingUrl && (
            <a
              href={meetingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
            >
              <ExternalLink size={11} /> Meeting link
            </a>
          )}
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {/* Main column */}
        <div className="min-w-0 flex-1 space-y-6">
          {t.summary && (
            <Section title="Summary">
              <Markdown>{t.summary}</Markdown>
            </Section>
          )}

          {insightLists.map((list) => (
            <Section key={list.label} title={list.label}>
              <ul className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-[var(--color-fg-secondary)]">
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
            <TranscriptPanel text={t.transcript_text} title={t.title ?? "transcript"} status={t.status} />
          </Section>
        </div>

        {/* Intelligence sidebar */}
        <aside className="w-full shrink-0 space-y-4 lg:w-80">
          <Card title="Associated with">
            {t.customer_id && t.customers ? (
              <div className="space-y-2.5">
                <Link
                  href={`/customers/${t.customer_id}`}
                  className="block text-[14px] font-semibold text-[var(--color-accent)] hover:underline"
                >
                  {t.customers.name ?? "Customer"}
                </Link>
                {t.customers.lifecycle && (
                  <Row label="Stage">
                    <LifecycleBadge value={t.customers.lifecycle} />
                  </Row>
                )}
                {t.customers.industry && <Row label="Industry">{t.customers.industry}</Row>}
                {t.customers.size && <Row label="Size">{t.customers.size}</Row>}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--color-fg-muted)]">
                Not linked to a customer yet.
              </p>
            )}
          </Card>

          <Card title="At a glance">
            <div className="space-y-2">
              <Row label="Date">{formatWhen(t.started_at ?? t.ended_at)}</Row>
              {t.duration_min != null && <Row label="Duration">{t.duration_min} min</Row>}
              <Row label="Attendees">{attendees.length}</Row>
              {t.status && <Row label="Status">{t.status}</Row>}
              {sentiment && <Row label="Sentiment">{sentiment}</Row>}
            </div>
          </Card>

          <Card title="Meeting signals">
            {insightLists.length > 0 ? (
              <div className="space-y-2">
                {insightLists.map((list) => (
                  <Row key={list.label} label={list.label}>
                    <span className="font-medium text-[var(--color-fg)]">{list.items.length}</span>
                  </Row>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--color-fg-muted)]">
                No structured insights captured for this meeting.
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-4">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="shrink-0 text-[var(--color-fg-muted)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[var(--color-fg-secondary)]">{children}</span>
    </div>
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
    { keys: ["learnings"], label: "Learnings" },
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

/** Read a scalar string field from insights under any of the given keys. */
function extractScalar(insights: unknown, keys: string[]): string | null {
  if (!insights || typeof insights !== "object") return null;
  const o = insights as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
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
