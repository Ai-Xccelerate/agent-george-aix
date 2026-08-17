"""Alembic environment for George's schema.

Two things this file exists to get right.

1. THE TARGET DATABASE COMES FROM THE ENVIRONMENT, AND ONLY FROM THERE.
   There is no URL in alembic.ini and no fallback here. Applying a migration to
   the wrong database is the most expensive mistake this tooling can make, so a
   missing DATABASE_URL is a hard failure rather than a default.

2. AUTOGENERATE IS OFF, DELIBERATELY.
   George has no SQLAlchemy models — the schema is defined in SQL and always has
   been (35 files in supabase/migrations/, now the baseline dump). `target_metadata`
   is therefore None. Running `alembic revision --autogenerate` would diff the
   database against an empty model set and propose dropping every table, so it is
   blocked below with an explanation rather than left as a loaded gun.
"""

from __future__ import annotations

import os
import sys

from alembic import context
from sqlalchemy import create_engine

config = context.config

# No models: this is a SQL-first schema. See the module docstring.
target_metadata = None


def database_url() -> str:
    """The database to migrate, from DATABASE_URL.

    SQLAlchemy maps a bare ``postgresql://`` to psycopg2, which is not installed
    (we pin psycopg 3). Rewriting the scheme keeps the variable copy-pasteable
    from Railway, `railway connect`, or a Supabase connection string without
    anyone having to remember a driver suffix.
    """
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        sys.exit(
            "DATABASE_URL is not set.\n"
            "\n"
            "Alembic has no default connection string on purpose — pointing it at\n"
            "the wrong database is the one mistake worth designing out. Set it\n"
            "explicitly for the environment you mean to migrate:\n"
            "\n"
            "  local/staging : railway connect Postgres-<id> --tunnel-only, then\n"
            "                  DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:<port>/railway\n"
            "  production    : the production connection string\n"
            "\n"
            "See db/README.md."
        )

    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


def run_migrations_offline() -> None:
    """Emit SQL instead of executing it — `alembic upgrade head --sql`.

    This is mandatory before a production apply (db/README.md): the generated SQL
    is read by a human first. It is the one capability that most justifies Alembic
    over a simpler runner, so it is kept working.
    """
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Wrap each revision separately so the emitted script reads as a
        # sequence of independent, reviewable steps.
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Apply migrations against a live database."""
    engine = create_engine(database_url(), pool_pre_ping=True, future=True)

    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # One transaction per revision rather than one for the whole run: a
            # failure then leaves the successful revisions applied and recorded,
            # instead of rolling back work that was fine and lying about it in
            # alembic_version.
            transaction_per_migration=True,
            # Needed by revisions that must escape the transaction — e.g.
            # CREATE INDEX CONCURRENTLY. See db/README.md.
            compare_type=False,
        )
        with context.begin_transaction():
            context.run_migrations()

    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
