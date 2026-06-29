import { redirect } from "next/navigation";
import { CalendarClock, MapPin, Video, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Event = {
  external_id: string;
  subject: string | null;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  online_meeting_url: string | null;
  is_all_day: boolean;
  is_cancelled: boolean;
  attendees: unknown;
};

export default async function CalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const supabase = await createSupabaseServer();

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(Date.now() + 60 * 86400000);

  const { data } = await supabase
    .from("calendar_events")
    .select(
      "external_id, subject, start_at, end_at, location, online_meeting_url, is_all_day, is_cancelled, attendees",
    )
    .eq("org_id", user.orgId)
    .gte("start_at", from.toISOString())
    .lte("start_at", to.toISOString())
    .order("start_at", { ascending: true })
    .limit(200);
  const events = (data ?? []) as Event[];

  // Group by calendar day.
  const byDay = new Map<string, Event[]>();
  for (const e of events) {
    if (!e.start_at) continue;
    const key = new Date(e.start_at).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const list = byDay.get(key);
    if (list) list.push(e);
    else byDay.set(key, [e]);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <header className="mb-5">
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Calendar</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          George&apos;s Microsoft 365 calendar — next 60 days, mirrored locally.
        </p>
      </header>

      {byDay.size === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <CalendarClock size={20} />
          </div>
          <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">No upcoming events</h2>
          <p className="max-w-[440px] text-sm text-[var(--color-fg-secondary)]">
            Events on George&apos;s calendar over the next 60 days will appear here once synced.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(byDay.entries()).map(([day, dayEvents]) => (
            <section key={day}>
              <h2 className="mb-2 text-[13px] font-semibold text-[var(--color-fg-secondary)]">{day}</h2>
              <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
                {dayEvents.map((e) => (
                  <EventRow key={e.external_id} e={e} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: Event }) {
  const attendeeCount = Array.isArray(e.attendees) ? e.attendees.length : 0;
  return (
    <li className="flex items-start gap-4 px-4 py-3">
      <div className="w-20 shrink-0 text-[12px] tabular-nums text-[var(--color-fg-secondary)]">
        {e.is_all_day ? "All day" : timeRange(e.start_at, e.end_at)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-[13px] font-medium ${
              e.is_cancelled ? "text-[var(--color-fg-muted)] line-through" : "text-[var(--color-fg)]"
            }`}
          >
            {e.subject || "(no title)"}
          </span>
          {e.online_meeting_url && <Video size={12} className="shrink-0 text-[var(--color-accent)]" />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-fg-muted)]">
          {e.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={10} /> {e.location}
            </span>
          )}
          {attendeeCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users size={10} /> {attendeeCount}
            </span>
          )}
          {e.online_meeting_url && (
            <a
              href={e.online_meeting_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--color-accent)] hover:underline"
            >
              Join
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function timeRange(start: string | null, end: string | null): string {
  if (!start) return "";
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const s = new Date(start).toLocaleTimeString(undefined, opts);
  if (!end) return s;
  return `${s}–${new Date(end).toLocaleTimeString(undefined, opts)}`;
}
