"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Users, Video, X } from "lucide-react";

export type CalEvent = {
  external_id: string;
  subject: string | null;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  online_meeting_url: string | null;
  web_link: string | null;
  is_all_day: boolean;
  is_cancelled: boolean;
  body_preview: string | null;
  organizer_name: string | null;
  organizer_address: string | null;
  attendees: unknown;
  response_status: string | null;
};

const PX_PER_HOUR = 56;
const DAYS = 7;
// The full day is rendered so the timeline scrolls; it opens scrolled to 6am.
const DEFAULT_HOUR = 6;

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
  const [selected, setSelected] = useState<CalEvent | null>(null);

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

  // Open scrolled to 6am (or an hour before "now" when today is in view). The
  // sticky header shares the header's height, so hour*PX lands that hour right
  // below the pinned header.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showNow = columns.some((c) => c.key === todayKey);
    const startHour = showNow ? Math.max(0, Math.floor(nowMinutes / 60) - 1) : DEFAULT_HOUR;
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      {/* One scroll container: sticky header + all-day + timeline. Keeping the
          header inside the same scroller means its columns always match the
          body's width, so nothing drifts when the scrollbar appears. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-20 bg-[var(--color-surface-card)]">
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
                    <button
                      key={e.external_id}
                      type="button"
                      onClick={() => setSelected(e)}
                      className="block w-full truncate rounded bg-[var(--color-accent-light)] px-1.5 py-0.5 text-left text-[11px] text-[var(--color-accent)] hover:brightness-95"
                      title={e.subject ?? ""}
                    >
                      {e.subject || "(no title)"}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timeline */}
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
                        onOpen={setSelected}
                      />
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

      {selected && <EventModal e={selected} tz={tz} onClose={() => setSelected(null)} />}
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
  onOpen,
}: {
  e: CalEvent;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  start: number;
  end: number;
  onOpen: (e: CalEvent) => void;
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

  // Clicking opens the details panel (no longer jumps straight into Teams).
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      className={`${className} cursor-pointer text-left hover:brightness-95`}
      style={style}
      title={title}
    >
      {body}
    </button>
  );
}

/**
 * Only return a URL safe to use as an href. Meeting URLs come from synced Graph
 * data, so a malicious event could carry a javascript:/data:/vbscript: scheme —
 * reject anything but http(s) to prevent stored XSS on click.
 */
function safeHttpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
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

type Attendee = { name: string; address: string; response?: string; optional: boolean };

function parseAttendees(raw: unknown): Attendee[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    const ea = (o.emailAddress ?? {}) as Record<string, unknown>;
    const status = (o.status ?? {}) as Record<string, unknown>;
    const address = (ea.address as string) ?? "";
    return {
      name: (ea.name as string) || address || "—",
      address,
      response: (status.response as string) ?? undefined,
      optional: (o.type as string) === "optional",
    };
  });
}

function responseLabel(s: string | null): string | null {
  switch (s) {
    case "accepted":
      return "Accepted";
    case "tentativelyAccepted":
      return "Tentative";
    case "declined":
      return "Declined";
    case "organizer":
      return "You're organizing";
    case "notResponded":
    case "none":
      return "No response yet";
    default:
      return null;
  }
}

function EventModal({ e, tz, onClose }: { e: CalEvent; tz: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const joinUrl = safeHttpUrl(e.online_meeting_url);
  const webLink = safeHttpUrl(e.web_link);
  const isTeams = joinUrl ? /teams\.(microsoft|live)\.com/i.test(joinUrl) : false;
  const attendees = parseAttendees(e.attendees);
  const response = responseLabel(e.response_status);

  const dateLabel = e.start_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date(e.start_at))
    : "";
  const timeFmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  const timeLabel = e.is_all_day
    ? "All day"
    : e.start_at
      ? `${timeFmt(e.start_at)}${e.end_at ? ` – ${timeFmt(e.end_at)}` : ""}`
      : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-card)] shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">{e.subject || "(no title)"}</h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-fg-secondary)]">
              {dateLabel}
              {timeLabel ? ` · ${timeLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-[13px]">
          {response && (
            <span className="inline-flex items-center rounded-full bg-[var(--color-accent-light)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-accent)]">
              {response}
            </span>
          )}

          {/* Meeting link */}
          {joinUrl ? (
            <div className="flex items-center gap-2">
              <Video size={15} className="shrink-0 text-[var(--color-fg-muted)]" />
              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-fg-inverse)] hover:brightness-110"
              >
                {isTeams ? "Join Teams meeting" : "Join online meeting"}
              </a>
            </div>
          ) : (
            <p className="text-[var(--color-fg-muted)]">No online meeting link.</p>
          )}

          {e.location && (
            <div className="flex items-start gap-2">
              <MapPin size={15} className="mt-0.5 shrink-0 text-[var(--color-fg-muted)]" />
              <span className="text-[var(--color-fg)]">{e.location}</span>
            </div>
          )}

          {/* Organizer + participants */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-[var(--color-fg-secondary)]">
              <Users size={14} className="shrink-0" />
              Participants
            </div>
            <ul className="space-y-1">
              {(e.organizer_name || e.organizer_address) && (
                <li className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[var(--color-fg)]">
                    {e.organizer_name || e.organizer_address}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--color-fg-muted)]">Organizer</span>
                </li>
              )}
              {attendees.map((a) => (
                <li key={a.address || a.name} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[var(--color-fg)]">{a.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--color-fg-muted)]">
                    {responseLabel(a.response ?? null) ?? (a.optional ? "Optional" : "")}
                  </span>
                </li>
              ))}
              {attendees.length === 0 && !e.organizer_address && (
                <li className="text-[var(--color-fg-muted)]">No participants listed.</li>
              )}
            </ul>
          </div>

          {/* Agenda */}
          {e.body_preview && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-[var(--color-fg-secondary)]">Agenda</div>
              <p className="whitespace-pre-wrap text-[var(--color-fg)]">{e.body_preview}</p>
            </div>
          )}

          {webLink && (
            <a
              href={webLink}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block text-[12px] text-[var(--color-accent)] hover:underline"
            >
              Open in Outlook
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
