"use client";

import { useState } from "react";
import ButtonGroup from "@/components/ui/button-group/ButtonGroup";
import StatCard from "@/components/aix/StatCard";
import { CalenderIcon, MailIcon, PaperPlaneIcon, TaskIcon } from "@/icons";

// George's activity, with a range toggle. The page hands us the raw event
// timestamps (last 90 days) once; we count within the selected window client-
// side so switching ranges is instant — no refetch.
type Props = {
  drafts: string[];
  sent: string[];
  meetings: string[];
  objectives: string[];
  /** Reference instant, sampled once on the server. Calling Date.now() here
   *  instead would make every render non-deterministic — the counts would
   *  drift between renders for events sitting on a window boundary. */
  now: number;
};

const PERIODS = [
  { key: "24h", label: "24h", ms: 86_400_000 },
  { key: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 days", ms: 30 * 86_400_000 },
  { key: "90d", label: "90 days", ms: 90 * 86_400_000 },
] as const;

export function ActivityStats({ drafts, sent, meetings, objectives, now }: Props) {
  const [periodIndex, setPeriodIndex] = useState(1); // 7d
  const ms = PERIODS[periodIndex].ms;
  const cutoff = now - ms;
  const within = (arr: string[]) =>
    arr.reduce((n, t) => (new Date(t).getTime() >= cutoff ? n + 1 : n), 0);

  const periodLabel = `last ${PERIODS[periodIndex].label}`;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          George&apos;s activity
        </h2>
        <ButtonGroup
          size="sm"
          items={PERIODS.map((p) => ({ label: p.label }))}
          activeIndex={periodIndex}
          onChange={setPeriodIndex}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 xl:grid-cols-4">
        <StatCard
          icon={<MailIcon />}
          label="Drafts written"
          value={within(drafts).toLocaleString()}
          deltaLabel={periodLabel}
        />
        <StatCard
          icon={<PaperPlaneIcon />}
          label="Emails sent"
          value={within(sent).toLocaleString()}
          deltaLabel={periodLabel}
        />
        <StatCard
          icon={<CalenderIcon />}
          label="Meetings booked"
          value={within(meetings).toLocaleString()}
          deltaLabel={periodLabel}
        />
        <StatCard
          icon={<TaskIcon />}
          label="Objectives met"
          value={within(objectives).toLocaleString()}
          deltaLabel={periodLabel}
        />
      </div>
    </section>
  );
}
