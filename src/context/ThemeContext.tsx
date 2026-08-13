"use client";

import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";

/**
 * Theme state, adapted from the AIX theme's ThemeContext to George's
 * server-rendered model.
 *
 * The template persists to localStorage and un-flashes with an inline
 * <script> in the root layout. George cannot do that — inline script
 * injection in layouts is blocked by a security hook — so the resolved
 * theme lives in a cookie that `src/app/layout.tsx` reads server-side and
 * stamps onto <html> before the document is sent. There is no flash because
 * the class is already correct in the HTML.
 *
 * Two cookies, deliberately:
 *   george-theme       resolved "light" | "dark"  — what the server reads
 *   george-theme-pref  "light" | "dark" | "system" — what the user chose
 *
 * The server only ever needs the resolved value, so keeping "system" in a
 * separate cookie means the server contract is unchanged from before.
 *
 * George is dark-first, unlike the template's light default.
 */

const THEME_COOKIE = "george-theme";
const PREF_COOKIE = "george-theme-pref";
const ONE_YEAR = 60 * 60 * 24 * 365;

type ThemeContextType = {
  /** Resolved theme actually applied to the document. */
  theme: Theme;
  /** User preference — "system" follows the OS setting live. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

function systemTheme(): Theme {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * The AIX token CSS keys off BOTH `.dark` and `[data-theme="dark"]`. Setting
 * only the class leaves a stale attribute whose palette keeps winning, so the
 * two must always move together.
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.setAttribute("data-theme", theme);
}

export const ThemeProvider: React.FC<{
  children: React.ReactNode;
  /** Resolved theme the server already stamped on <html>. */
  initialTheme: Theme;
  /** Preference cookie, read server-side alongside it. */
  initialPreference: ThemePreference;
}> = ({ children, initialTheme, initialPreference }) => {
  // Seeded from the server rather than discovered in a mount effect: the root
  // layout reads both cookies anyway, so passing them down means the first
  // client render already agrees with the markup — no hydration mismatch, no
  // extra render pass, and no setState-in-effect on mount.
  const [preference, setPreferenceState] =
    useState<ThemePreference>(initialPreference);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Follow the OS while the preference is "system". Subscribing to an external
  // store is exactly what an effect is for; the initial resolve happens in the
  // setPreference handler instead of synchronously here.
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) =>
      setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  // Push the resolved theme to the document + cookie.
  useEffect(() => {
    applyTheme(theme);
    writeCookie(THEME_COOKIE, theme);
    writeCookie(PREF_COOKIE, preference);
  }, [theme, preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    // Resolve immediately here so "system" applies on click rather than waiting
    // for the media-query listener's first change event.
    setTheme(next === "system" ? systemTheme() : next);
  }, []);

  const toggleTheme = useCallback(() => {
    // The header toggle always lands on an explicit theme, leaving "system".
    setPreference(theme === "light" ? "dark" : "light");
  }, [theme, setPreference]);

  return (
    <ThemeContext.Provider
      value={{ theme, preference, setPreference, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
