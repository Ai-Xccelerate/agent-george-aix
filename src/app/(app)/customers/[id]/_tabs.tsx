"use client";

import { useState, type ReactNode } from "react";
import {
  FileText,
  LayoutDashboard,
  ListChecks,
  Network,
  Repeat,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icons must be resolved inside this client module — Lucide components are
// classes-with-methods and can't be serialized across the server→client
// boundary. Server passes a string key; we map it here.
export type CustomerTabIcon =
  | "overview"
  | "onboarding"
  | "cadence"
  | "hierarchy"
  | "contacts"
  | "documents";

const ICONS: Record<CustomerTabIcon, LucideIcon> = {
  overview: LayoutDashboard,
  onboarding: ListChecks,
  cadence: Repeat,
  hierarchy: Network,
  contacts: Users,
  documents: FileText,
};

export type CustomerTabSpec = {
  id: string;
  label: string;
  icon: CustomerTabIcon;
  /** Optional small count / badge rendered next to the label. */
  badge?: string | number | null;
  panel: ReactNode;
};

export function CustomerTabs({
  tabs,
  defaultTab,
}: {
  tabs: CustomerTabSpec[];
  defaultTab?: string;
}) {
  const initial = tabs.find((t) => t.id === defaultTab)?.id ?? tabs[0]?.id;
  const [active, setActive] = useState<string | undefined>(initial);
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Customer sections"
        className="flex flex-wrap gap-1 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-1"
      >
        {tabs.map((t) => {
          const isActive = t.id === activeTab?.id;
          const Icon = ICONS[t.icon];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors",
                isActive
                  ? "bg-[var(--color-accent-light)] font-semibold text-[var(--color-accent)]"
                  : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]",
              )}
            >
              <Icon
                size={14}
                className={cn(
                  isActive
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-fg-muted)]",
                )}
              />
              <span>{t.label}</span>
              {t.badge != null && t.badge !== "" && (
                <span
                  className={cn(
                    "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium",
                    isActive
                      ? "bg-[var(--color-accent)] text-[var(--color-fg-inverse)]"
                      : "bg-[var(--color-surface-3)] text-[var(--color-fg-secondary)]",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${activeTab?.id}`}
        aria-labelledby={`tab-${activeTab?.id}`}
        className="space-y-5"
      >
        {activeTab?.panel}
      </div>
    </div>
  );
}
