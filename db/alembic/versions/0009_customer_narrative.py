"""customer_narrative

Revision ID: 0009
Revises: 0008
Created: 2026-09-04

THE ONE QUESTION THE ACCOUNT COULD NOT ANSWER

Open a customer and four questions get asked, in this order: what is the story
here, what changed, how are they doing and why, what is outstanding. Three of
those already had somewhere to live - customer_observations, customer_health,
objectives. The first did not.

It is the one that cannot be assembled from the other three. Twenty-five
observations are twenty-five facts; the story is what they add up to, and
nothing in the schema held it. So the account opened with a list and left the
reader to do the synthesis every time.

WHY A ROW AND NOT A DERIVED VIEW
Because it has to be REWRITTEN, and a derivation cannot be rewritten. A summary
that grows forever stops being read - so this table holds exactly one row per
customer and George replaces its body. There is no history and no append. The
`superseded_count` column keeps the only fact worth keeping about the versions
that came before: how many times this account's story has been redrawn.

WHY NOT customer_health
health is a band and a score with a reason attached - a scalar plus a
justification. The narrative has no scale. An account can be green and still
have a complicated story, and squeezing the story into `reason` is what makes
`reason` unreadable.

WHY NOT memories
`memories` is scoped, keyed, embedded, and has no read/write code anywhere in
the app. Defining its first use as "the thing the customer page renders" would
tie a UI surface to a table built for retrieval. Different job.

SOURCES ARE NOT OPTIONAL HERE
`sources` is NOT NULL with no default, which is the whole design of this table
expressed as a constraint. A narrative is George's synthesis - the highest-
inference thing on the page - so it is the claim that most needs to be
traceable, and the schema refuses to store one that is not. An empty array is a
legal value and means "written from nothing"; the UI treats that as a warning,
not as a citation. What is refused is the column being absent.

Each entry is {kind, id, label} where kind is one of email/transcript/meeting/
observation/session, id addresses the row it came from, and label is what to
show a human. jsonb rather than a join table for the same reason the process is
jsonb: the set of things George can read is still moving, and a migration per
new source kind would be the wrong trade.

EVIDENCE COUNTS, SO SPARSE LOOKS SPARSE
`evidence` records what was actually available when the narrative was written -
how many emails, how many meetings, how many observations. Without it the page
cannot tell a confident summary of one email from a confident summary of forty,
and those should not look the same. An account with two emails and no meetings
must read as thin, because it is.
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS customer_narrative (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
            customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

            -- The story, in prose, as it stands now. Replaced on rewrite.
            body          text NOT NULL,

            -- What it was written from: [{kind, id, label}]. NOT NULL by
            -- design - see the note above. '[]' is legal and means the
            -- narrative cites nothing, which the UI must show as such.
            sources       jsonb NOT NULL,

            -- What was on the record when this was written:
            -- {emails, meetings, transcripts, observations, days_covered}.
            -- Lets the page say "from 2 emails, no meetings" instead of
            -- presenting thin evidence in the same voice as thick evidence.
            evidence      jsonb NOT NULL DEFAULT '{}'::jsonb,

            -- Provenance of the write itself.
            session_id    uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,

            -- How many times this account's story has been redrawn. The one
            -- fact about superseded versions worth keeping once their text is
            -- gone: a narrative rewritten eleven times is a different kind of
            -- account from one written once.
            superseded_count integer NOT NULL DEFAULT 0,

            written_at    timestamptz NOT NULL DEFAULT now(),
            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now()
        );

        COMMENT ON TABLE customer_narrative IS
            'One row per customer: the current story of the account, rewritten '
            'in place rather than appended to. Observations are the facts; this '
            'is what they add up to.';

        -- One row per customer, enforced rather than assumed. This is what
        -- makes "rewrite" the only possible operation: a second row cannot
        -- exist, so an accidental insert fails instead of quietly starting the
        -- append-forever summary this table exists to prevent.
        CREATE UNIQUE INDEX IF NOT EXISTS customer_narrative_one_per_customer_idx
            ON customer_narrative (customer_id);

        -- The customer page reads by (org, customer); the org predicate is on
        -- every query in the app now that RLS is gone.
        CREATE INDEX IF NOT EXISTS customer_narrative_org_idx
            ON customer_narrative (org_id, written_at DESC);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS customer_narrative;
        """
    )
