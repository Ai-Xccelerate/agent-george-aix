"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutGrid, List as ListIcon, Target } from "lucide-react";
import { HealthBadge, LifecycleBadge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PartnerRow = {
  id: string;
  name: string;
  domain: string | null;
  kind: "partner" | "end_customer";
  lifecycle: string;
  parentName: string | null;
  industry: string | null;
  health: { band: string; score: number | null } | null;
  nextStep: string | null;
  openObjectives: number;
  updated_at: string;
};

// Onboarding pipeline stages, in flow order. Board columns + filter tabs use this.
const STAGES: Array<{ key: string; label: string }> = [
  { key: "prospect", label: "Prospect" },
  { key: "onboarding", label: "Onboarding" },
  { key: "active", label: "Active" },
  { key: "at_risk", label: "At risk" },
  { key: "churned", label: "Churned" },
];

export function PartnersView({ rows }: { rows: PartnerRow[] }) {
  const [view, setView] = useState<"list" | "board">("list");
  const [stage, setStage] = useState<string>("all");

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.lifecycle, (counts.get(r.lifecycle) ?? 0) + 1);

  const filtered =
    stage === "all" ? rows : rows.filter((r) => r.lifecycle === stage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Stage filter tabs */}
        <div className="flex flex-wrap gap-1">
          <StageTab active={stage === "all"} onClick={() => setStage("all")} label="All" count={rows.length} />
          {STAGES.filter((s) => (counts.get(s.key) ?? 0) > 0).map((s) => (
            <StageTab
              key={s.key}
              active={stage === s.key}
              onClick={() => setStage(s.key)}
              label={s.label}
              count={counts.get(s.key) ?? 0}
            />
          ))}
        </div>

        {/* List / Board toggle */}
        <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-0.5">
          <ToggleBtn active={view === "list"} onClick={() => setView("list")} icon={<ListIcon size={14} />} label="List" />
          <ToggleBtn active={view === "board"} onClick={() => setView("board")} icon={<LayoutGrid size={14} />} label="Board" />
        </div>
      </div>

      {view === "list" ? <ListView rows={filtered} /> : <BoardView rows={filtered} stage={stage} />}
    </div>
  );
}

function ListView({ rows }: { rows: PartnerRow[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
      <Table className="min-w-[760px] text-left text-sm">
        <TableHeader className="border-b border-gray-200 bg-gray-50 text-theme-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          <TableRow>
            <TableCell isHeader className="px-4 py-2.5 font-medium">Customer</TableCell>
            <TableCell isHeader className="px-4 py-2.5 font-medium">Stage</TableCell>
            <TableCell isHeader className="px-4 py-2.5 font-medium">Health</TableCell>
            <TableCell isHeader className="px-4 py-2.5 font-medium">Next step</TableCell>
            <TableCell isHeader className="px-4 py-2.5 text-right font-medium">Open</TableCell>
            <TableCell isHeader className="px-4 py-2.5 font-medium">Updated</TableCell>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((c) => (
            <TableRow
              key={c.id}
              className="transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
            >
              <TableCell className="px-4 py-3">
                <Link href={`/customers/${c.id}`} className="block">
                  <span className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400">
                    {c.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-theme-xs text-gray-400 dark:text-gray-500">
                    {c.parentName ? `under ${c.parentName}` : c.domain ?? ""}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="px-4 py-3"><LifecycleBadge value={c.lifecycle} /></TableCell>
              <TableCell className="px-4 py-3"><HealthCell health={c.health} /></TableCell>
              <TableCell className="px-4 py-3 text-gray-500 dark:text-gray-400">
                <span className="line-clamp-1">{c.nextStep ?? "—"}</span>
              </TableCell>
              <TableCell className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                {c.openObjectives || "—"}
              </TableCell>
              <TableCell className="px-4 py-3 text-gray-400 dark:text-gray-500">
                {timeAgo(c.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BoardView({ rows, stage }: { rows: PartnerRow[]; stage: string }) {
  const cols = stage === "all" ? STAGES : STAGES.filter((s) => s.key === stage);
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {cols.map((s) => {
        const items = rows.filter((r) => r.lifecycle === s.key);
        return (
          <div key={s.key} className="w-[260px] shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{s.label}</span>
              <span className="text-theme-xs text-gray-400 dark:text-gray-500">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-800 px-3 py-6 text-center text-theme-xs text-gray-400 dark:text-gray-500">
                  None
                </div>
              ) : (
                items.map((c) => <BoardCard key={c.id} row={c} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({ row: c }: { row: PartnerRow }) {
  return (
    <Link
      href={`/customers/${c.id}`}
      className="block rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-3 hover:border-gray-200 dark:hover:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{c.name}</span>
        <HealthDot band={c.health?.band ?? null} />
      </div>
      <div className="mt-0.5 truncate text-theme-xs text-gray-400 dark:text-gray-500">
        {c.parentName ? `under ${c.parentName}` : c.domain ?? "—"}
      </div>
      {c.nextStep && (
        <div className="mt-2 line-clamp-2 text-theme-xs text-gray-500 dark:text-gray-400">{c.nextStep}</div>
      )}
      {c.openObjectives > 0 && (
        <div className="mt-2 inline-flex items-center gap-1 text-theme-xs text-gray-400 dark:text-gray-500">
          <Target size={11} /> {c.openObjectives} open
        </div>
      )}
    </Link>
  );
}

function HealthCell({ health }: { health: PartnerRow["health"] }) {
  if (!health) return <span className="text-gray-400 dark:text-gray-500">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <HealthBadge band={health.band} />
      {health.score != null && (
        <span className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">{health.score}</span>
      )}
    </span>
  );
}

function HealthDot({ band }: { band: string | null }) {
  // "red" previously rendered in the brand orange, which made a failing account
  // indistinguishable from an accent and identical to "yellow" at a glance.
  const color =
    band === "green"
      ? "bg-success-500"
      : band === "yellow"
        ? "bg-warning-500"
        : band === "red"
          ? "bg-error-500"
          : "bg-gray-400 dark:bg-gray-500";
  return (
    <span
      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${color}`}
      aria-hidden
    />
  );
}

function StageTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-theme-sm transition-colors ${
        active
          ? "bg-brand-50 dark:bg-brand-500/15 font-semibold text-brand-500 dark:text-brand-400"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-white/90"
      }`}
    >
      {label}
      <span className={active ? "text-brand-500 dark:text-brand-400" : "text-gray-400 dark:text-gray-500"}>{count}</span>
    </button>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-theme-sm ${
        active
          ? "bg-gray-100 dark:bg-gray-800 font-medium text-gray-800 dark:text-white/90"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white/90"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Empty() {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-12 text-center text-theme-sm text-gray-400 dark:text-gray-500">
      No customers in this stage.
    </div>
  );
}

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
