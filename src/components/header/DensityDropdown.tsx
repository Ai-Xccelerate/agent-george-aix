"use client";
import React, { useState } from "react";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { useDensity, type Density } from "@/context/DensityContext";

const OPTIONS: { value: Density; label: string; description: string }[] = [
  { value: "default", label: "Default", description: "Roomy, easy scanning" },
  {
    value: "comfortable",
    label: "Comfortable",
    description: "Slightly tighter spacing",
  },
  { value: "compact", label: "Compact", description: "Most rows on screen" },
];

export default function DensityDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const { density, setDensity } = useDensity();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Display density"
        title="Display density"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="dropdown-toggle relative flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className="w-60 p-2"
      >
        <p className="px-3 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Density
        </p>
        <ul role="menu">
          {OPTIONS.map((option) => {
            const selected = density === option.value;
            return (
              <li key={option.value} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setDensity(option.value);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-500/50 dark:hover:bg-white/[0.03]"
                >
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? "border-brand-500"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {selected && (
                      <span className="size-2 rounded-full bg-brand-500" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-medium ${
                        selected
                          ? "text-gray-800 dark:text-white/90"
                          : "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {option.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {option.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dropdown>
    </div>
  );
}
