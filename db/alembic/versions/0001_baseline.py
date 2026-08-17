"""baseline: George's schema as it already exists

Revision ID: 0001
Revises: None
Created: 2026-08-14

WHY THIS IS A DUMP AND NOT 35 TRANSLATED REVISIONS
George's schema was built by 35 SQL files in supabase/migrations/, applied by hand
over months. Those files already ran; re-running them is impossible, and
hand-translating them into Python revisions would produce a *retelling* of the
schema that could quietly disagree with the real thing — a disagreement nobody
would notice until a from-scratch rebuild failed.

So the baseline is a `pg_dump --schema-only` of the live database. It is not a
description of the schema, it IS the schema. The 35 files stay in the repo as
history; this revision supersedes them as the starting point.

HOW IT IS USED, WHICH DIFFERS PER DATABASE
  * A database that already has the schema (staging, production) is STAMPED:
        alembic stamp 0001
    Nothing executes; Alembic simply records that this database is at 0001.
  * A brand-new empty database RUNS it:
        alembic upgrade head
    which is what makes a from-scratch environment reproducible.

WHY THE DUMP IS NOT SCHEMA-FILTERED
`--schema=public` looks like the obvious choice and produces a baseline that
CANNOT build a database. Two reasons, both found the hard way:

  * `pgcrypto` and `uuid-ossp` are installed in an `extensions` schema, and
    `uuid_generate_v4()` is a column default on most tables. Filter that schema
    out and every CREATE TABLE fails on a missing function.
  * pg_dump omits `CREATE EXTENSION` entirely when a schema filter is used, so
    `vector` and `pg_trgm` would be missing too — and pgvector columns need the
    type to exist.

The unfiltered dump is safe here precisely because this database is already
clean: Railway has only `public` and `extensions`. Supabase's `auth`/`storage`
schemas did not survive the migration, so there is nothing to exclude.

WHAT IS DELIBERATELY OUT OF SCOPE
Row-level security policies. Production (still Supabase) carries 75 of them;
staging (Railway) has none, because nothing uses the RLS path any more — every
query goes through the service-role admin client. This dump contains zero
CREATE POLICY statements, which is correct for the database it describes.
Managing them here would mean pretending two environments are the same when they
are not. See db/README.md.
"""

from __future__ import annotations

import re
from pathlib import Path

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None

BASELINE_SQL = Path(__file__).resolve().parents[2] / "baseline" / "0001_schema.sql"


def _sanitize(sql: str) -> str:
    """Make a pg_dump file executable by a driver rather than by psql.

    Only two things are removed, and the restraint is deliberate.

    1. Backslash meta-commands — pg_dump 18 wraps its output in ``\\restrict`` /
       ``\\unrestrict``. Only the psql client understands those; a driver reports
       a syntax error.
    2. ``CREATE SCHEMA public`` — Postgres can emit it, but the schema always
       exists in a fresh database, so it fails. This exact statement aborted the
       first Supabase-to-Railway restore attempt.

    WHAT IS DELIBERATELY *NOT* REMOVED: THE `SET` PREAMBLE.
    An earlier version of this function stripped pg_dump's leading ``SET`` lines
    as version-specific noise. That broke the restore, because one of them is
    load-bearing: ``SET check_function_bodies = false`` is what allows pg_dump to
    create a function whose body references a table that does not exist yet.
    Without it, `match_knowledge_chunks` fails with `relation
    "public.knowledge_chunks" does not exist` — pg_dump emits functions before
    tables and relies on that setting. The preamble stays.

    Matches are anchored at column 0 for the same class of reason: pg_dump
    indents routine bodies, and this schema has a function containing
    ``    SET search_path TO 'public'``. Matching a stripped line would delete it
    and silently corrupt the definition.
    """
    kept: list[str] = []
    for line in sql.splitlines():
        if line.startswith("\\"):
            continue
        if re.match(r"CREATE SCHEMA public;", line, re.IGNORECASE):
            continue
        kept.append(line)
    return "\n".join(kept)


def upgrade() -> None:
    if not BASELINE_SQL.exists():
        raise FileNotFoundError(
            f"{BASELINE_SQL} is missing. It is committed alongside this revision; "
            "regenerate it with the pg_dump command in db/README.md if it was lost."
        )

    sql = _sanitize(BASELINE_SQL.read_text(encoding="utf-8"))

    bind = op.get_bind()

    # exec_driver_sql, not op.execute: psycopg accepts a multi-statement script
    # in one round trip, whereas op.execute() would try to treat the whole dump
    # as a single statement.
    bind.exec_driver_sql(sql)

    # The dump begins with `SELECT pg_catalog.set_config('search_path', '', false)`
    # — it fully qualifies every name, so it does not need a search_path and
    # empties it defensively. That setting outlives the script on this connection,
    # and Alembic's very next act is to write an UNQUALIFIED insert into
    # alembic_version, which then fails with `relation "alembic_version" does not
    # exist`. Restoring the default leaves the session as Alembic found it.
    bind.exec_driver_sql("SET search_path TO public")


def downgrade() -> None:
    # Deliberately refused. "Downgrading" a baseline means dropping every table
    # in the database; an operator who wants that should say so explicitly by
    # dropping the database, not by running a migration command that sounds
    # reversible. An empty body here would report success while doing nothing.
    raise NotImplementedError(
        "The baseline cannot be downgraded — it represents the entire schema. "
        "To start over, drop and recreate the database, then `alembic upgrade head`."
    )
