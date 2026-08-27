"""tenant_process, contacts.role

Revision ID: 0004
Revises: 0003
Created: 2026-08-27

WHAT THIS IS FOR
The onboarding agent needs two things the schema cannot currently express:
what this tenant's onboarding process actually is, and who a given contact is
to the account.

TENANT_PROCESS - THE PROCESS AS DATA, NOT AS PROMPT
George is a product AIX sells, and AIX is tenant zero. An onboarding process
written into the prompt is one tenant's process shipped to every tenant. This
table holds it per org, so the agent composes from the tenant's own definition
and a tenant can change how they onboard without a deploy.

`first_value` is the field that carries the weight. Everything else describes
activity - stages passed, touchpoints sent. first_value is the milestone that
means the customer got the thing they paid for, which is the only way George
can report whether onboarding *worked* rather than whether email went out. It
is jsonb rather than text because "did it happen yet" needs an observable
definition, not just a name.

`stages`, `touchpoints` and `escalation` are jsonb for the same reason the
knowledge base is documents rather than columns: their shape is a product
question that is still moving, and a migration per revision of it would be the
wrong trade. The shapes are documented on the columns.

WHY A ROW IS SEEDED FOR EVERY EXISTING ORG
The resolver fails closed: no process record means George refuses to onboard
rather than inventing a process. That is the right default and it is also a
guaranteed outage for every org that exists today, so the migration seeds them.
The template is opinionated on purpose - first value as a reachable milestone,
touchpoints weighted to the first 30 days, one ask per email, escalation on
silence - because a tenant tuning a working default is a much better starting
position than a tenant facing an empty form.

CONTACTS.ROLE - WHY AN ENUM AND NOT THE EXISTING TITLE
`contacts.title` already exists and is free text a human typed: "VP Ops",
"Head of IT", "primary contact". Choosing a recipient by reading that means
inferring a role from prose, which is exactly the failure that sent 16 recaps
on 2026-08-20 - the instruction named no recipient, so the agent assembled a
list from content. An enum makes "who is the champion" a lookup rather than a
judgement, so the recipient rule can be structural instead of nominal.

Nullable, because every existing contact predates it and a wrong guess is worse
than a null. A null role is a contact George may not pick unprompted.

DOWNGRADE
Drops both. The enum is dropped only after the column that uses it, and the
seeded rows go with the table.
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


# Opinionated default, seeded per org and editable afterwards.
DEFAULT_OBJECTIVE = (
    "Get the customer to first value quickly and visibly, and keep the account "
    "moving between signature and go-live without the customer having to chase."
)

DEFAULT_STAGES = """[
  {"key": "signed",       "name": "Signed",              "description": "Contract executed. Nothing has been asked of the customer yet."},
  {"key": "kickoff",      "name": "Kickoff scheduled",   "description": "Introductions made and a kickoff booked with the people who will do the work."},
  {"key": "provisioned",  "name": "Access provisioned",  "description": "Accounts, environments and permissions exist for the customer's team."},
  {"key": "configured",   "name": "Configured",          "description": "Set up against how this customer actually works, not defaults."},
  {"key": "first_value",  "name": "First value reached", "description": "The customer has done the thing they bought the product to do."},
  {"key": "live",         "name": "Live",                "description": "In routine use, handed to the ongoing relationship owner."}
]"""

# Weighted to the first 30 days: attention early is worth more than attention
# spread evenly, and an account that goes quiet in week one rarely recovers on
# a day-60 nudge. One ask each - three requests gets zero replies, one gets an
# answer, and the answer is the point.
DEFAULT_TOUCHPOINTS = """[
  {"key": "welcome",      "day_offset": 0,  "purpose": "Introduce George, confirm who is doing what, and ask for the one thing needed to start.", "ask": "Confirm the right person to work with on setup."},
  {"key": "kickoff_prep", "day_offset": 3,  "purpose": "Get the kickoff booked before the account cools.",                                        "ask": "Pick a kickoff time."},
  {"key": "access_check", "day_offset": 7,  "purpose": "Confirm access actually works, which is where onboarding most often silently stalls.",     "ask": "Confirm the team can log in."},
  {"key": "config_check", "day_offset": 14, "purpose": "Check configuration matches how they work before habits form around a wrong default.",     "ask": "Confirm the setup matches how the team works."},
  {"key": "value_check",  "day_offset": 21, "purpose": "Test whether first value has actually been reached, not whether steps were completed.",    "ask": "Confirm the first real use has happened."},
  {"key": "golive_prep",  "day_offset": 30, "purpose": "Close out onboarding or name explicitly what is blocking go-live.",                        "ask": "Confirm go-live, or name the blocker."}
]"""

# Silence is the signal that matters. Most churning customers leave without
# complaining, so "no reply" is the earliest bad signal available and it needs
# somewhere to land rather than being absorbed as "waiting".
DEFAULT_ESCALATION = """{
  "silence_days": 5,
  "silence_escalate_after": 2,
  "rules": [
    {"when": "no reply to two consecutive touchpoints",       "action": "raise_decision", "urgency": "normal"},
    {"when": "first value not reached by the target go-live", "action": "raise_decision", "urgency": "high"},
    {"when": "a blocker is named and unresolved for 7 days",  "action": "raise_decision", "urgency": "high"},
    {"when": "the customer asks anything commercial",         "action": "raise_decision", "urgency": "high"}
  ],
  "notify": "account owner"
}"""

DEFAULT_VOICE = (
    "Plain, specific and short. Write like a colleague who has read the account, "
    "not like a campaign. One ask per email, with a date. No marketing language, "
    "no enthusiasm the situation has not earned, no chasing for its own sake."
)

# Deliberately generic: what counts as first value is the tenant's to define,
# and a placeholder that is obviously a placeholder is safer than a plausible
# guess George would act on as though it were true. `configured: false` is how
# the resolver and the UI can tell a tuned process from an untouched default.
DEFAULT_FIRST_VALUE = """{
  "label": "First real use by the customer's own team",
  "definition": "The customer has completed, unaided, the task they bought the product to do - not a demo, not a training session, and not a step marked complete by us.",
  "target_days": 21,
  "evidence": "A named person at the customer confirms they have done it, or account state shows it happened.",
  "configured": false
}"""


def _lit(value: str) -> str:
    """Quote a string as a SQL literal.

    The defaults contain apostrophes ("customer's team"), so they cannot be
    concatenated raw. Doubling the quote is the whole rule. These are
    module constants, not input - this exists for correctness, not sanitising.
    """
    return "'" + value.replace("'", "''") + "'"


def upgrade() -> None:
    op.execute(
        "DO $do$ BEGIN "
        "CREATE TYPE public.tenant_process_type AS ENUM ('onboarding'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $do$"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.tenant_process (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id        uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
            type          public.tenant_process_type NOT NULL DEFAULT 'onboarding',
            objective     text NOT NULL,
            stages        jsonb NOT NULL DEFAULT '[]'::jsonb,
            touchpoints   jsonb NOT NULL DEFAULT '[]'::jsonb,
            escalation    jsonb NOT NULL DEFAULT '{}'::jsonb,
            voice         text,
            first_value   jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # One process of a given type per org. The resolver reads by (org_id, type)
    # and must never have to choose between two candidate processes.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS tenant_process_org_type_key "
        "ON public.tenant_process (org_id, type)"
    )

    op.execute(
        "COMMENT ON COLUMN public.tenant_process.stages IS "
        "'[{key, name, description}] - named milestones between signature and go-live.'"
    )
    op.execute(
        "COMMENT ON COLUMN public.tenant_process.touchpoints IS "
        "'[{key, day_offset, purpose, ask}] - when to reach out and what each is for. One ask each.'"
    )
    op.execute(
        "COMMENT ON COLUMN public.tenant_process.escalation IS "
        "'{silence_days, silence_escalate_after, rules:[{when, action, urgency}], notify} - what warrants a human.'"
    )
    op.execute(
        "COMMENT ON COLUMN public.tenant_process.first_value IS "
        "'{label, definition, target_days, evidence, configured} - the milestone that means this "
        "customer got what they bought. configured=false means the tenant has not defined it and "
        "the default placeholder is still in place.'"
    )

    # Seed every existing org. The resolver fails closed, so without this the
    # feature is dark for every org that already exists.
    op.execute(
        """
        INSERT INTO public.tenant_process
            (org_id, type, objective, stages, touchpoints, escalation, voice, first_value)
        SELECT o.id, 'onboarding',
               :objective, :stages::jsonb, :touchpoints::jsonb,
               :escalation::jsonb, :voice, :first_value::jsonb
          FROM public.orgs o
         WHERE NOT EXISTS (
               SELECT 1 FROM public.tenant_process p
                WHERE p.org_id = o.id AND p.type = 'onboarding')
        """.replace(":objective", _lit(DEFAULT_OBJECTIVE))
           .replace(":stages", _lit(DEFAULT_STAGES))
           .replace(":touchpoints", _lit(DEFAULT_TOUCHPOINTS))
           .replace(":escalation", _lit(DEFAULT_ESCALATION))
           .replace(":voice", _lit(DEFAULT_VOICE))
           .replace(":first_value", _lit(DEFAULT_FIRST_VALUE))
    )

    # ---- contacts.role ----------------------------------------------------
    op.execute(
        "DO $do$ BEGIN "
        "CREATE TYPE public.contact_role AS ENUM ("
        "'champion','economic_buyer','executive_sponsor','project_manager',"
        "'technical_lead','billing','end_user','other'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $do$"
    )
    op.execute(
        "ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS role public.contact_role"
    )
    op.execute(
        "COMMENT ON COLUMN public.contacts.role IS "
        "'Who this contact is to the account. Nullable: existing contacts predate it, and a null "
        "role means George may not select this person as a recipient unprompted. Deliberately not "
        "inferred from contacts.title, which is free text.'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.contacts DROP COLUMN IF EXISTS role")
    op.execute("DROP TYPE IF EXISTS public.contact_role")
    op.execute("DROP TABLE IF EXISTS public.tenant_process")
    op.execute("DROP TYPE IF EXISTS public.tenant_process_type")
