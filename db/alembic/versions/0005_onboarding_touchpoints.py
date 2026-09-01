"""onboarding_touchpoint, escalations.draft_id

Revision ID: 0005
Revises: 0004
Created: 2026-08-27

TWO THINGS THE ONBOARDING AGENT CANNOT DO WITHOUT.

ESCALATIONS.DRAFT_ID - MAKING APPROVAL MEAN SOMETHING
raise_decision writes a title, a detail and a list of suggested actions. None
of that names a draft, so "approve" currently means "hand the instruction back
to George", and George composes again. The text a human read and the text that
leaves are then two different objects that merely tend to agree.

That is the 2026-08-20 shape restated: a human authorising an intent rather than
an artifact. Binding the escalation to a draft id makes approval send *that*
draft, and makes "sent content equals approved content" a property that can be
tested instead of hoped for.

text, not uuid: the id belongs to the mail provider (Nylas), and it is opaque.

ONBOARDING_TOUCHPOINT - SILENCE NEEDS SOMEWHERE TO LIVE
Nothing today records that George wrote to a customer on a given day and heard
nothing back. audit_log has the send, and email_messages has the thread, but
neither answers "which planned touchpoint was that, and is it still unanswered".
Without that row, silence is not a signal - it is an absence, and absences are
what nobody notices.

WHY NOT REUSE `objectives`
It already carries followup_interval_hours, next_followup_at, followup_count and
thread_conversation_id, and a working scan drives them. It was the cheaper
option and it is the wrong one.

`objectives` models commitments somebody made. A touchpoint is something George
sent. Putting sends in that table would list every outbound email in the
customer's objective view as though the customer owed a reply for each, and the
reply-extraction path (create_objective) would be writing into the same table it
reads its own sends from. The saving is one migration; the cost is that the
surface a human reads stops meaning one thing.

SHAPE NOTES
- plan_id is NOT NULL and the uniqueness key is (plan_id, touchpoint_key). The
  plan is created as step one of onboarding, so it always exists by the time a
  touchpoint does, and keying on the plan means a customer who onboards a second
  time gets a fresh set of rows rather than colliding with the first.
- status is an enum rather than a pair of booleans because the states are
  ordered and mutually exclusive, and because 'declined' and 'skipped' are real
  outcomes that a nullable sent_at cannot express.
- Three timestamps rather than one status transition log: sent_at, replied_at,
  silence_escalated_at. They answer the three questions actually asked - did it
  go, did anyone answer, and have we already escalated the quiet - and keeping
  silence_escalated_at separate is what stops the sweep raising the same
  decision every tick.
- draft_id and sent_message_id are both kept. The draft id is what approval
  binds to; the sent id is what the mailbox links back from. They are different
  ids at the provider, and losing the mapping is what makes a sent message
  impossible to trace to the decision that authorised it.

DOWNGRADE
Drops the table, its enum, and the column. No other data depends on them.
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- escalations.draft_id ---------------------------------------------
    op.execute(
        "ALTER TABLE public.escalations ADD COLUMN IF NOT EXISTS draft_id text"
    )
    op.execute(
        "COMMENT ON COLUMN public.escalations.draft_id IS "
        "'The mail-provider draft this decision approves, when it approves one. "
        "Approval sends THIS draft rather than re-composing, so the text a human "
        "read is the text that leaves. Null for decisions that are not about an email.'"
    )
    # Approval looks the escalation up by draft; partial because most
    # escalations carry no draft at all.
    op.execute(
        "CREATE INDEX IF NOT EXISTS escalations_draft_id_idx "
        "ON public.escalations (draft_id) WHERE draft_id IS NOT NULL"
    )

    # ---- onboarding_touchpoint --------------------------------------------
    op.execute(
        "DO $do$ BEGIN "
        "CREATE TYPE public.onboarding_touchpoint_status AS ENUM ("
        "'planned','drafted','awaiting_approval','sent','replied','silent',"
        "'skipped','declined'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $do$"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.onboarding_touchpoint (
            id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
            customer_id           uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
            plan_id               uuid NOT NULL REFERENCES public.onboarding_plans(id) ON DELETE CASCADE,

            -- Matches a key in tenant_process.touchpoints. Text, not an enum:
            -- the set is tenant-defined data, not a schema constant.
            touchpoint_key        text NOT NULL,
            status                public.onboarding_touchpoint_status NOT NULL DEFAULT 'planned',

            -- What George composed, and what a human approved it as.
            draft_id              text,
            escalation_id         uuid REFERENCES public.escalations(id) ON DELETE SET NULL,
            session_id            uuid REFERENCES public.agent_sessions(id) ON DELETE SET NULL,

            -- Provider ids: the thread the conversation lives on, and the
            -- message that actually went. Used to match replies and to link a
            -- sent message back to the decision that authorised it.
            thread_id             text,
            sent_message_id       text,

            -- The recipient, recorded at send time from the account record.
            -- Stored rather than re-derived so the audit answers "who did this
            -- actually go to" without depending on contacts still being current.
            recipient_email       text,
            recipient_contact_id  uuid REFERENCES public.contacts(id) ON DELETE SET NULL,

            scheduled_for         timestamptz,
            sent_at               timestamptz,
            replied_at            timestamptz,
            silence_escalated_at  timestamptz,

            created_at            timestamptz NOT NULL DEFAULT now(),
            updated_at            timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    # One row per planned touchpoint per plan. Keyed on the plan, not the
    # customer, so re-onboarding starts a clean set.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS onboarding_touchpoint_plan_key_idx "
        "ON public.onboarding_touchpoint (plan_id, touchpoint_key)"
    )
    # The silence sweep: sent, unanswered, not yet escalated. Partial so the
    # index stays small as sent touchpoints accumulate.
    op.execute(
        "CREATE INDEX IF NOT EXISTS onboarding_touchpoint_silence_idx "
        "ON public.onboarding_touchpoint (sent_at) "
        "WHERE status = 'sent' AND replied_at IS NULL"
    )
    # Approval and reply matching look rows up by provider id.
    op.execute(
        "CREATE INDEX IF NOT EXISTS onboarding_touchpoint_draft_idx "
        "ON public.onboarding_touchpoint (draft_id) WHERE draft_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS onboarding_touchpoint_thread_idx "
        "ON public.onboarding_touchpoint (thread_id) WHERE thread_id IS NOT NULL"
    )
    # The customer page renders these in order.
    op.execute(
        "CREATE INDEX IF NOT EXISTS onboarding_touchpoint_customer_idx "
        "ON public.onboarding_touchpoint (customer_id, scheduled_for)"
    )

    op.execute(
        "COMMENT ON TABLE public.onboarding_touchpoint IS "
        "'One planned outreach in a customer''s onboarding: what was sent, when, to whom, "
        "and whether anyone replied. Separate from `objectives` on purpose - objectives are "
        "commitments somebody made, touchpoints are things George sent.'"
    )
    op.execute(
        "COMMENT ON COLUMN public.onboarding_touchpoint.silence_escalated_at IS "
        "'Set when silence on this touchpoint has already raised a decision. Kept separate "
        "from replied_at so the sweep escalates once rather than every tick.'"
    )
    op.execute(
        "COMMENT ON COLUMN public.onboarding_touchpoint.recipient_email IS "
        "'Resolved from the account record at send time and frozen here. Never inferred from "
        "message content, and never re-derived later - the audit must say who it actually "
        "went to, not who it would go to today.'"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.onboarding_touchpoint")
    op.execute("DROP TYPE IF EXISTS public.onboarding_touchpoint_status")
    op.execute("DROP INDEX IF EXISTS public.escalations_draft_id_idx")
    op.execute("ALTER TABLE public.escalations DROP COLUMN IF EXISTS draft_id")
