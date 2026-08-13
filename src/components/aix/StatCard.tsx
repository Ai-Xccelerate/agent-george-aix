import React from "react";
import { ArrowDownIcon, ArrowUpIcon } from "@/icons";

interface StatCardProps {
  label: string;
  value: string;
  delta?: number; // percent; positive = up
  deltaLabel?: string; // e.g. "vs last month"
  icon?: React.ReactNode;
  invertDelta?: boolean; // for metrics where down = good (e.g. churn)
  trend?: number[]; // optional sparkline series (oldest → newest)
}

/** Lightweight inline sparkline — pure SVG, no chart lib (so no hover/resize
 *  cost). Inherits its color from the parent via currentColor. */
function Sparkline({ data }: { data: number[] }) {
  const w = 100;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="mt-3 h-8 w-full"
      aria-hidden="true"
    >
      <polygon
        points={`0,${h} ${pts.join(" ")} ${w},${h}`}
        fill="currentColor"
        fillOpacity="0.1"
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon,
  invertDelta = false,
  trend,
}: StatCardProps) {
  const isUp = delta !== undefined && delta >= 0;
  const isGood = invertDelta ? !isUp : isUp;
  const trendColor =
    delta === undefined
      ? "text-brand-500"
      : isGood
      ? "text-success-500"
      : "text-error-500";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 transition-colors duration-150 hover:border-gray-300 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-gray-700 md:p-6">
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-white/90">
          {icon}
        </div>
      )}
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="text-2xl font-bold tracking-tight text-gray-800 tabular-nums dark:text-white/90 md:text-3xl">
          {value}
        </div>
        {delta !== undefined && (
          <span
            className={`mb-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              isGood
                ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500"
                : "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500"
            }`}
          >
            {isUp ? (
              <ArrowUpIcon className="size-3" />
            ) : (
              <ArrowDownIcon className="size-3" />
            )}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      {deltaLabel && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {deltaLabel}
        </p>
      )}
      {trend && trend.length > 1 && (
        <div className={trendColor}>
          <Sparkline data={trend} />
        </div>
      )}
    </div>
  );
}
