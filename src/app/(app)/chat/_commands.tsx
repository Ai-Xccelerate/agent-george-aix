"use client";

import { Building2, Eraser, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Slash commands — first-class chat actions that don't hit the agent.
// ---------------------------------------------------------------------------

export type SlashCommandId = "clear" | "help";

export type SlashCommand = {
  id: SlashCommandId;
  name: string; // typed token, e.g. "/clear"
  description: string;
  icon: LucideIcon;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "clear",
    name: "/clear",
    description: "Delete this conversation and start a fresh one",
    icon: Eraser,
  },
  {
    id: "help",
    name: "/help",
    description: "Show what George can do and how to use this chat",
    icon: HelpCircle,
  },
];

/** Static help text rendered as an assistant message in the chat. */
export const HELP_MESSAGE = `### What George can do

- **Onboarding** — set up new partners and end customers, plan kickoff, drive lifecycle steps to completion.
- **Health & cadence** — record health checks, set recurring cadences, surface what's due this week.
- **Email** — draft replies for review, schedule meetings, propose times. He never sends without your OK.
- **Knowledge** — answer process / role / playbook questions from the org's knowledge base.

### Tips for asking

- **@ a customer** to ground a question on a specific account, e.g. \`How is @Acme Robotics doing?\`
- **Drop a file** (paperclip) to share a contract, NDA, or screenshot.
- **Ask for tables** when you want a breakdown: *"how many end customers per partner?"* gets a clean table.

### Slash commands

- \`/clear\` — wipe this conversation and start a new one
- \`/help\` — show this message again`;

// ---------------------------------------------------------------------------
// Trigger detection — figure out whether the cursor is in a slash-command
// position, an @-mention position, or neither.
// ---------------------------------------------------------------------------

export type CommandTrigger =
  | { kind: "slash"; query: string }
  | { kind: "mention"; query: string; start: number; end: number }
  | null;

/**
 * Inspect the input + cursor and decide whether we should be showing the
 * slash palette, the @-mention list, or nothing.
 *
 * Rules:
 *   - Slash only triggers when the whole input is `/<word>` (cursor anywhere
 *     inside). Once the user types a space or anything else, slash mode ends.
 *   - Mention triggers when the cursor is after an `@` and the substring
 *     between that `@` and the cursor is `[A-Za-z0-9-' ]*`. Word chars + the
 *     occasional space/apostrophe — enough to type "Acme" or "Acme Robotics"
 *     before selecting.
 */
export function detectTrigger(text: string, cursor: number): CommandTrigger {
  // Slash palette: leading "/" up to cursor, no spaces yet.
  if (text.startsWith("/")) {
    const head = text.slice(0, cursor);
    if (!/\s/.test(head)) {
      return { kind: "slash", query: head.slice(1) };
    }
  }

  // Mention palette: walk back from cursor to last "@" that's preceded by a
  // word boundary (start of input or whitespace).
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      const before = i === 0 ? " " : text[i - 1];
      if (!/[\s\n]/.test(before) && before !== "") continue;
      const slice = text.slice(i + 1, cursor);
      // Cap at 40 chars so long pasted text doesn't keep the popover open.
      if (slice.length > 40) return null;
      // Stop on a newline inside the candidate — mentions don't wrap lines.
      if (/[\n\r]/.test(slice)) return null;
      return { kind: "mention", query: slice, start: i, end: cursor };
    }
    if (ch === "\n") break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Popover UI
// ---------------------------------------------------------------------------

export type SlashItem = SlashCommand & { kind: "slash" };
export type MentionItem = {
  kind: "mention";
  id: string;
  name: string;
  customerKind: "partner" | "end_customer";
  domain: string | null;
};
export type PopoverItem = SlashItem | MentionItem;

export function CommandPopover({
  items,
  activeIndex,
  onSelect,
  onHover,
  emptyLabel,
}: {
  items: PopoverItem[];
  activeIndex: number;
  onSelect: (item: PopoverItem) => void;
  onHover: (index: number) => void;
  emptyLabel: string;
}) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 max-h-[260px] overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-1 shadow-lg">
      {items.length === 0 ? (
        <div className="px-3 py-2.5 text-theme-sm text-gray-400 dark:text-gray-500">
          {emptyLabel}
        </div>
      ) : (
        <ul role="listbox" className="space-y-0.5">
          {items.map((it, i) => {
            const active = i === activeIndex;
            return (
              <li key={`${it.kind}-${"id" in it ? it.id : ""}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    // Use mousedown not click so the textarea doesn't lose
                    // focus before the selection happens.
                    e.preventDefault();
                    onSelect(it);
                  }}
                  onMouseEnter={() => onHover(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-theme-sm transition-colors",
                    active
                      ? "bg-brand-50 dark:bg-brand-500/15 text-gray-800 dark:text-white/90"
                      : "text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-white/[0.03]",
                  )}
                >
                  {it.kind === "slash" ? (
                    <SlashRow item={it} active={active} />
                  ) : (
                    <MentionRow item={it} active={active} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SlashRow({ item, active }: { item: SlashItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          active
            ? "bg-brand-500 text-white"
            : "bg-gray-50 dark:bg-white/[0.03] text-gray-500 dark:text-gray-400",
        )}
      >
        <Icon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-theme-xs font-semibold text-gray-800 dark:text-white/90">
          {item.name}
        </span>
        <span className="block text-theme-xs text-gray-400 dark:text-gray-500">
          {item.description}
        </span>
      </span>
    </>
  );
}

function MentionRow({
  item,
  active,
}: {
  item: MentionItem;
  active: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          active
            ? "bg-brand-500 text-white"
            : "bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400",
        )}
      >
        <Building2 size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-gray-800 dark:text-white/90">
          {item.name}
        </span>
        <span className="block text-theme-xs text-gray-400 dark:text-gray-500">
          {item.customerKind === "partner" ? "Channel partner" : "End customer"}
          {item.domain ? ` · ${item.domain}` : ""}
        </span>
      </span>
    </>
  );
}
