"""add claim_id to agent_events so a double-claim leaves a trace

Revision ID: 0003
Revises: 0002
Created: 2026-08-27

WHAT IS MISSING TODAY
`agent_jobs` records which run holds it, in `running_run_id`. `agent_events`
records only `status` and `claimed_at` — the fact that something claimed it and
when, but never *which* process. Nothing in the table distinguishes "claimed
once, still running" from "claimed, abandoned, reclaimed, and now being worked
by a second process while the first is also still going".

The claim itself is already safe against the simple race. It is

    UPDATE agent_events SET status='processing'
     WHERE id = $1 AND status='pending'

so two processes cannot both win a pending row; Postgres serialises them and the
loser gets no row back. That is not the gap.

THE GAP THIS CLOSES
The gap opens after a reclaim. A worker hangs past the 12-minute window,
reclaim.ts releases the event back to 'pending' — correctly, it has every reason
to believe that worker is dead — a second worker claims it, and then the first
worker wakes up and finishes too. Both ran the same event. Neither did anything
wrong, and afterwards the row looks exactly like an event that was processed
once.

That was theoretical until 2026-08-27, when the cron moved to its own service
and a deploy was observed running two workers concurrently for ~4 seconds. It is
not a rare condition; it recurs on every worker deploy, and Railway offers no
setting that removes it (`overlapSeconds: 0` does not — the replacement is
started before the old container is signalled).

Harmless while George cannot send. Once sending is on, this is two emails to a
customer from one trigger with nothing in the database to show it happened.

WHY A UUID AND NOT A PROCESS NAME
The claim id is minted per claim, not per process. A process identity would tell
you which container, but not whether *this* claim is the one still held — the
same container legitimately claims the same event again after a reclaim. A fresh
uuid each time makes the claim itself the thing being identified, so the holder
can be checked with an equality test at completion time (a fencing token): a
process whose claim id no longer matches has lost the row and must not write a
terminal status over the winner's.

WHY NULLABLE, AND WHY NO INDEX
Nullable because every existing row predates the column and because NULL is the
correct value for anything not currently claimed — reclaim.ts clears it on
release, exactly as it clears `running_run_id`. No index: nothing looks rows up
*by* claim id. The reclaim sweep still selects on `(status, claimed_at)`, and
the completion path already has the row's primary key. An index here would cost
writes on the hottest column in the table and serve no read.

DOWNGRADE IS SAFE
Dropping the column loses only the claim-tracking, not any event data.
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.agent_events "
        "ADD COLUMN IF NOT EXISTS claim_id uuid"
    )
    op.execute(
        "COMMENT ON COLUMN public.agent_events.claim_id IS "
        "'Identifies the current claim, not the process. Minted when status "
        "flips pending -> processing; cleared when the claim is released or the "
        "event reaches a terminal status. Compared at completion time so a "
        "process that lost the row to a reclaim cannot overwrite the winner.'"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.agent_events DROP COLUMN IF EXISTS claim_id"
    )
