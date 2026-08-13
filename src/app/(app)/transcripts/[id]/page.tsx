import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Markdown } from "@/components/markdown";
import { LifecycleBadge } from "@/components/ui/badge";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
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
  const supabase = createSupabaseAdmin();

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
      <PageBreadcrumb
        pageTitle={t.title || "Untitled meeting"}
        trail={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Transcripts", href: "/transcripts" },
        ]}
      />

      <header className="-mt-3 mb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
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
              className="inline-flex items-center gap-1 text-brand-500 dark:text-brand-400 hover:underline"
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
              <ul className="list-disc space-y-1 pl-5 text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
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
                    className="rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2.5 py-1 text-theme-xs text-gray-500 dark:text-gray-400"
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
                  className="block text-theme-sm font-semibold text-brand-500 dark:text-brand-400 hover:underline"
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
              <p className="text-theme-sm text-gray-400 dark:text-gray-500">
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
                    <span className="font-medium text-gray-800 dark:text-white/90">{list.items.length}</span>
                  </Row>
                ))}
              </div>
            ) : (
              <p className="text-theme-sm text-gray-400 dark:text-gray-500">
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
      <h2 className="mb-2 text-theme-sm font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4">
      <h3 className="mb-3 text-theme-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-theme-sm">
      <span className="shrink-0 text-gray-400 dark:text-gray-500">{label}</span>
      <span className="min-w-0 truncate text-right text-gray-500 dark:text-gray-400">{children}</span>
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
