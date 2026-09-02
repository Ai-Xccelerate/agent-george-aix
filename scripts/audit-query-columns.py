"""Check every PostgREST query in the source against the real schema.

Usage:  python scripts/audit-query-columns.py schema.json

schema.json is {table: [columns]} from information_schema.columns on the
target database.

Read the output with care. PostgREST embedded resources (`customers(name)`)
look like columns to this and show up as false positives. The signal worth
acting on is a FILTER — .eq / .in / .is — on a name that is not a column:
Postgres rejects the query, the SDK turns the error into a null, and the
branch takes its "not found" path forever without erroring.

The sender-allowlist bug was a filter on a column that does not exist. Postgres
rejects it, the SDK turns the error into a null, and the branch silently takes
the "not found" path forever. Tests could not catch it because the doubles
accepted any column.

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


findings = []
checked = 0

for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "src")):
    for fn in files:
        if not fn.endswith((".ts", ".tsx")) or fn.endswith(".test.ts"):
            continue
        path = os.path.join(dirpath, fn)
        src = io.open(path, encoding="utf-8", errors="replace").read()
        lines = src.split("\n")

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
            names += [
                (c, call)
                for call, c in COL_CALLS.findall(window)
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
fatal = 0
for path, line, table, col, how in findings:
    key = (path, table, col)
    if key in seen:
        continue
    seen.add(key)
    bad = how in FILTERS
    if bad:
        fatal += 1
    print(f"  {'FILTER' if bad else 'select'}  {path}:{line}  {table}.{col}   (via .{how})")

print()
if fatal:
    print(f"FAIL: {fatal} filter(s) on columns that do not exist.")
    print("A filter on a missing column is rejected by Postgres, becomes a null in")
    print("the SDK, and makes the branch take its 'not found' path forever without")
    print("erroring. Three separate bugs of this shape shipped before it was caught.")
    sys.exit(1)
print("OK: no filters on missing columns. (select-only hits are PostgREST embeds.)")
