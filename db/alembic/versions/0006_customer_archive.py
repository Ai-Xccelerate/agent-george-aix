"""customers.archived_at

Revision ID: 0006
Revises: 0005
Created: 2026-09-02

REMOVING A CUSTOMER, WITHOUT REMOVING WHAT HAPPENED

There is no way to get a customer off the list today. Demo accounts, duplicates
and accounts that churned all sit there permanently, and the list is the first
thing anybody looks at - so the one screen that should say "here is the book of
business" says "here is everything anybody ever typed".

WHY ARCHIVE AND NOT DELETE
A customer row is the parent of contracts, plans, steps, health checks,
objectives, touchpoints, escalations, email threads and meeting transcripts.
Deleting it either cascades - destroying the record of work that genuinely
happened, including sent email - or fails on a foreign key and leaves the user
with an error and no way forward.

Neither is what "remove this from my list" means. What it means is "stop showing
me this", and that is a timestamp.

It is also the safer default in the other direction: an archive is reversible by
setting the column back to null, and a person who archives the wrong account
loses nothing. A delete is a decision that cannot be un-made by the person who
made it, which is the wrong shape for a button on a list.

WHY A TIMESTAMP RATHER THAN A BOOLEAN
"When did this stop being live" is a question somebody asks eventually, and a
boolean cannot answer it. The cost of the wider type is nothing.

WHAT HAS TO HONOUR IT
Every read that answers "which customers are there" - the list, the agent's
customer resolution, and both background scans. A column nothing filters on is
worse than no column: it looks like the feature shipped.
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS archived_at timestamptz;

        COMMENT ON COLUMN customers.archived_at IS
            'When this customer was archived. NULL means live. Archived rows are '
            'hidden from the customer list, from the agent''s customer resolution, '
            'and from the background scans - but every child record is untouched.';

        -- Partial index: every query that cares filters on `archived_at IS NULL`,
        -- and the archived rows are the small minority the index need not carry.
        CREATE INDEX IF NOT EXISTS customers_live_idx
            ON customers (org_id, name)
            WHERE archived_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS customers_live_idx;
        ALTER TABLE customers DROP COLUMN IF EXISTS archived_at;
        """
    )
