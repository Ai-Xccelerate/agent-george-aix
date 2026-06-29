/**
 * Minimal OKF frontmatter parser — dependency-free.
 *
 * Parses the leading `---\n…\n---` YAML block of a markdown concept into a flat
 * map and returns the remaining body. We author and generate these docs, so we
 * support a deliberately small, predictable subset rather than pulling in a full
 * YAML engine:
 *
 *   type: concept            → string
 *   title: "Quoted title"    → string (surrounding quotes stripped)
 *   tags: [a, b, c]          → string[]
 *   links:                   → string[]
 *     - /core/foo
 *     - bar.md
 *
 * Anything outside this subset (nested maps, anchors, multi-line scalars) is not
 * supported and would be ignored — keep frontmatter flat.
 */

export type Frontmatter = {
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  links?: string[];
  timestamp?: string;
  /** Any other scalar keys land here as strings. */
  [key: string]: string | string[] | undefined;
};

export type ParsedDoc = {
  /** Parsed frontmatter (empty object if none). */
  data: Frontmatter;
  /** Markdown body with the frontmatter block removed. */
  body: string;
  /** True if a frontmatter block was present. */
  hasFrontmatter: boolean;
};

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(raw: string): ParsedDoc {
  const match = raw.match(FM_RE);
  if (!match) return { data: {}, body: raw, hasFrontmatter: false };

  const yaml = match[1];
  const body = raw.slice(match[0].length);
  const data: Frontmatter = {};

  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const rest = kv[2].trim();

    if (rest === "") {
      // Possible block list on following indented lines.
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(stripQuotes(lines[i].replace(/^\s*-\s+/, "").trim()));
        i++;
      }
      data[key] = items;
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = rest
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
    } else {
      data[key] = stripQuotes(rest);
    }
  }

  return { data, body, hasFrontmatter: true };
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Serialize OKF frontmatter back to a YAML block. Used when George proposes a
 * concept so the on-disk / stored form round-trips. Keeps the flat subset.
 */
export function serializeFrontmatter(data: Frontmatter): string {
  const lines: string[] = ["---"];
  const scalarKeys = ["type", "title", "description", "resource", "timestamp"] as const;
  for (const k of scalarKeys) {
    const v = data[k];
    if (typeof v === "string" && v.length) lines.push(`${k}: ${quoteIfNeeded(v)}`);
  }
  for (const k of ["tags", "links"] as const) {
    const v = data[k];
    if (Array.isArray(v) && v.length) {
      lines.push(`${k}: [${v.join(", ")}]`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function quoteIfNeeded(v: string): string {
  return /[:#\[\]{}]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}
