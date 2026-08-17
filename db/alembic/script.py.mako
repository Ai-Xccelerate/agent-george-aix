"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Created: ${create_date}

Write raw SQL with op.execute(). George's schema is defined in SQL, not in
models — see db/README.md.

Both directions must be written. If a change genuinely cannot be reversed, raise
NotImplementedError with the reason rather than leaving downgrade() empty: an
empty downgrade silently reports success while doing nothing.

If this migration needs CREATE INDEX CONCURRENTLY, VACUUM, or ALTER TYPE in a way
Postgres forbids inside a transaction, wrap it:

    with op.get_context().autocommit_block():
        op.execute("CREATE INDEX CONCURRENTLY ...")
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | None = ${repr(branch_labels)}
depends_on: str | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "raise NotImplementedError(\"write the upgrade\")"}


def downgrade() -> None:
    ${downgrades if downgrades else "raise NotImplementedError(\"write the downgrade, or explain why it cannot be reversed\")"}
