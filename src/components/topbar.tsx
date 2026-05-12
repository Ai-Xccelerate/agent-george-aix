"use client";

import { Bell, Moon, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function Topbar() {
  // Initialize from the actual <html class>, which the server set from the
  // george-theme cookie. No FOUC, no flicker.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !(dark ?? true);
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    // 1-year cookie so the choice sticks across visits.
    document.cookie = `george-theme=${next ? "dark" : "light"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-6">
      <div className="flex h-9 w-[300px] items-center gap-2 rounded-md bg-[var(--color-surface-2)] px-3.5">
        <Search size={16} className="text-[var(--color-fg-muted)]" />
        <input
          placeholder="Search customers, conversations, knowledge…"
          className="w-full bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] outline-none"
        />
      </div>

      <div className="flex items-center gap-1">
        <IconButton aria-label="Notifications">
          <Bell size={18} className="text-[var(--color-fg-muted)]" />
        </IconButton>
        <IconButton aria-label="Toggle theme" onClick={toggle}>
          {dark === false ? (
            <Moon size={18} className="text-[var(--color-fg-muted)]" />
          ) : (
            <Sun size={18} className="text-[var(--color-fg-muted)]" />
          )}
        </IconButton>
      </div>
    </header>
  );
}

function IconButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--color-surface-2)]"
    >
      {children}
    </button>
  );
}
