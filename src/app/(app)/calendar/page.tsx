import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "@/lib/agent/agent-settings";
import { WeekGrid, type CalEvent } from "./_week-grid";

export const dynamic = "force-dynamic";

function dayKeyOf(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Calendar date `n` days after a YYYY-MM-DD string (noon-UTC anchored). */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function tzLabel(tz: string): string {
  return TIMEZONE_OPTIONS.find((o) => o.value === tz)?.label ?? tz;
}

function rangeLabel(startStr: string, endStr: string, tz: string): string {
  const fmt = (s: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(
      new Date(`${s}T12:00:00Z`),
    );
  return `${fmt(startStr)} – ${fmt(endStr)}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // Service-role client (identity/entitlement enforced upstream by
  // getCurrentUser → Clerk + Core /access); every query is org-scoped explicitly.
  const supabase = createSupabaseAdmin();
  const sp = await searchParams;
  const offset = Number.parseInt(sp.week ?? "0", 10) || 0;

  const { data: orgRow } = await supabase
    .from("orgs")
    .select("default_timezone")
    .eq("id", user.orgId)
    .maybeSingle();
  const tz = (orgRow?.default_timezone as string | null) ?? DEFAULT_TIMEZONE;

  // Monday of the target week, in the org timezone.
  const todayKey = dayKeyOf(Date.now(), tz);
  const dow = new Date(`${todayKey}T12:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  const mondayDelta = (dow === 0 ? -6 : 1 - dow) + offset * 7;
  const weekStartStr = addDays(todayKey, mondayDelta);
  const weekEndStr = addDays(weekStartStr, 6);
  const weekStartMs = Date.parse(`${weekStartStr}T12:00:00Z`);

  // Fetch a slightly wider UTC window; the grid places events into the 7 tz days.
  const from = new Date(weekStartMs - 86400000).toISOString();
  const to = new Date(weekStartMs + 8 * 86400000).toISOString();
  const { data } = await supabase
    .from("calendar_events")
    .select(
      "external_id, subject, start_at, end_at, location, online_meeting_url, web_link, is_all_day, is_cancelled, body_preview, organizer_name, organizer_address, attendees, response_status",
    )
    .eq("org_id", user.orgId)
    .gte("start_at", from)
    .lte("start_at", to)
    .order("start_at", { ascending: true })
    .limit(500);
  const events = (data ?? []) as CalEvent[];

  return (
    <div className="flex h-full min-h-0 w-full flex-col px-4 py-5 sm:px-6 md:px-8 md:py-6 2xl:px-12">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Calendar</h1>
          <p className="mt-0.5 text-sm text-[var(--color-fg-secondary)]">
            George&apos;s Microsoft 365 calendar — {tzLabel(tz)}. Change it in{" "}
            <Link href="/settings/agent" className="text-[var(--color-accent)] hover:underline">
              AIX George → identity
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-[13px] font-medium text-[var(--color-fg)]">
            {rangeLabel(weekStartStr, weekEndStr, tz)}
          </span>
          <Link
            href={`/calendar?week=${offset - 1}`}
            aria-label="Previous week"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            <ChevronLeft size={16} />
          </Link>
          <Link
            href="/calendar"
            className="inline-flex h-8 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-[13px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            Today
          </Link>
          <Link
            href={`/calendar?week=${offset + 1}`}
            aria-label="Next week"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            <ChevronRight size={16} />
          </Link>
        </div>
      </header>

      <WeekGrid events={events} tz={tz} weekStartMs={weekStartMs} />
    </div>
  );
}
