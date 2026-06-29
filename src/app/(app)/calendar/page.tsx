import { redirect } from "next/navigation";
import { MapPin, Video } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "@/lib/agent/agent-settings";

export const dynamic = "force-dynamic";

const DAY_COUNT = 5;
const PX_PER_HOUR = 52;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;

type Event = {
  external_id: string;
  subject: string | null;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  online_meeting_url: string | null;
  is_all_day: boolean;
  is_cancelled: boolean;
};

type TzParts = { dayKey: string; minutes: number };

/** Date components of an instant, rendered in a specific IANA timezone. */
function partsInTz(iso: string, tz: string): TzParts {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return { dayKey: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + Number(p.minute) };
}

function dayColumns(tz: string): { key: string; weekday: string; label: string }[] {
  const cols: { key: string; weekday: string; label: string }[] = [];
  const now = Date.now();
  for (let i = 0; i < DAY_COUNT; i++) {
    const d = new Date(now + i * 86400000);
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
    }).format(d);
    cols.push({ key, weekday, label });
  }
  return cols;
}

function tzLabel(tz: string): string {
  return TIMEZONE_OPTIONS.find((o) => o.value === tz)?.label ?? tz;
}

export default async function CalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const supabase = await createSupabaseServer();

  const { data: orgRow } = await supabase
    .from("orgs")
    .select("default_timezone")
    .eq("id", user.orgId)
    .maybeSingle();
  const tz = (orgRow?.default_timezone as string | null) ?? DEFAULT_TIMEZONE;

  // Wide window (yesterday → +6d) so tz-local day boundaries are fully covered;
  // we place events into the 5 day columns by their timezone day key.
  const from = new Date(Date.now() - 86400000).toISOString();
  const to = new Date(Date.now() + (DAY_COUNT + 1) * 86400000).toISOString();
  const { data } = await supabase
    .from("calendar_events")
    .select(
      "external_id, subject, start_at, end_at, location, online_meeting_url, is_all_day, is_cancelled",
    )
    .eq("org_id", user.orgId)
    .gte("start_at", from)
    .lte("start_at", to)
    .order("start_at", { ascending: true })
    .limit(300);
  const events = (data ?? []) as Event[];

  const columns = dayColumns(tz);
  const colIndex = new Map(columns.map((c, i) => [c.key, i]));

  // Split timed vs all-day, placed into their column. Compute the hour window
  // to fit the day's events (clamped to a sensible default range).
  type Placed = { e: Event; col: number; start: number; end: number };
  const timed: Placed[] = [];
  const allDayByCol: Event[][] = columns.map(() => []);
  let minHour = DEFAULT_START_HOUR;
  let maxHour = DEFAULT_END_HOUR;

  for (const e of events) {
    if (!e.start_at) continue;
    const sp = partsInTz(e.start_at, tz);
    const col = colIndex.get(sp.dayKey);
    if (col === undefined) continue;
    if (e.is_all_day) {
      allDayByCol[col].push(e);
      continue;
    }
    const ep = e.end_at ? partsInTz(e.end_at, tz) : { dayKey: sp.dayKey, minutes: sp.minutes + 30 };
    // Clamp end to same-day if it rolls past midnight.
    const endMin = ep.dayKey === sp.dayKey ? Math.max(ep.minutes, sp.minutes + 15) : 24 * 60;
    timed.push({ e, col, start: sp.minutes, end: endMin });
    minHour = Math.min(minHour, Math.floor(sp.minutes / 60));
    maxHour = Math.max(maxHour, Math.ceil(endMin / 60));
  }
  minHour = Math.max(0, minHour);
  maxHour = Math.min(24, maxHour);
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
  const gridHeight = (maxHour - minHour) * PX_PER_HOUR;

  // Per-day lane assignment so overlapping events sit side-by-side.
  const lanesByCol: number[] = columns.map(() => 1);
  const laneOf = new Map<Placed, number>();
  for (let c = 0; c < columns.length; c++) {
    const dayEvents = timed.filter((t) => t.col === c).sort((a, b) => a.start - b.start);
    const laneEnds: number[] = [];
    for (const ev of dayEvents) {
      let lane = laneEnds.findIndex((end) => end <= ev.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(ev.end);
      } else {
        laneEnds[lane] = ev.end;
      }
      laneOf.set(ev, lane);
    }
    lanesByCol[c] = Math.max(1, laneEnds.length);
  }

  const hasAllDay = allDayByCol.some((list) => list.length > 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <header className="mb-5">
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Calendar</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          George&apos;s Microsoft 365 calendar — 5-day view, {tzLabel(tz)}. Change the
          timezone in{" "}
          <a href="/settings/agent" className="text-[var(--color-accent)] hover:underline">
            Agent George → identity
          </a>
          .
        </p>
      </header>

      <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
        <div className="min-w-[760px]">
          {/* Day headers */}
          <div className="grid border-b border-[var(--color-border)]" style={gridCols()}>
            <div className="border-r border-[var(--color-border-subtle)]" />
            {columns.map((c) => (
              <div
                key={c.key}
                className="border-r border-[var(--color-border-subtle)] px-2 py-2 text-center last:border-r-0"
              >
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                  {c.weekday}
                </div>
                <div className="text-[13px] font-semibold text-[var(--color-fg)]">{c.label}</div>
              </div>
            ))}
          </div>

          {/* All-day row */}
          {hasAllDay && (
            <div className="grid border-b border-[var(--color-border-subtle)]" style={gridCols()}>
              <div className="border-r border-[var(--color-border-subtle)] px-2 py-1.5 text-right text-[10px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                All day
              </div>
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className="space-y-1 border-r border-[var(--color-border-subtle)] p-1 last:border-r-0"
                >
                  {allDayByCol[i].map((e) => (
                    <div
                      key={e.external_id}
                      className="truncate rounded bg-[var(--color-accent-light)] px-1.5 py-0.5 text-[11px] text-[var(--color-accent)]"
                      title={e.subject ?? ""}
                    >
                      {e.subject || "(no title)"}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Time grid */}
          <div className="grid" style={gridCols()}>
            {/* Hour labels */}
            <div className="border-r border-[var(--color-border-subtle)]">
              {hours.map((h) => (
                <div
                  key={h}
                  className="relative border-b border-[var(--color-border-subtle)] pr-2 text-right text-[10px] text-[var(--color-fg-muted)]"
                  style={{ height: PX_PER_HOUR }}
                >
                  <span className="absolute -top-1.5 right-2">{hourLabel(h)}</span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {columns.map((c, ci) => (
              <div
                key={c.key}
                className="relative border-r border-[var(--color-border-subtle)] last:border-r-0"
                style={{ height: gridHeight }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-b border-[var(--color-border-subtle)]"
                    style={{ height: PX_PER_HOUR }}
                  />
                ))}
                {timed
                  .filter((t) => t.col === ci)
                  .map((t) => {
                    const lane = laneOf.get(t) ?? 0;
                    const lanes = lanesByCol[ci];
                    const top = ((t.start - minHour * 60) / 60) * PX_PER_HOUR;
                    const height = Math.max(18, ((t.end - t.start) / 60) * PX_PER_HOUR - 2);
                    return (
                      <EventBlock
                        key={t.e.external_id}
                        e={t.e}
                        top={top}
                        height={height}
                        leftPct={(lane / lanes) * 100}
                        widthPct={100 / lanes}
                        start={t.start}
                        end={t.end}
                      />
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {events.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-fg-muted)]">
          No events on George&apos;s calendar in this window yet.
        </p>
      )}
    </div>
  );
}

function gridCols(): React.CSSProperties {
  return { gridTemplateColumns: `56px repeat(${DAY_COUNT}, 1fr)` };
}

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h < 12 ? "a" : "p";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`;
}

function EventBlock({
  e,
  top,
  height,
  leftPct,
  widthPct,
  start,
  end,
}: {
  e: Event;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  start: number;
  end: number;
}) {
  return (
    <div
      className={`absolute overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight ${
        e.is_cancelled
          ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] line-through"
          : "border-[var(--color-accent)]/30 bg-[var(--color-accent-light)] text-[var(--color-accent)]"
      }`}
      style={{ top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
      title={`${e.subject ?? "(no title)"} · ${minutesLabel(start)}–${minutesLabel(end)}`}
    >
      <div className="flex items-center gap-1 font-medium">
        {e.online_meeting_url && <Video size={9} className="shrink-0" />}
        <span className="truncate">{e.subject || "(no title)"}</span>
      </div>
      <div className="text-[10px] opacity-80">{minutesLabel(start)}</div>
      {e.location && height > 44 && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-70">
          <MapPin size={8} className="shrink-0" />
          <span className="truncate">{e.location}</span>
        </div>
      )}
    </div>
  );
}
