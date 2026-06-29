"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutGrid, List as ListIcon, Target } from "lucide-react";
import { HealthBadge, KindBadge, LifecycleBadge } from "@/components/ui/badge";

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
  const [kind, setKind] = useState<"all" | "partner" | "end_customer">("partner");

  // Kind filter applies first; stage tabs + their counts reflect the kind set.
  const kindFiltered = kind === "all" ? rows : rows.filter((r) => r.kind === kind);

  const counts = new Map<string, number>();
  for (const r of kindFiltered) counts.set(r.lifecycle, (counts.get(r.lifecycle) ?? 0) + 1);

  const filtered =
    stage === "all" ? kindFiltered : kindFiltered.filter((r) => r.lifecycle === stage);

  const partnerCount = rows.filter((r) => r.kind === "partner").length;
  const customerCount = rows.length - partnerCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Stage filter tabs */}
        <div className="flex flex-wrap gap-1">
          <StageTab active={stage === "all"} onClick={() => setStage("all")} label="All" count={kindFiltered.length} />
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

        <div className="flex items-center gap-2">
          {/* Partner / Customer filter — only when there are end customers */}
          {customerCount > 0 && (
            <div className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] p-0.5">
              <SegBtn active={kind === "partner"} onClick={() => setKind("partner")} label={`Partners ${partnerCount}`} />
              <SegBtn active={kind === "end_customer"} onClick={() => setKind("end_customer")} label={`Customers ${customerCount}`} />
              <SegBtn active={kind === "all"} onClick={() => setKind("all")} label="All" />
            </div>
          )}

          {/* List / Board toggle */}
          <div className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] p-0.5">
            <ToggleBtn active={view === "list"} onClick={() => setView("list")} icon={<ListIcon size={14} />} label="List" />
            <ToggleBtn active={view === "board"} onClick={() => setView("board")} icon={<LayoutGrid size={14} />} label="Board" />
          </div>
        </div>
      </div>

      {view === "list" ? <ListView rows={filtered} /> : <BoardView rows={filtered} stage={stage} />}
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[13px] ${
        active
          ? "bg-[var(--color-surface-3)] font-medium text-[var(--color-fg)]"
          : "text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
      }`}
    >
      {label}
    </button>
  );
}

function ListView({ rows }: { rows: PartnerRow[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-3)] text-[12px] uppercase tracking-wide text-[var(--color-fg-secondary)]">
          <tr>
            <th className="px-4 py-2.5 font-medium">Partner</th>
            <th className="px-4 py-2.5 font-medium">Stage</th>
            <th className="px-4 py-2.5 font-medium">Health</th>
            <th className="px-4 py-2.5 font-medium">Next step</th>
            <th className="px-4 py-2.5 text-right font-medium">Open</th>
            <th className="px-4 py-2.5 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.id}
              className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-3)]"
            >
              <td className="px-4 py-3">
                <Link href={`/customers/${c.id}`} className="block">
                  <span className="font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]">
                    {c.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
                    {c.kind === "end_customer" && <KindBadge kind={c.kind} />}
                    {c.parentName ? `under ${c.parentName}` : c.domain ?? ""}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3"><LifecycleBadge value={c.lifecycle} /></td>
              <td className="px-4 py-3"><HealthCell health={c.health} /></td>
              <td className="px-4 py-3 text-[var(--color-fg-secondary)]">
                <span className="line-clamp-1">{c.nextStep ?? "—"}</span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--color-fg-secondary)]">
                {c.openObjectives || "—"}
              </td>
              <td className="px-4 py-3 text-[var(--color-fg-muted)]">{timeAgo(c.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
              <span className="text-[13px] font-semibold text-[var(--color-fg)]">{s.label}</span>
              <span className="text-[12px] text-[var(--color-fg-muted)]">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--color-border-subtle)] px-3 py-6 text-center text-[12px] text-[var(--color-fg-muted)]">
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
      className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-3 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-[var(--color-fg)]">{c.name}</span>
        <HealthDot band={c.health?.band ?? null} />
      </div>
      <div className="mt-0.5 truncate text-[11px] text-[var(--color-fg-muted)]">
        {c.parentName ? `under ${c.parentName}` : c.domain ?? "—"}
      </div>
      {c.nextStep && (
        <div className="mt-2 line-clamp-2 text-[12px] text-[var(--color-fg-secondary)]">{c.nextStep}</div>
      )}
      {c.openObjectives > 0 && (
        <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-muted)]">
          <Target size={11} /> {c.openObjectives} open
        </div>
      )}
    </Link>
  );
}

function HealthCell({ health }: { health: PartnerRow["health"] }) {
  if (!health) return <span className="text-[var(--color-fg-muted)]">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <HealthBadge band={health.band} />
      {health.score != null && (
        <span className="text-[12px] tabular-nums text-[var(--color-fg-secondary)]">{health.score}</span>
      )}
    </span>
  );
}

function HealthDot({ band }: { band: string | null }) {
  const color =
    band === "green"
      ? "var(--color-success)"
      : band === "yellow"
        ? "var(--color-warning)"
        : band === "red"
          ? "var(--color-accent)"
          : "var(--color-fg-muted)";
  return (
    <span
      className="mt-1 h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
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
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? "bg-[var(--color-accent-light)] font-semibold text-[var(--color-accent)]"
          : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
      }`}
    >
      {label}
      <span className={active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]"}>{count}</span>
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
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[13px] ${
        active
          ? "bg-[var(--color-surface-3)] font-medium text-[var(--color-fg)]"
          : "text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Empty() {
  return (
    <div className="rounded-[12px] border border-dashed border-[var(--color-border-subtle)] px-4 py-12 text-center text-[13px] text-[var(--color-fg-muted)]">
      No partners in this stage.
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
