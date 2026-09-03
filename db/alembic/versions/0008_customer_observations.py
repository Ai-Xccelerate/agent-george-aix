"""customer_observations

Revision ID: 0008
Revises: 0007
Created: 2026-09-03

WHAT GEORGE DOES INSTEAD OF RAISING WORK

Every autonomous path George has ends in the same place: an escalation. Read a
reply, raise a decision. Notice silence, raise a decision. Run the weekly sweep,
raise three. Each one is a row on a queue that says "a human must act on this",
and none of them can be closed by anything except a human acting.

That does not scale, and it inverts the point. One broken mailbox produced 34
open escalations. A queue where most rows are George thinking out loud is a
queue nobody reads, and then the one row that mattered is missed too.

An observation is the other thing George can produce: something he noticed,
recorded against the account, that nobody has to do anything about. It
accumulates into an understanding of the customer rather than a list of chores.
A person reads the account and decides whether any of it deserves action.

WHY A NEW TABLE AND NOT customer_health
customer_health answers one question - what band is this account in, and why.
It is a scalar with a reason string. An observation is not a score: it has a
source, a date it refers to, and a category, and several can be true at once
without contradicting each other.

WHY dedupe_key HERE TOO
Same reason as escalations, learned the same way. George re-reads the same
thread on every sync; without a key he re-records the same observation every
time and the account fills with the same sentence.

SOURCE IS NOT DECORATION
"George thinks the account is quiet" and "the customer said they are blocked on
IT" are different kinds of claim, and a person reading the account needs to know
which one they are looking at. The source column is what keeps an inference
distinguishable from a quotation.
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'observation_source') THEN
                CREATE TYPE observation_source AS ENUM (
                    'email', 'transcript', 'meeting', 'reply', 'scan', 'chat', 'other'
                );
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'observation_category') THEN
                CREATE TYPE observation_category AS ENUM (
                    'risk', 'progress', 'relationship', 'commercial', 'product', 'other'
                );
            END IF;
        END$$;

        CREATE TABLE IF NOT EXISTS customer_observations (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
            customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

            -- What was noticed, in one line a person can scan.
            summary       text NOT NULL,
            -- The evidence. Quote the customer where there is a quote to give.
            detail        text,

            source        observation_source NOT NULL DEFAULT 'other',
            category      observation_category NOT NULL DEFAULT 'other',

            -- When the thing being described happened, which is not when the
            -- row was written: a transcript synced today can describe a call
            -- from last week, and sorting by created_at would tell that story
            -- in the wrong order.
            observed_at   timestamptz NOT NULL DEFAULT now(),

            -- Provenance, so a claim can be traced back to what produced it.
            session_id    uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
            source_ref    text,

            -- Stable name for the thing being observed, so re-reading the same
            -- thread does not re-record the same sentence.
            dedupe_key    text,

            -- Set when a person has read it. Not a queue - just a way to show
            -- what is new since you last looked.
            acknowledged_at timestamptz,

            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now()
        );

        COMMENT ON TABLE customer_observations IS
            'Things George noticed about an account that nobody has to action. '
            'The counterpart to escalations: escalations ask for a decision, '
            'observations build an understanding.';

        -- The account feed: newest first, per customer.
        CREATE INDEX IF NOT EXISTS customer_observations_feed_idx
            ON customer_observations (customer_id, observed_at DESC);

        -- "What is new across the book since I last looked."
        CREATE INDEX IF NOT EXISTS customer_observations_unread_idx
            ON customer_observations (org_id, observed_at DESC)
            WHERE acknowledged_at IS NULL;

        -- One row per thing observed. Unlike escalations this is unconditional:
        -- an observation has no open/closed state to reset against.
        CREATE UNIQUE INDEX IF NOT EXISTS customer_observations_dedupe_idx
            ON customer_observations (customer_id, dedupe_key)
            WHERE dedupe_key IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS customer_observations;
        DROP TYPE IF EXISTS observation_category;
        DROP TYPE IF EXISTS observation_source;
        """
    )
