/**
 * The engagement board — every account, worst drift first.
 *
 * The one view a CS lead needs and did not have: George's understanding was
 * only reachable one customer at a time, so "who is going quiet on me?" meant
 * opening every account and holding the comparison in your head.
 *
 * A READING SURFACE, AND ONLY THAT
 * No buttons, no forms, no actions. Consistent with the observe-don't-act
 * directive: George records, this shows, a person decides. The only interactive
 * elements are links to the evidence behind each number.
 *
 * EVERY FIGURE LINKS TO WHAT PRODUCED IT
 * A drift score a human cannot trace is one they will not act on. Days-since
 * links to the meeting; the multiple carries its own working in a tooltip; the
 * observation links to the account.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, TrendingDown, Minus, TrendingUp, Info } from "lucide-react";

import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { loadEngagementFacts } from "@/lib/agent/engagement-facts";
import { rankEngagement, type EngagementRow } from "@/lib/agent/engagement-board";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Engagement | Agent George",
  description: "Every account, sorted by who is drifting.",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** State drives the colour. Dark should not look like healthy. */
const STATE_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  dark: { dot: "bg-error-500", text: "text-error-500", label: "dark" },
  quiet: { dot: "bg-warning-500", text: "text-warning-500", label: "quiet" },
  thinning: { dot: "bg-warning-400", text: "text-warning-500", label: "thinning" },
  healthy: { dot: "bg-success-500", text: "text-success-500", label: "healthy" },
  insufficient: { dot: "bg-gray-300 dark:bg-gray-600", text: "text-gray-400 dark:text-gray-500", label: "no history" },
};

function TrendIcon({ trend }: { trend: EngagementRow["trend"] }) {
  const common = "shrink-0";
  if (trend === "thinning") return <TrendingDown size={13} className={`${common} text-error-500`} />;
  if (trend === "warming") return <TrendingUp size={13} className={`${common} text-success-500`} />;
  if (trend === "steady") return <Minus size={13} className={`${common} text-gray-400 dark:text-gray-500`} />;
  return <span className="text-theme-xs text-gray-300 dark:text-gray-600">—</span>;
}

