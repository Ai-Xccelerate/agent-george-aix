"use client";

import { useEffect, useRef } from "react";
import { MapPin, Video } from "lucide-react";

export type CalEvent = {
  external_id: string;
  subject: string | null;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  online_meeting_url: string | null;
  is_all_day: boolean;
  is_cancelled: boolean;
};

const PX_PER_HOUR = 48;
const DAYS = 7;

function partsInTz(iso: string, tz: string): { dayKey: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return { dayKey: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + Number(p.minute) };
}

function dayKeyOf(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function WeekGrid({
  events,
  tz,
  weekStartMs,
}: {
  events: CalEvent[];
  tz: string;
  weekStartMs: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const todayKey = dayKeyOf(Date.now(), tz);
  const nowMinutes = partsInTz(new Date().toISOString(), tz).minutes;

  const columns = Array.from({ length: DAYS }, (_, i) => {
    const ms = weekStartMs + i * 86400000;
    return {
      key: dayKeyOf(ms, tz),
      weekday: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
        new Date(ms),
      ),
      label: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(
        new Date(ms),
      ),
    };
  });
  const colIndex = new Map(columns.map((c, i) => [c.key, i]));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showNow = columns.some((c) => c.key === todayKey);
    const startHour = showNow ? Math.max(0, Math.floor(nowMinutes / 60) - 1) : 7;
    el.scrollTop = startHour * PX_PER_HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartMs]);

  type Placed = { e: CalEvent; col: number; start: number; end: number; lane: number; lanes: number };
  const timed: Placed[] = [];
  const allDayByCol: CalEvent[][] = columns.map(() => []);

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
    const end = ep.dayKey === sp.dayKey ? Math.max(ep.minutes, sp.minutes + 15) : 24 * 60;
    timed.push({ e, col, start: sp.minutes, end, lane: 0, lanes: 1 });
  }

  // Per-day overlap lanes so concurrent meetings sit side-by-side.
  for (let c = 0; c < DAYS; c++) {
    const day = timed.filter((t) => t.col === c).sort((a, b) => a.start - b.start);
    const laneEnds: number[] = [];
    for (const ev of day) {
      let lane = laneEnds.findIndex((end) => end <= ev.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(ev.end);
      } else {
        laneEnds[lane] = ev.end;
      }
      ev.lane = lane;
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const ev of day) ev.lanes = lanes;
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const hasAllDay = allDayByCol.some((l) => l.length > 0);
  const gridCols: React.CSSProperties = { gridTemplateColumns: `56px repeat(${DAYS}, 1fr)` };

  return (
    <div className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      {/* Day headers */}
      <div className="grid border-b border-[var(--color-border)]" style={gridCols}>
        <div className="border-r border-[var(--color-border-subtle)]" />
        {columns.map((c) => {
          const isToday = c.key === todayKey;
          return (
            <div
              key={c.key}
              className="border-r border-[var(--color-border-subtle)] px-2 py-2 text-center last:border-r-0"
            >
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                {c.weekday}
              </div>
              <div
                className={`text-[13px] font-semibold ${
                  isToday ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"
                }`}
              >
                {c.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day band */}
      {hasAllDay && (
        <div className="grid border-b border-[var(--color-border-subtle)]" style={gridCols}>
          <div className="border-r border-[var(--color-border-subtle)] px-2 py-1.5 text-right text-[10px] uppercase tracking-wide text-[var(--color-fg-muted)]">
            All day
          </div>
          {columns.map((c, i) => (
            <div key={c.key} className="space-y-1 border-r border-[var(--color-border-subtle)] p-1 last:border-r-0">
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

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="max-h-[calc(100vh-240px)] overflow-y-auto">
        <div className="grid" style={gridCols}>
          {/* Hour gutter */}
          <div className="border-r border-[var(--color-border-subtle)]">
            {hours.map((h) => (
              <div
                key={h}
                className="relative pr-2 text-right text-[10px] text-[var(--color-fg-muted)]"
                style={{ height: PX_PER_HOUR }}
              >
                <span className="absolute -top-1.5 right-2">{hourLabel(h)}</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {columns.map((c, ci) => {
            const isToday = c.key === todayKey;
            return (
              <div
                key={c.key}
                className="relative border-r border-[var(--color-border-subtle)] last:border-r-0"
                style={{ height: 24 * PX_PER_HOUR }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-b border-[var(--color-border-subtle)]"
                    style={{ height: PX_PER_HOUR }}
                  />
                ))}

                {isToday && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-[var(--color-error)]"
                    style={{ top: (nowMinutes / 60) * PX_PER_HOUR }}
                  >
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[var(--color-error)]" />
                  </div>
                )}

                {timed
                  .filter((t) => t.col === ci)
                  .map((t) => {
                    const top = (t.start / 60) * PX_PER_HOUR;
                    const height = Math.max(16, ((t.end - t.start) / 60) * PX_PER_HOUR - 2);
                    return (
                      <EventBlock
                        key={t.e.external_id}
                        e={t.e}
                        top={top}
                        height={height}
                        leftPct={(t.lane / t.lanes) * 100}
                        widthPct={100 / t.lanes}
                        start={t.start}
                        end={t.end}
                      />
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
  e: CalEvent;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  start: number;
  end: number;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1 font-medium">
        {e.online_meeting_url && <Video size={9} className="shrink-0" />}
        <span className="truncate">{e.subject || "(no title)"}</span>
      </div>
      <div className="text-[10px] opacity-80">{minutesLabel(start)}</div>
      {e.location && height > 42 && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-70">
          <MapPin size={8} className="shrink-0" />
          <span className="truncate">{e.location}</span>
        </div>
      )}
    </>
  );
  const className = `absolute overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight ${
    e.is_cancelled
      ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] line-through"
      : "border-[var(--color-accent)]/30 bg-[var(--color-accent-light)] text-[var(--color-accent)]"
  }`;
  const style: React.CSSProperties = {
    top,
    height,
    left: `calc(${leftPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
  };
  const title = `${e.subject ?? "(no title)"} · ${minutesLabel(start)}–${minutesLabel(end)}`;

  if (e.online_meeting_url) {
    return (
      <a href={e.online_meeting_url} target="_blank" rel="noreferrer noopener" className={className} style={style} title={title}>
        {body}
      </a>
    );
  }
  return (
    <div className={className} style={style} title={title}>
      {body}
    </div>
  );
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
