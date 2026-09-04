"""Check every PostgREST query in the source against the real schema.

Usage:  python scripts/audit-query-columns.py schema.json

schema.json is {table: [columns]} from information_schema.columns on the
target database.

Read the output with care. PostgREST embedded resources (`customers(name)`)
look like columns to this and show up as false positives. Two kinds of hit are
worth acting on and both fail the run:

  FILTER — .eq / .in / .is on a name that is not a column. Postgres rejects the
  query, the SDK turns the error into a null, and the branch takes its "not
  found" path forever without erroring. This is the dangerous one: it is
  completely silent.

  WRITE — a key in an .insert / .update / .upsert payload that is not a column.
  Postgres rejects the statement, so it is loud rather than silent, but it still
  breaks the feature. A narrative sweep shipped on 2026-09-04 with `source:` in
  an agent_sessions insert; there is no such column and every run failed on the
  first tick. The audit was not looking at writes at all, which is why it
  reached production.

The sender-allowlist bug was a filter on a column that does not exist. Tests
could not catch it because the doubles accepted any column.

This checks the queries themselves instead: find each `.from("table")` and the
column-taking calls chained after it, then look those columns up in the schema.
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SCHEMA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "db", "schema-columns.json",
)
_raw = json.load(io.open(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SCHEMA, encoding="utf-8"))
# The committed snapshot nests under "tables"; a raw dump does not.
SCHEMA = _raw.get("tables", _raw)

# Chained calls whose first string argument is a column name.
COL_CALLS = re.compile(
    r'\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|not|order|contains)\(\s*"([^"]+)"'
)
FROM = re.compile(r'\.from\(\s*"([a-z_]+)"\s*\)')
SELECT = re.compile(r'\.select\(\s*"([^"]*)"', re.S)


# A select list can carry embedded resources and modifiers that are not columns.
def select_columns(raw: str):
    raw = re.sub(r"\([^)]*\)", "", raw)          # drop embedded resource bodies
    for part in raw.split(","):
        p = part.strip()
        if not p or p == "*":
            continue
        p = p.split(":")[-1].strip()             # alias:col
        p = p.split("!")[0].strip()              # customers!inner
        p = p.split(".")[0].strip()              # joined filters handled below
        if p and re.fullmatch(r"[a-z_][a-z0-9_]*", p):
            yield p

# `.insert({ ... })`, `.update({ ... })`, `.upsert({ ... })`. The payload's own
# top-level keys are column names.
WRITE = re.compile(r"\.(insert|update|upsert)\(\s*(?:\[\s*)?\{")

# A bare `key:` at the start of a line. Deliberately conservative — computed and
# quoted keys are skipped rather than guessed at, because a false positive here
# fails a build for no reason.
WRITE_KEY = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s*:", re.M)


def write_keys(window: str, brace_at: int):
    """Top-level keys of the payload object whose `{` is at `brace_at`."""
    depth = 0
    for j in range(brace_at, min(len(window), brace_at + 4000)):
        ch = window[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                body = window[brace_at + 1 : j]
                # Flatten: keep only characters at nesting depth 0, so keys of
                # nested objects and array members are not mistaken for columns.
                flat = []
                d = 0
                for c in body:
                    if c in "{[":
                        d += 1
                        continue
                    if c in "}]":
                        d -= 1
                        flat.append("\n")
                        continue
                    if d == 0:
                        flat.append(c)
                return WRITE_KEY.findall("\n" + "".join(flat))
    return []


# Select-list keys that are options, not columns.
SELECT_OPTS = {"count", "head", "ascending", "referencedTable", "foreignTable", "nullsFirst"}

findings = []
checked = 0

for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "src")):
    for fn in files:
        if not fn.endswith((".ts", ".tsx")) or fn.endswith(".test.ts"):
            continue
        path = os.path.join(dirpath, fn)
        src = io.open(path, encoding="utf-8", errors="replace").read()

        for m in FROM.finditer(src):
            table = m.group(1)
            if table not in SCHEMA:
                continue  # not a base table we know (view, rpc, or typo we cannot judge)
            cols = set(SCHEMA[table])
            line_no = src[: m.start()].count("\n") + 1
            # The chain: from here to the next `.from(` or 25 lines, whichever first.
            nxt = FROM.search(src, m.end())
            window = src[m.end() : (nxt.start() if nxt else len(src))]
            window = "\n".join(window.split("\n")[:25])

            names = []
            sm = SELECT.search(window)
            if sm:
                names += [(c, "select") for c in select_columns(sm.group(1))]
            names += [(c, call) for call, c in COL_CALLS.findall(window)]

            for wm in WRITE.finditer(window):
                brace = window.index("{", wm.end() - 1)
                names += [
                    (k, wm.group(1))
                    for k in write_keys(window, brace)
                    if k not in SELECT_OPTS
                ]

            for col, how in names:
                # A dotted name targets an embedded resource, not this table.
                if "." in col:
                    continue
                # `payload->x->>y` is a JSON path filter on a real jsonb column,
                # not a column name. Check the root, ignore the path.
                if "->" in col:
                    root = col.split("->")[0].strip()
                    if root in cols:
                        continue
                    col = root
                checked += 1
                if col not in cols:
                    findings.append((path.replace(ROOT + os.sep, ""), line_no, table, col, how))

print(f"column references checked: {checked}")
print(f"references to columns that do not exist: {len(findings)}\n")
seen = set()
FILTERS = {"eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "not"}
# A write naming a column that does not exist fails the statement outright.
WRITES = {"insert", "update", "upsert"}
fatal = 0
for path, line, table, col, how in findings:
    key = (path, table, col)
    if key in seen:
        continue
    seen.add(key)
    bad = how in FILTERS or how in WRITES
    if bad:
        fatal += 1
    kind = "WRITE " if how in WRITES else ("FILTER" if how in FILTERS else "select")
    print(f"  {kind}  {path}:{line}  {table}.{col}   (via .{how})")

print()
if fatal:
    print(f"FAIL: {fatal} filter(s)/write(s) on columns that do not exist.")
    print("A filter on a missing column is rejected by Postgres, becomes a null in")
    print("the SDK, and makes the branch take its 'not found' path forever without")
    print("erroring. Three separate bugs of this shape shipped before it was caught.")
    print("A write names a column in an insert/update payload that is not there; the")
    print("statement fails outright, which is loud but still broken — the narrative")
    print("sweep shipped that way on 2026-09-04.")
    sys.exit(1)
print("OK: no filters or writes on missing columns. (select-only hits are PostgREST embeds.)")
