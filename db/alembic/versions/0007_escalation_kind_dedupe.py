"""escalations.kind, escalations.dedupe_key

Revision ID: 0007
Revises: 0006
Created: 2026-09-02

THE 401 THAT WAS RAISED OVER AND OVER

A disconnected mailbox produced a new "decision" every time anything touched
Nylas. They stacked up in AI actions, each one identical, each one asking a
person to decide something that was not a decision - the mailbox needed
reconnecting, and no amount of choosing would reconnect it.

That is two separate faults wearing one coat.

FAULT ONE: NO NOTION OF "THE SAME PROBLEM AGAIN"
`escalations` has no identity beyond its own row id, so the only way to ask
"have I already raised this?" is to match on title text - which is what the
silence sweep does today with `ilike '%has gone quiet%'`. That works until
somebody edits the copy.

`dedupe_key` gives a raiser a stable name for the condition it is reporting
("nylas_auth_failed", "silence:<plan_id>"), so the second occurrence can find
the first and leave it alone. Uniqueness is enforced only among OPEN rows: once
a person resolves it, the same condition recurring is genuinely new information
and should be raised again.

FAULT TWO: TWO DIFFERENT THINGS IN ONE QUEUE
"Should we offer Northwind a discount?" and "the mailbox is disconnected" are
both rows in `escalations`, and the queue shows them side by side. They need
different people, different urgency and different verbs - one is judgement about
a customer, the other is an operational fix with a button.

Mixing them makes the queue less useful in both directions: the operational
noise buries the account decisions, and the account decisions delay the
operational fixes. `kind` splits them.

DEFAULT 'account': every existing row was raised by George about a customer,
which is exactly what 'account' means. Backfilling to the default is correct
rather than merely convenient.
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escalation_kind') THEN
                CREATE TYPE escalation_kind AS ENUM ('account', 'system');
            END IF;
        END$$;

        ALTER TABLE escalations
            ADD COLUMN IF NOT EXISTS kind escalation_kind NOT NULL DEFAULT 'account',
            ADD COLUMN IF NOT EXISTS dedupe_key text;

        COMMENT ON COLUMN escalations.kind IS
            'account = a judgement about a customer, for whoever owns the relationship. '
            'system = an operational fault (a disconnected mailbox, a failing sync) with '
            'a fix rather than a decision.';

        COMMENT ON COLUMN escalations.dedupe_key IS
            'Stable name for the condition being reported, so a recurrence can find the '
            'open row instead of adding another. NULL means the raiser does not dedupe.';

        -- Unique among OPEN rows only. A condition that recurs after somebody
        -- resolved it is new information; a condition that recurs while the
        -- first report is still open is noise.
        CREATE UNIQUE INDEX IF NOT EXISTS escalations_open_dedupe_idx
            ON escalations (org_id, dedupe_key)
            WHERE dedupe_key IS NOT NULL AND status = 'open';

        CREATE INDEX IF NOT EXISTS escalations_kind_status_idx
            ON escalations (org_id, kind, status);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS escalations_kind_status_idx;
        DROP INDEX IF EXISTS escalations_open_dedupe_idx;
        ALTER TABLE escalations
            DROP COLUMN IF EXISTS dedupe_key,
            DROP COLUMN IF EXISTS kind;
        DROP TYPE IF EXISTS escalation_kind;
        """
    )
