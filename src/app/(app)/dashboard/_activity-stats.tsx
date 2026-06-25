"use client";

import { useState } from "react";
import { CalendarClock, Mail, Send, Target } from "lucide-react";

// George's activity, with a range toggle. The page hands us the raw event
// timestamps (last 90 days) once; we count within the selected window client-
// side so switching ranges is instant — no refetch.
type Props = {
  drafts: string[];
  sent: string[];
  meetings: string[];
  objectives: string[];
};

const PERIODS = [
  { key: "24h", label: "24h", ms: 86_400_000 },
  { key: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 days", ms: 30 * 86_400_000 },
  { key: "90d", label: "90 days", ms: 90 * 86_400_000 },
] as const;

export function ActivityStats({ drafts, sent, meetings, objectives }: Props) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("7d");
  const ms = PERIODS.find((p) => p.key === period)!.ms;
  const cutoff = Date.now() - ms;
  const within = (arr: string[]) =>
    arr.reduce((n, t) => (new Date(t).getTime() >= cutoff ? n + 1 : n), 0);

  return (
    <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-[var(--color-fg)]">George&apos;s activity</h2>
        <div className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded px-2.5 py-1 text-[12px] ${
                period === p.key
                  ? "bg-[var(--color-surface-3)] font-medium text-[var(--color-fg)]"
                  : "text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon={<Mail size={15} />} value={within(drafts)} label="Drafts written" />
        <Tile icon={<Send size={15} />} value={within(sent)} label="Emails sent" />
        <Tile icon={<CalendarClock size={15} />} value={within(meetings)} label="Meetings booked" />
        <Tile icon={<Target size={15} />} value={within(objectives)} label="Objectives met" />
      </div>
    </section>
  );
}

function Tile({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3.5">
      <div className="text-[var(--color-accent)]">{icon}</div>
      <div className="mt-2 text-[26px] font-bold leading-none text-[var(--color-fg)]">{value}</div>
      <div className="mt-1.5 text-[12px] text-[var(--color-fg-muted)]">{label}</div>
    </div>
  );
}