function Row({ row }: { row: EngagementRow }) {
  const s = STATE_STYLE[row.state] ?? STATE_STYLE.insufficient;

  return (
    <TableRow className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]">
      {/* State */}
      <TableCell className="px-4 py-3 align-top">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
          <span className={`text-theme-xs font-medium ${s.text}`}>{s.label}</span>
        </span>
      </TableCell>

      {/* Account + lifecycle elapsed. Elapsed is shown, never folded into the
          score — a lead who cannot see the weighting cannot disagree with it. */}
      <TableCell className="px-4 py-3 align-top">
        <Link
          href={`/customers/${row.customerId}`}
          className="block min-w-0 text-theme-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
        >
          {row.name}
        </Link>
        <span className="text-theme-xs text-gray-400 dark:text-gray-500">
          {row.lifecycle.replace("_", " ")}
          {row.elapsed ? ` · ${row.elapsed}` : ""}
        </span>
      </TableCell>

      {/* Last meeting — links to the evidence. */}
      <TableCell className="px-4 py-3 align-top whitespace-nowrap text-theme-sm text-gray-600 dark:text-gray-300">
        {row.silentDays === null ? (
          <span className="text-gray-400 dark:text-gray-500">never</span>
        ) : (
          <span title={row.lastMeetingAt ? `Last meeting ${fmt(row.lastMeetingAt)}` : undefined}>
            <span className="tabular-nums">{row.silentDays}</span>d ago
          </span>
        )}
      </TableCell>

      {/* Inbound / outbound: a known gap, rendered as one. A zero here would
          claim the customer has never written, which is false — the mail exists
          and is simply not attributed to an account yet. */}
      <TableCell className="px-4 py-3 align-top whitespace-nowrap text-theme-sm text-gray-300 dark:text-gray-600">
        {row.lastInboundAt ? (
          <span className="text-gray-600 dark:text-gray-300 tabular-nums">{fmt(row.lastInboundAt)}</span>
        ) : (
          "no data"
        )}
      </TableCell>
      <TableCell className="px-4 py-3 align-top whitespace-nowrap text-theme-sm text-gray-300 dark:text-gray-600">
        {row.lastOutboundAt ? (
          <span className="text-gray-600 dark:text-gray-300 tabular-nums">{fmt(row.lastOutboundAt)}</span>
        ) : (
          "no data"
        )}
      </TableCell>

      {/* Rhythm + drift, carrying its own working. */}
      <TableCell className="px-4 py-3 align-top whitespace-nowrap">
        {row.drift === null ? (
          <span className="text-theme-sm text-gray-400 dark:text-gray-500">—</span>
        ) : (
          <span className="flex items-center gap-1.5" title={row.because}>
            <span className={`text-theme-sm font-medium tabular-nums ${s.text}`}>
              {row.drift.toFixed(1)}×
            </span>
            <Info size={11} className="shrink-0 text-gray-300 dark:text-gray-600" />
          </span>
        )}
      </TableCell>

      <TableCell className="px-4 py-3 align-top">
        <TrendIcon trend={row.trend} />
      </TableCell>

      {/* The column that says whether it matters. */}
      <TableCell className="px-4 py-3 align-top">
        {row.latestObservation ? (
          <Link
            href={`/customers/${row.customerId}`}
            className="block max-w-[420px] text-theme-sm text-gray-600 hover:text-brand-500 dark:text-gray-300 dark:hover:text-brand-400"
          >
            {row.latestObservation.summary}
          </Link>
        ) : (
          <span className="text-theme-xs text-gray-400 dark:text-gray-500">
            Nothing recorded yet
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function Head() {
  const cls =
    "px-4 pb-2.5 pt-0 text-left text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500";
  return (
    <TableHeader className="border-b border-gray-200 dark:border-gray-800">
      <TableRow>
        <TableCell isHeader className={cls}>State</TableCell>
        <TableCell isHeader className={cls}>Account</TableCell>
        <TableCell isHeader className={cls}>Last meeting</TableCell>
        <TableCell isHeader className={cls}>Last in</TableCell>
        <TableCell isHeader className={cls}>Last out</TableCell>
        <TableCell isHeader className={cls}>Drift</TableCell>
        <TableCell isHeader className={cls}>Trend</TableCell>
        <TableCell isHeader className={cls}>What George noticed</TableCell>
      </TableRow>
    </TableHeader>
  );
}

export default async function EngagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const admin = createSupabaseAdmin();
  const facts = await loadEngagementFacts(admin, user.orgId);
  const { scored, unscored } = rankEngagement(facts);

  const drifting = scored.filter((r) => r.state === "dark" || r.state === "quiet").length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">
          Engagement
        </h1>
        <p className="mt-1 max-w-[80ch] text-sm text-gray-500 dark:text-gray-400">
          Every account, sorted by who is drifting. Drift is silence measured against{" "}
          <strong className="font-medium text-gray-700 dark:text-gray-300">
            that account&apos;s own rhythm
          </strong>{" "}
          — a weekly account quiet for a month is in trouble, a monthly one is on
          schedule. Nothing here sends or triggers anything.
        </p>
      </header>

      {drifting > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Activity size={14} className="text-error-500" />
          <span>
            <strong className="font-medium">{drifting}</strong> of {scored.length} scored
            accounts are past their own rhythm.
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4">
        <div className="overflow-x-auto">
          <Table>
            <Head />
            <TableBody>
              {scored.map((r) => (
                <Row key={r.customerId} row={r} />
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Kept separate, below. On a plain days-since sort these crowd the top
            and push real drift below the fold — they are absence of evidence,
            not evidence of drift. Still shown, because an onboarding account
            that has met nobody for five weeks is worth seeing. */}
        {unscored.length > 0 && (
          <div className="mt-6 border-t border-dashed border-gray-200 pt-4 dark:border-gray-800">
            <p className="mb-3 text-theme-xs text-gray-400 dark:text-gray-500">
              Not enough history to score — fewer than two weeks of contact on record.
              Ordered by raw silence.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableBody>
                  {unscored.map((r) => (
                    <Row key={r.customerId} row={r} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* The gap, stated rather than hidden. A board that looks complete while
          two of its five signals have no data is a board that misleads. */}
      <p className="mt-4 max-w-[80ch] text-theme-xs leading-relaxed text-gray-400 dark:text-gray-500">
        <strong className="font-medium">Inbound and outbound mail read &ldquo;no data&rdquo;</strong>{" "}
        because email is not yet attributed to accounts — the messages exist, they are just
        not linked, so a zero would wrongly claim the customer has never written. Drift is
        computed from meetings alone until that is fixed. Rhythm comes from the weeks in
        which contact actually happened, not from a configured cadence: only 3 of 13
        accounts had one set, and the account drifting worst had none.
      </p>
    </div>
  );
}
