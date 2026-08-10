/**
 * Static audit: does the PostgREST shim cover every database call in the app?
 *
 * The shim (src/lib/db/postgrest.ts) implements the subset of the supabase-js
 * interface this codebase uses. That subset was originally established by
 * grepping, which proves what exists but not what was missed. This walks every
 * `.from(...)` chain in the source and checks each chained method against the
 * implemented set, so "we audited it" becomes a claim the build can verify
 * rather than something a reviewer has to take on trust.
 *
 * It also runs each `.select()` string through the shim's real parser, so a
 * select the parser would choke on shows up here rather than at runtime.
 *
 * Usage:  pnpm tsx scripts/audit-shim-coverage.ts
 * Exits non-zero if anything is unsupported.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSelect } from "../src/lib/db/postgrest";

// process.cwd(), not import.meta.dirname — tsx transpiles this to CJS, where
// import.meta is undefined. Run from the repo root (pnpm does that for us).
const ROOT = process.cwd();
const SCAN_DIRS = ["src", "scripts"];

/** Methods the shim implements. Keep in sync with postgrest.ts. */
const SUPPORTED = new Set([
  "from", "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike",
  "in", "is", "not", "or",
  "order", "limit", "single", "maybeSingle",
  "rpc",
]);

/**
 * Methods that exist on supabase-js but the shim does NOT implement. Listing
 * them explicitly (rather than treating every unknown token as a miss) keeps
 * the signal clean: `.map()` on a result array is not a database call.
 */
const POSTGREST_ONLY = new Set([
  "range", "textSearch", "match", "filter", "contains", "containedBy",
  "overlaps", "rangeGt", "rangeLt", "rangeGte", "rangeLte", "rangeAdjacent",
  "csv", "geojson", "explain", "throwOnError", "abortSignal", "returns",
  "onConflict", "setHeader", "likeAllOf", "ilikeAnyOf",
]);

type Finding = { file: string; line: number; detail: string };

const unsupported: Finding[] = [];
const badSelects: Finding[] = [];
const embeds = new Map<string, Set<string>>();
let chainCount = 0;
let selectCount = 0;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/** Line number for a character offset, for readable output. */
function lineAt(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

/**
 * Grabs the text of a chain starting at `.from(` and running to the statement
 * end. Chains span lines and nest parens, so this tracks depth rather than
 * matching a regex against a single line.
 */
function chainFrom(src: string, start: number): string {
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if ((ch === ";" || ch === "\n") && depth <= 0) {
      // A newline only ends the chain if the next non-space isn't a dot.
      if (ch === ";") break;
      const rest = src.slice(i + 1).match(/^\s*/)?.[0] ?? "";
      if (src[i + 1 + rest.length] !== ".") break;
    }
  }
  return src.slice(start, i);
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    // Only files that actually talk to the database.
    if (!/\.from\(|\.rpc\(/.test(src)) continue;

    const fromRe = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(src))) {
      // Storage chains are not database calls — they still go to Supabase.
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/\.storage\s*$/.test(before)) continue;

      chainCount++;
      const chain = chainFrom(src, m.index);
      const methodRe = /\.([a-zA-Z]+)\(/g;
      let mm: RegExpExecArray | null;
      while ((mm = methodRe.exec(chain))) {
        const name = mm[1];
        if (SUPPORTED.has(name)) continue;
        if (POSTGREST_ONLY.has(name)) {
          unsupported.push({
            file: rel,
            line: lineAt(src, m.index + mm.index),
            detail: `.${name}() is a PostgREST method the shim does not implement`,
          });
        }
        // Anything else (.map, .filter on an array, .then) is plain JS.
      }
    }

    // Every select string must survive the real parser.
    const selectRe = /\.select\(\s*(["'`])([\s\S]*?)\1/g;
    let sm: RegExpExecArray | null;
    while ((sm = selectRe.exec(src))) {
      const spec = sm[2];
      if (!spec.trim()) continue;
      selectCount++;
      try {
        const parsed = parseSelect(spec);
        for (const e of parsed.embeds) {
          if (!embeds.has(e.table)) embeds.set(e.table, new Set());
          embeds.get(e.table)!.add(e.inner ? "inner" : "left");
        }
      } catch (err) {
        badSelects.push({
          file: rel,
          line: lineAt(src, sm.index),
          detail: `${(err as Error).message} — ${JSON.stringify(spec.slice(0, 60))}`,
        });
      }
    }
  }
}

console.log(`\nscanned ${chainCount} .from() chains and ${selectCount} select strings\n`);

console.log("embedded tables in use:");
for (const [table, kinds] of [...embeds].sort()) {
  console.log(`  ${table.padEnd(20)} ${[...kinds].sort().join(" + ")}`);
}
console.log(
  "  (cardinality is NOT checked here — it depends on foreign-key direction,\n" +
    "   which needs a live database. scripts/verify-pg-shim.ts covers that.)",
);

if (badSelects.length) {
  console.log(`\nSELECT STRINGS THE PARSER REJECTS (${badSelects.length}):`);
  for (const f of badSelects) console.log(`  ${f.file}:${f.line}  ${f.detail}`);
}

if (unsupported.length) {
  console.log(`\nUNSUPPORTED POSTGREST METHODS (${unsupported.length}):`);
  for (const f of unsupported) console.log(`  ${f.file}:${f.line}  ${f.detail}`);
}

const problems = unsupported.length + badSelects.length;
console.log(
  problems === 0
    ? "\nOK — every chained method is implemented and every select string parses.\n" +
        "Runtime behaviour (embed cardinality, ordering, error codes) is proven\n" +
        "separately by scripts/verify-pg-shim.ts against a real database.\n"
    : `\n${problems} call site(s) need attention before the shim can serve them.\n`,
);
process.exit(problems === 0 ? 0 : 1);
