"""add nylas and scribe to the integration_provider enum

Revision ID: 0002
Revises: 0001
Created: 2026-08-24

WHY THIS SHIPS ALONE, AHEAD OF THE CODE THAT NEEDS IT
`integrations.provider` is a Postgres enum. Per-org mailbox and note-taker rows
need two values it does not have, and code that writes 'nylas' or 'scribe'
against the old enum does not degrade — it raises, for every organisation, on
every integration lookup, the moment it deploys.

So the schema goes first and separately: this revision is merged and deployed on
its own, and only then does the code that depends on it land. Deploying both
together makes the ordering a matter of luck.

WHY ADDING AN ENUM VALUE IS ITS OWN SMALL PROBLEM
`ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in older
PostgreSQL, and Alembic wraps migrations in one. From PG 12 it is allowed, and
this deployment is on 18 — but `IF NOT EXISTS` is used anyway so a re-run, a
partially applied migration, or a database that already picked the values up
some other way is a no-op rather than an error.

WHY DOWNGRADE DOES NOT REMOVE THEM
PostgreSQL cannot drop a value from an enum. Faking it means recreating the type,
rewriting every dependent column, and destroying any row already using the value
— a far more dangerous operation than the one being undone. The honest downgrade
deletes the rows that use the new values so the schema is usable again, and
leaves the values in place. Stated here so the asymmetry is a decision rather
than an oversight.
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


NEW_VALUES = ("nylas", "scribe")


def upgrade() -> None:
    for value in NEW_VALUES:
        op.execute(
            f"ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS '{value}'"
        )


def downgrade() -> None:
    # The values stay — see the note above. Remove the rows that depend on them
    # so the enum is no longer referenced by data, which is the part that
    # actually blocks a rollback.
    op.execute(
        "DELETE FROM public.integrations "
        "WHERE provider::text IN ('nylas', 'scribe')"
    )
