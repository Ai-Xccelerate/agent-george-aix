"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckLineIcon } from "@/icons";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  options: Option[];
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Controlled value — when provided, the parent owns selection state. */
  value?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  /** "field" = bordered form control (default); "ghost" = borderless inline picker. */
  variant?: "field" | "ghost";
  disabled?: boolean;
}

// Custom listbox dropdown (no native <select>) so the menu is fully styled and
// consistent across the whole template — matches the design system, dark mode,
// and density. Keyboard-accessible: ↑/↓/Home/End move, Enter/Space select,
// Esc closes, outside-click dismisses; exposes combobox/listbox/option roles.
// Supports both controlled (`value`) and uncontrolled (`defaultValue`) usage.
const Select: React.FC<SelectProps> = ({
  options,
  placeholder = "Select an option",
  onChange,
  className = "",
  defaultValue = "",
  value,
  id,
  name,
  ariaLabel,
  size = "md",
  variant = "field",
  disabled = false,
}) => {
  const [internal, setInternal] = useState<string>(defaultValue);
  const current = value !== undefined ? value : internal;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const baseId = useId();
  const listId = `${baseId}-listbox`;
  // Memoised so the scroll-into-view effect below has a stable dependency.
  const optionId = useCallback(
    (i: number) => `${baseId}-option-${i}`,
    [baseId],
  );

  const selected = options.find((o) => o.value === current) ?? null;

  const sizeCls = size === "sm" ? "h-9 text-sm" : "h-11 text-sm";
  const padCls = variant === "ghost" ? "px-2.5" : size === "sm" ? "px-3" : "px-4";
  const variantCls =
    variant === "ghost"
      ? "border border-transparent bg-transparent hover:bg-gray-100 dark:hover:bg-white/[0.06]"
      : "border border-gray-300 bg-transparent shadow-theme-xs hover:border-gray-400 focus-visible:border-brand-300 focus-visible:ring-3 focus-visible:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600";

  const select = (v: string) => {
    if (value === undefined) setInternal(v);
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openMenu = () => {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === current);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open, optionId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[active];
      if (opt) select(opt.value);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ?? placeholder}
        aria-activedescendant={open ? optionId(active) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-lg text-left font-medium transition-colors duration-150 ease-out focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-60 ${sizeCls} ${padCls} ${variantCls} ${
          selected
            ? "text-gray-800 dark:text-white/90"
            : "text-gray-500 dark:text-gray-400"
        } ${className}`}
      >
        <span className="truncate font-normal">
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`shrink-0 text-gray-500 transition-transform duration-150 dark:text-gray-400 ${
            open ? "rotate-180" : ""
          } ${size === "sm" ? "size-4" : "size-5"}`}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4.79175 7.396L10.0001 12.6043L15.2084 7.396"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel ?? placeholder}
          className="glass-popover custom-scrollbar absolute left-0 z-40 mt-1.5 max-h-60 w-full min-w-[8rem] overflow-y-auto rounded-lg border border-gray-200 p-1 shadow-theme-lg dark:border-gray-800"
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === current;
            const isActive = i === active;
            return (
              <li
                key={opt.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(opt.value)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-100 ${
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/[0.12] dark:text-brand-400"
                    : isSelected
                    ? "text-brand-700 dark:text-brand-400"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && (
                  <CheckLineIcon
                    className={`size-4 shrink-0 ${
                      isActive
                        ? "text-brand-600 dark:text-brand-400"
                        : "text-brand-500"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default Select;
