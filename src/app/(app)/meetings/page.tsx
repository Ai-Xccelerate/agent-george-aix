import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CalendarDays, Repeat, Video } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type CadenceRow = {
  id: string;
  customer_id: string;
  frequency: string;
  channel: string;
  duration_min: number | null;
  next_meeting_at: string | null;
  last_met_at: string | null;
  customers: { name: string; customer_kind: string }[] | null;
};

export default async function MeetingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const supabase = createSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const cols =
    "id, customer_id, frequency, channel, duration_min, next_meeting_at, last_met_at, customers!inner(name, customer_kind)";

  const [upcomingRes, recentRes] = await Promise.all([
    supabase
      .from("cadences")
      .select(cols)
      .eq("customers.org_id", user.orgId)
      .eq("active", true)
      .not("next_meeting_at", "is", null)
      .gte("next_meeting_at", nowIso)
      .order("next_meeting_at", { ascending: true })
      .limit(100),
    supabase
      .from("cadences")
      .select(cols)
      .eq("customers.org_id", user.orgId)
      .not("last_met_at", "is", null)
      .order("last_met_at", { ascending: false })
      .limit(15),
  ]);

  const upcoming = (upcomingRes.data ?? []) as CadenceRow[];
  const recent = (recentRes.data ?? []) as CadenceRow[];

  // Split upcoming into this week vs later.
  const weekEnd = Date.now() + 7 * 86400000;
  const thisWeek = upcoming.filter((c) => new Date(c.next_meeting_at!).getTime() <= weekEnd);
  const later = upcoming.filter((c) => new Date(c.next_meeting_at!).getTime() > weekEnd);

  const hasAny = upcoming.length > 0 || recent.length > 0;

  return (
    <div className="w-full space-y-6 px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Meetings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Kickoffs and check-ins across your partners, from each account&apos;s cadence.
          George&apos;s note-taker (Scribe) joins and records — transcripts and the
          success-plan follow-ups land on each partner&apos;s account.
        </p>
      </header>

      {!hasAny ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Section title="This week" icon={<CalendarClock size={14} className="text-brand-500 dark:text-brand-400" />} count={thisWeek.length}>
              {thisWeek.length === 0 ? (
                <Empty text="Nothing scheduled in the next 7 days." />
              ) : (
                <ul className="space-y-2">{thisWeek.map((c) => <MeetingRow key={c.id} c={c} kind="upcoming" />)}</ul>
              )}
            </Section>

            {later.length > 0 && (
              <Section title="Later" icon={<CalendarDays size={14} className="text-brand-500 dark:text-brand-400" />} count={later.length}>
                <ul className="space-y-2">{later.map((c) => <MeetingRow key={c.id} c={c} kind="upcoming" />)}</ul>
              </Section>
            )}
          </div>

          <div>
            <Section title="Recently met" icon={<Repeat size={14} className="text-brand-500 dark:text-brand-400" />} count={recent.length}>
              {recent.length === 0 ? (
                <Empty text="No past meetings logged yet." />
              ) : (
                <ul className="space-y-2">{recent.map((c) => <MeetingRow key={c.id} c={c} kind="recent" />)}</ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingRow({ c, kind }: { c: CadenceRow; kind: "upcoming" | "recent" }) {
  const name = c.customers?.[0]?.name ?? "Unknown partner";
  const when = kind === "upcoming" ? c.next_meeting_at : c.last_met_at;
  return (
    <li>
      <Link
        href={`/customers/${c.customer_id}`}
        className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      >
        <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
          {when ? (
            <>
              <span className="text-theme-xs uppercase leading-none">{fmtMonth(when)}</span>
              <span className="text-base font-bold leading-tight">{fmtDay(when)}</span>
            </>
          ) : (
            <Video size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{name}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
            <span className="capitalize">{c.frequency.replace("_", " ")}</span>
            <span>· {channelLabel(c.channel)}</span>
            {c.duration_min ? <span>· {c.duration_min} min</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right text-theme-xs text-gray-500 dark:text-gray-400">
          {when ? fmtTime(when) : "—"}
          <div className="text-theme-xs text-gray-400 dark:text-gray-500">{when ? relative(when) : ""}</div>
        </div>
      </Link>
    </li>
  );
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
          {icon}
          {title}
        </h2>
        <span className="text-theme-xs text-gray-400 dark:text-gray-500">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-800 px-4 py-8 text-center text-theme-sm text-gray-400 dark:text-gray-500">
      {text}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <CalendarDays size={20} />
      </div>
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">No meetings scheduled</h2>
      <p className="max-w-[420px] text-sm text-gray-500 dark:text-gray-400">
        Set a cadence on a partner (in their account, or ask George) and upcoming
        check-ins show here. Scribe records each one and George drafts the recap.
      </p>
      <Link
        href="/customers"
        className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 py-2 text-sm font-medium text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      >
        Go to partners
      </Link>
    </div>
  );
}

function channelLabel(channel: string) {
  const map: Record<string, string> = {
    call: "Call",
    in_person: "In person",
    email: "Email",
    async: "Async",
  };
  return map[channel] ?? channel;
}

function fmtMonth(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short" });
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function relative(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  const future = ms >= 0;
  const days = Math.round(Math.abs(ms) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return future ? "tomorrow" : "yesterday";
  return future ? `in ${days}d` : `${days}d ago`;
}
