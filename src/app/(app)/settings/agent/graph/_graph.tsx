"use client";

import { useMemo, useState } from "react";

export type GraphNode = {
  id: string; // concept path
  title: string;
  type: string;
  isCore: boolean;
};
export type GraphEdge = { from: string; to: string };

// Stable color per concept type — uses theme tokens via inline style fallbacks.
const TYPE_COLORS: Record<string, string> = {
  playbook: "#6D45F5",
  process: "#0EA5E9",
  reference: "#10B981",
  faq: "#F59E0B",
  decision: "#EC4899",
};
function colorFor(type: string): string {
  return TYPE_COLORS[type] ?? "#8B8B95";
}

export function KnowledgeGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const [active, setActive] = useState<string | null>(null);

  const W = 720;
  const H = 520;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) / 2 - 90;

  // Deterministic circular layout — core concepts first so they cluster.
  const positioned = useMemo(() => {
    const ordered = [...nodes].sort((a, b) => {
      if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    const n = ordered.length || 1;
    return ordered.map((node, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { ...node, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });
  }, [nodes, cx, cy, radius]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of positioned) m.set(p.id, { x: p.x, y: p.y });
    return m;
  }, [positioned]);

  const types = useMemo(
    () => Array.from(new Set(nodes.map((n) => n.type))).sort(),
    [nodes],
  );

  function isDimmed(id: string): boolean {
    if (!active) return false;
    if (id === active) return false;
    return !edges.some(
      (e) =>
        (e.from === active && e.to === id) || (e.to === active && e.from === id),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {types.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(t) }} />
            {t}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          style={{ maxWidth: W, display: "block", margin: "0 auto" }}
        >
          {/* edges */}
          {edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const lit = active && (e.from === active || e.to === active);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={lit ? "#6D45F5" : "#cfcfd6"}
                strokeWidth={lit ? 2 : 1}
                strokeOpacity={active && !lit ? 0.15 : 0.7}
              />
            );
          })}
          {/* nodes */}
          {positioned.map((node) => {
            const dim = isDimmed(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                style={{ cursor: "pointer", opacity: dim ? 0.3 : 1 }}
                onMouseEnter={() => setActive(node.id)}
                onMouseLeave={() => setActive(null)}
              >
                <circle
                  r={node.isCore ? 11 : 8}
                  fill={colorFor(node.type)}
                  stroke={active === node.id ? "#1a1a1f" : "#ffffff"}
                  strokeWidth={2}
                />
                <text
                  x={0}
                  y={node.isCore ? 26 : 22}
                  textAnchor="middle"
                  fontSize={11}
                  className="fill-gray-500 dark:fill-gray-400"
                  style={{ pointerEvents: "none" }}
                >
                  {truncate(node.title, 22)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-theme-xs text-gray-400 dark:text-gray-500">
        {nodes.length} concept{nodes.length === 1 ? "" : "s"} · {edges.length} link
        {edges.length === 1 ? "" : "s"}. Hover a concept to highlight its connections.
        Larger dots are core playbooks.
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
