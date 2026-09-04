"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import {
  BoltIcon,
  GridIcon,
  ListIcon,
  PlugInIcon,
  TaskIcon,
  UserCircleIcon,
} from "@/icons";

interface Command {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  /** Right-aligned meta shown on the row (e.g. "12 unread"). */
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-gray-200 bg-white px-1.5 py-px font-mono text-[10px] leading-[14px] text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
      {children}
    </kbd>
  );
}

/** Global ⌘K command palette — fuzzy navigation + quick actions. */
export default function CommandPalette() {
  const router = useRouter();
  const { setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { listening, supported, toggle } = useVoiceInput((text) => {
    setQuery((prev) => (prev ? prev + " " : "") + text);
    inputRef.current?.focus();
  });

  const close = useCallback(() => setOpen(false), []);

  // Opening always starts from a clean query and the first row selected.
  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      router.push(path);
      setOpen(false);
    };
    const nav = (
      icon: React.ReactNode,
      group: string,
      items: { label: string; path: string; keywords?: string; hint?: string }[]
    ) =>
      items.map((it) => ({
        id: group + ":" + it.path,
        label: it.label,
        group,
        keywords: it.keywords,
        hint: it.hint,
        icon,
        run: go(it.path),
      }));

    // George's real routes. The AIX theme's demo destinations (e-commerce, AI
    // generators, the other agents' dashboards) are not carried over — every
    // entry here resolves to a page George actually serves.
    return [
      ...nav(<GridIcon />, "Workspace", [
        { label: "Go to Dashboard", path: "/dashboard", keywords: "home overview health" },
        { label: "Go to Customers", path: "/customers", keywords: "accounts partners" },
      ]),
      ...nav(<TaskIcon />, "Channels", [
        { label: "Go to Mailbox", path: "/mailbox", keywords: "email messages outlook" },
        { label: "Go to Calendar", path: "/calendar", keywords: "events schedule meetings" },
        { label: "Go to Meetings", path: "/meetings", keywords: "calls agenda" },
        { label: "Go to Transcripts", path: "/transcripts", keywords: "calls scribe fireflies" },
      ]),
      ...nav(<UserCircleIcon />, "Account", [
        { label: "Go to Settings", path: "/settings", keywords: "preferences theme density" },
        { label: "Go to Profile", path: "/settings/profile" },
        { label: "Go to Organisation", path: "/settings/organization", keywords: "org company" },
        { label: "Go to Users", path: "/settings/users", keywords: "team invite members roles" },
        { label: "Go to Integrations", path: "/settings/integrations", keywords: "connect composio outlook" },
        { label: "Go to Knowledge", path: "/settings/knowledge", keywords: "docs playbook parchment" },
        { label: "Go to Agent settings", path: "/settings/agent", keywords: "policy domains persona" },
        { label: "Go to Help & docs", path: "/help", keywords: "support faq" },
      ]),
      {
        id: "action:new-chat",
        label: "Start a new chat with George",
        group: "Actions",
        keywords: "ask question new conversation",
        icon: <BoltIcon />,
        // Opens the bubble rather than navigating. There is no chat page to
        // navigate to any more, and the bubble creates the session lazily on
        // open — so this is the same "start talking to George" the label
        // promises, without a redirect in the middle of it.
        run: () => {
          window.dispatchEvent(new CustomEvent("george:open-session"));
          setOpen(false);
        },
      },
      {
        id: "action:integrations",
        label: "Connect an integration",
        group: "Actions",
        keywords: "composio outlook calendar fireflies onedrive",
        icon: <PlugInIcon />,
        run: () => {
          router.push("/settings/integrations");
          setOpen(false);
        },
      },
      {
        id: "action:add-knowledge",
        label: "Add a knowledge document",
        group: "Actions",
        keywords: "upload playbook docs",
        icon: <ListIcon />,
        run: () => {
          router.push("/settings/knowledge/new");
          setOpen(false);
        },
      },
      // Theme
      {
        id: "theme:light",
        label: "Switch to light mode",
        group: "Theme",
        keywords: "theme appearance day",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
            <path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7 17 17M7 7 5.3 5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        ),
        run: () => {
          setPreference("light");
          setOpen(false);
        },
      },
      {
        id: "theme:dark",
        label: "Switch to dark mode",
        group: "Theme",
        keywords: "theme appearance night",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        ),
        run: () => {
          setPreference("dark");
          setOpen(false);
        },
      },
      {
        id: "theme:system",
        label: "Use system theme",
        group: "Theme",
        keywords: "theme appearance auto os",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="4.5" width="18" height="12.5" rx="2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M9 20.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        ),
        run: () => {
          setPreference("system");
          setOpen(false);
        },
      },
    ];
  }, [router, setPreference]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        (c.keywords ?? "").toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Group the flat results while keeping a stable flat index for keyboard nav.
  const grouped = useMemo(() => {
    const map = new Map<string, { cmd: Command; index: number }[]>();
    results.forEach((cmd, index) => {
      const arr = map.get(cmd.group) ?? [];
      arr.push({ cmd, index });
      map.set(cmd.group, arr);
    });
    return Array.from(map.entries());
  }, [results]);

  // Open on ⌘K / Ctrl+K anywhere; also from the header search via a custom event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) {
            setQuery("");
            setActive(0);
          }
          return !v;
        });
      }
    };
    const onOpen = () => openPalette();
    document.addEventListener("keydown", onKey);
    window.addEventListener("aix:open-command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("aix:open-command-palette", onOpen);
    };
  }, [openPalette]);

  // Focus on open + lock body scroll. The query/active reset moved into the
  // handlers that open and close the palette — resetting state in an effect
  // just because `open` changed causes an extra render every time.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = "";
    };
  }, [open]);

  // Keep the active row in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cmd-index="${active}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) =>
        results.length ? (i - 1 + results.length) % results.length : 0
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100000] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="glass-popover relative flex max-h-[62vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-gray-200 shadow-theme-lg dark:border-gray-800"
      >
        {/* Search input */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-100 px-4 dark:border-gray-800">
          <svg
            className="size-5 shrink-0 text-gray-400"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 16.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM17.5 17.5 14 14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={
              listening
                ? "Listening — speak now…"
                : "Search anything — pages, actions, agents…"
            }
            className="h-full w-full bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-white/90"
          />
          {supported && (
            <button
              type="button"
              onClick={toggle}
              aria-label={listening ? "Stop voice search" : "Search by voice"}
              aria-pressed={listening}
              className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                listening
                  ? "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.06]"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <kbd className="hidden shrink-0 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-theme-xs text-gray-500 dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-400 sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="custom-scrollbar flex-1 overflow-y-auto overscroll-contain py-2"
        >
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-gray-100 dark:bg-white/[0.06]">
                <svg className="size-4.5 text-gray-400" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M9 16.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM17.5 17.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="mb-1 text-sm font-medium text-gray-800 dark:text-white/90">
                No results for “{query}”
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Try a different search or hit ESC to close
              </p>
            </div>
          ) : (
            grouped.map(([group, items], gi) => (
              <div key={group} className={gi > 0 ? "mt-2" : ""}>
                <p className="px-4 py-1.5 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                  {group}
                </p>
                {items.map(({ cmd, index }) => {
                  const isActive = index === active;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      data-cmd-index={index}
                      onMouseMove={() => setActive(index)}
                      onClick={() => cmd.run()}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 ${
                        isActive
                          ? "bg-brand-50 dark:bg-brand-500/[0.12]"
                          : "bg-transparent"
                      }`}
                    >
                      <span
                        className={`flex size-7 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4 ${
                          isActive
                            ? "bg-brand-500 text-white"
                            : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
                        }`}
                      >
                        {cmd.icon}
                      </span>
                      <span
                        className={`flex-1 truncate text-sm ${
                          isActive
                            ? "font-semibold text-brand-700 dark:text-brand-400"
                            : "font-medium text-gray-800 dark:text-white/90"
                        }`}
                      >
                        {cmd.label}
                      </span>
                      {cmd.hint && (
                        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                          {cmd.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2.5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> select
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <Kbd>esc</Kbd> close
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            <svg className="size-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6a3 3 0 1 0-3 3h3V6ZM15 6a3 3 0 1 1 3 3h-3V6ZM9 18a3 3 0 1 1-3-3h3v3ZM15 18a3 3 0 1 0 3-3h-3v3ZM9 9h6v6H9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            AIX Command
          </span>
        </div>
      </div>
    </div>
  );
}
