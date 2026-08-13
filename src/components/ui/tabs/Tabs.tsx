"use client";

import React, { useId, useRef, useState } from "react";

export interface TabItem {
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  items: TabItem[];
  variant?: "underline" | "pill";
}

export default function Tabs({ items, variant = "underline" }: TabsProps) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const tabId = (i: number) => `${baseId}-tab-${i}`;
  const panelId = (i: number) => `${baseId}-panel-${i}`;

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next = active;
    if (e.key === "ArrowRight") next = (active + 1) % items.length;
    else if (e.key === "ArrowLeft")
      next = (active - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const listClass =
    variant === "underline"
      ? "flex gap-1 border-b border-gray-200 dark:border-gray-800"
      : "inline-flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800";

  const tabClass = (i: number) => {
    const isActive = active === i;
    if (variant === "underline") {
      return `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
        isActive
          ? "border-brand-500 text-brand-700 dark:text-brand-400"
          : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      }`;
    }
    return `rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
      isActive
        ? "bg-white text-brand-700 shadow-theme-xs dark:bg-white/10 dark:text-brand-400"
        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    }`;
  };

  return (
    <div>
      <div role="tablist" className={listClass} onKeyDown={onKeyDown}>
        {items.map((item, i) => (
          <button
            key={item.label}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={tabId(i)}
            aria-selected={active === i}
            aria-controls={panelId(i)}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            className={tabClass(i)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, i) => (
        <div
          key={item.label}
          role="tabpanel"
          id={panelId(i)}
          aria-labelledby={tabId(i)}
          hidden={active !== i}
          tabIndex={0}
          className="pt-4 text-sm text-gray-600 focus-visible:outline-none dark:text-gray-300"
        >
          {active === i && item.content}
        </div>
      ))}
    </div>
  );
}
