# Database migrations

George's schema is managed with **Alembic**, matching AIX Core and Parchment so
there is one migration tool and one playbook across AIX products.

Everything Python lives in this directory. **Nothing about the Node app changes** —
`package.json`, the `Dockerfile`, `tsconfig.json` and the build are untouched, and
Alembic is never part of the running container. Migrations are applied by a person
(or, later, CI) against a database URL.

## One-time setup

```bash
cd db
uv venv && uv pip install -r requirements.txt
```

Then either activate the venv or call the binary directly — every command below
assumes you are in `db/` and that `alembic` resolves to `.venv/Scripts/alembic`
(Windows) or `.venv/bin/alembic` (macOS/Linux).

## Pointing at a database

There is **no connection string in this repo.** `DATABASE_URL` must be set
explicitly for every command; Alembic exits with instructions if it is missing.
That is deliberate — applying a migration to the wrong database is the most
expensive mistake this tooling can make, so there is no default to get wrong.

```bash
# staging / local, via the Railway tunnel
railway connect Postgres-bl1d --tunnel-only         # prints a localhost port
export DATABASE_URL="postgresql://postgres:<pw>@127.0.0.1:<port>/railway"
```

`postgresql://` and `postgres://` are both accepted; the driver suffix is added
for you.

## Where the schema came from

35 SQL files in `../supabase/migrations/` built this schema by hand between May
and August 2026. They are **history, not the source of truth** — do not add to
them and do not re-run them.

Revision `0001_baseline` is a `pg_dump --schema-only` of the live database. It is
not a description of the schema, it *is* the schema. Existing databases are
**stamped** at it; only a brand-new database ever executes it.

To regenerate it (rarely needed — e.g. after the production cutover):

```bash
pg_dump --schema-only --no-owner --no-privileges --no-comments \
        -f db/baseline/0001_schema.sql "$DATABASE_URL"
```

**Do not add `--schema=public`.** It produces a baseline that cannot build a
database: `pgcrypto` and `uuid-ossp` live in an `extensions` schema and
`uuid_generate_v4()` is a column default on most tables, and pg_dump drops all
`CREATE EXTENSION` statements when a schema filter is used — so `vector` and
`pg_trgm` disappear too. The unfiltered dump is safe because this database only
has `public` and `extensions`; Supabase's `auth`/`storage` schemas did not
survive the migration.

`pg_dump` must be **at least as new as the server**. Staging runs Postgres 18, so
pg_dump 17 refuses with "server version mismatch" — use an 18 client. Options
that work: the `postgres:18` Docker image, or the EDB Windows binaries zip
(`get.enterprisedb.com/postgresql/postgresql-18.2-1-windows-x64-binaries.zip`,
extract `pgsql/bin`, no install required).

The revision sanitizes the dump when it runs — stripping psql `\` meta-commands,
`CREATE SCHEMA public`, and the `SET` preamble — so a raw dump is fine to commit.

## Managing `alembic_version`

Alembic creates the `alembic_version` table on first contact. Initialising an
existing database is one command:

```bash
alembic stamp 0001        # records the baseline; executes nothing
alembic current           # confirm
```

Rules that keep the history trustworthy:

- **One head, always.** `alembic heads` must print exactly one revision. Two means
  two people branched in parallel and it needs a merge revision.
- **Deterministic ids.** Pass `--rev-id` (`0002`, `0003`, …). Alembic's default
  random hex makes the directory listing useless for reading history.
- **Never edit a revision that has been applied anywhere.** Fix forward.
- **Never hand-edit `alembic_version`.** Use `stamp`.

## Creating a migration (local)

```bash
alembic revision --rev-id 0002 -m "add customer_tier to customers"
```

Write raw SQL in `op.execute()`. There are no SQLAlchemy models, so
`--autogenerate` is **off by design**: with no models it would diff the database
against nothing and propose dropping every table.

Write **both** directions, then prove the rollback works before you commit it:

```bash
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

If a change genuinely cannot be reversed, `raise NotImplementedError` with the
reason rather than leaving `downgrade()` empty — an empty downgrade reports
success while doing nothing.

Commit the revision in the **same PR** as the code that depends on it.

### Statements Postgres forbids inside a transaction

Each revision runs in its own transaction. `CREATE INDEX CONCURRENTLY`, `VACUUM`,
and some `ALTER TYPE` forms need to escape it:

```python
with op.get_context().autocommit_block():
    op.execute("CREATE INDEX CONCURRENTLY idx_foo ON customers (tier)")
```

Reach for `CONCURRENTLY` on any table with real row counts — a plain
`CREATE INDEX` takes a write lock for the duration.

## Applying to staging

After the PR merges:

```bash
export DATABASE_URL="<staging>"
alembic current            # where are we now?
alembic upgrade head
alembic current            # confirm it moved
```

## Applying to production

Same tool, one extra step that is **mandatory, not optional**:

```bash
export DATABASE_URL="<production>"

alembic current                          # note the revision, e.g. 0001

# Generate SQL without applying. Offline mode cannot read the database, so it
# needs an explicit range — `--sql` with a bare `head` produces nothing useful.
alembic upgrade 0001:head --sql > review.sql

# READ IT. This is the last point at which a mistake is free. The output is a
# BEGIN / DDL / UPDATE alembic_version / COMMIT block per revision.

alembic upgrade head
alembic current                          # confirm it moved
```

Offline SQL generation is the capability that most justifies Alembic here, so
production changes go through it every time.

Because nothing yet enforces that a merged revision was applied, `alembic current`
belongs in the deploy checklist. A CI job running `upgrade head` against staging on
merge is the natural follow-up.

## Scope: what Alembic does not manage

**Row-level security policies.** Production (still Supabase) carries 75; staging
(Railway Postgres) has none, because nothing uses the RLS path any more — every
query goes through the service-role admin client, and the policies were dropped
during the Postgres migration. Bringing them under Alembic would mean asserting
the two environments are the same when they are not.

If RLS ever becomes load-bearing again, that is the moment to bring it in scope
deliberately — with the environments reconciled first.

**Supabase-managed schemas** (`auth`, `storage`) are likewise out of scope; the
baseline is `--schema=public` only.
