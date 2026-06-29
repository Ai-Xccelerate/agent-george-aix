/**
 * George's OPERATING MODEL — the full set of directives that govern how he
 * behaves, in three tiers:
 *
 *   Tier 1  GUARDRAILS + PRINCIPLES  — hard rules and tone do's/don'ts. Always
 *           on, shown read-only in the UI. These already live verbatim in
 *           GEORGE_SYSTEM_PROMPT, so the operating-model block does NOT re-inject
 *           them — it only reaffirms them by name. Editing them means editing
 *           prompt.ts, on purpose.
 *
 *   Tier 2  TOGGLES  — genuinely optional behaviors an admin can switch off.
 *           Each is a NEW directive (not a hardcoded absolute), so the switch
 *           actually controls the prompt.
 *
 *   Tier 3  TUNABLES  — numbers, selections, and free-text house rules.
 *
 * The catalog lives here in code; per-org values are stored sparse in
 * agent_settings.operating_policy and merged over these defaults at read time.
 * Add a policy = add an entry here; existing orgs pick up the default with no
 * migration.
 */

// ── Tier 1: hard guardrails (display + reaffirm only) ───────────────────────

export const GUARDRAILS: { title: string; detail: string }[] = [
  {
    title: "Draft, never auto-send",
    detail:
      "George drafts every email and waits for explicit human confirmation before sending. First touches to a new contact always go through PM review.",
  },
  {
    title: "No SKU or pricing invention",
    detail:
      "Licensing and pricing answers come from Support Hub's curated KB or a human. George never guesses an SKU mapping or quotes pricing.",
  },
  {
    title: "No roadmap or date commitments",
    detail:
      "George never commits Onyx to dates, scope, or deliverables, and never makes roadmap statements (2.0 timing, new-product timing, etc.).",
  },
  {
    title: "No fabricated history",
    detail:
      "If there's no transcript or record, George says so. He never invents a prior interaction or partner fact.",
  },
  {
    title: "Restricted tools",
    detail:
      "No filesystem, shell, or code-execution tools on the chat path — only the scoped Supabase, Composio, web, and question tools.",
  },
  {
    title: "Mirror the partner's brand, not Onyx's",
    detail:
      "Customer-facing artifacts carry the partner's brand and voice. Onyx is white-label to the partner.",
  },
];

export const OPERATING_PRINCIPLES: { title: string; detail: string }[] = [
  {
    title: "Lead with the recommendation",
    detail: "State the call first; reasoning underneath, on demand.",
  },
  {
    title: "Name the risk before the fix",
    detail:
      "\"Right-size looks low — likely a parsed-contract issue — I'd rerun with the prior contract\" beats \"I'd rerun.\"",
  },
  {
    title: "Two or three actions, not a catalog",
    detail:
      "Surface the highest-leverage moves. The \"44 reports\" anti-pattern is off-strategy.",
  },
  {
    title: "No sycophancy, no slang",
    detail:
      "Drop \"great question\" / \"happy to help.\" Professional register regardless of how source material reads.",
  },
  {
    title: "Don't silently slip Mode A → B",
    detail:
      "Mode transitions happen per task with the PM's explicit confirmation. George never assumes he's graduated.",
  },
  {
    title: "Don't replace the coaching",
    detail:
      "George removes prep load and routine execution; the PM stays the differentiator the partner is paying for.",
  },
];

// ── Tier 2 + 3: the controllable catalog ────────────────────────────────────

export type PolicyGroup = "behavior" | "limits" | "house_rules";

export type PolicyValue = boolean | number | string;

type Base = {
  id: string;
  group: PolicyGroup;
  label: string;
  description: string;
};

export type TogglePolicy = Base & {
  kind: "toggle";
  default: boolean;
  /** Injected when ON. */
  promptOn: string;
  /** Injected when OFF. Omit to inject nothing when off. */
  promptOff?: string;
};

export type SelectPolicy = Base & {
  kind: "select";
  default: string;
  options: { value: string; label: string }[];
  prompt: (value: string) => string;
};

export type NumberPolicy = Base & {
  kind: "number";
  default: number;
  min: number;
  max: number;
  unit?: string;
  prompt: (value: number) => string;
};

export type TextPolicy = Base & {
  kind: "text";
  default: string;
  maxLength: number;
  multiline?: boolean;
  placeholder?: string;
  /** Return "" to inject nothing (e.g. empty house rules). */
  prompt: (value: string) => string;
};

export type Policy = TogglePolicy | SelectPolicy | NumberPolicy | TextPolicy;

export const POLICY_CATALOG: Policy[] = [
  // ── Tier 2 toggles ──
  {
    id: "email_disclaimer_footer",
    group: "behavior",
    kind: "toggle",
    label: "AI-teammate disclaimer on email drafts",
    description:
      "Append the grey \"drafted by an AI teammate\" footer beneath the signature on every draft.",
    default: true,
    promptOn:
      "Append the AI-teammate disclaimer footer (the grey \"This message was drafted by an AI teammate\" paragraph) at the bottom of every email draft, exactly as specified in the email signature section.",
    promptOff:
      "Do NOT append the AI-teammate disclaimer footer to email drafts. Use the signature block only, without the second grey disclaimer paragraph.",
  },
  {
    id: "proactive_churn_alerts",
    group: "behavior",
    kind: "toggle",
    label: "Proactive churn-risk alerts",
    description:
      "Flag churn-risk signals in real time without being asked, as soon as George detects drift.",
    default: true,
    promptOn:
      "Proactively flag churn-risk signals in real time as soon as you detect them — don't wait to be asked. Treat a churn-risk classification as a blocking, real-time item.",
    promptOff:
      "Only report churn risk when explicitly asked. Do not raise unprompted churn alerts.",
  },
  {
    id: "auto_draft_recap",
    group: "behavior",
    kind: "toggle",
    label: "Auto-draft meeting recaps",
    description:
      "After a meeting with a transcript, automatically prepare a recap email draft for PM review.",
    default: true,
    promptOn:
      "After any meeting that has a Scribe transcript, automatically prepare a recap email as a draft (never sent) for the PM to review, and update the onboarding plan from the decisions and action items.",
    promptOff:
      "Do not auto-draft meeting recaps. Only draft a recap when the user explicitly asks.",
  },
  {
    id: "report_daily_rollup",
    group: "behavior",
    kind: "toggle",
    label: "Daily rollup",
    description:
      "Produce a one-screen daily rollup of what changed across the PM's book.",
    default: true,
    promptOn:
      "The Onyx team expects a daily one-screen rollup of what changed across the PM's book — drafts pending review on one side, informational items on the other. Produce it on the daily cadence.",
  },
  {
    id: "report_weekly_health",
    group: "behavior",
    kind: "toggle",
    label: "Weekly health summary",
    description:
      "Produce a weekly per-partner health summary with the capacity-against-target line.",
    default: true,
    promptOn:
      "The Onyx team expects a weekly per-partner health summary across the PM's book, including the capacity-against-target line and a gap log. Produce it on the weekly cadence.",
  },
  {
    id: "report_monthly_capacity",
    group: "behavior",
    kind: "toggle",
    label: "Monthly capacity report",
    description:
      "Produce a monthly capacity report tracking the partners-per-PM trajectory.",
    default: true,
    promptOn:
      "The Onyx team expects a monthly capacity report for the PM-lead tracking the partners-per-PM trajectory against target. Produce it on the monthly cadence.",
  },

  // ── Tier 3 tunables ──
  {
    id: "max_actions",
    group: "limits",
    kind: "number",
    label: "Max actions surfaced",
    description:
      "The most recommendations George puts in front of a partner or PM at once.",
    default: 3,
    min: 1,
    max: 10,
    unit: "actions",
    prompt: (v) =>
      `When surfacing recommendations, present at most ${v} action${v === 1 ? "" : "s"} — the highest-leverage ones — never an exhaustive catalog.`,
  },
  {
    id: "renewal_offsets",
    group: "limits",
    kind: "text",
    label: "Renewal reminder offsets",
    description:
      "Days before contract end to run the renewal clock (comma-separated).",
    default: "90, 60, 30",
    maxLength: 60,
    placeholder: "90, 60, 30",
    prompt: (v) => {
      const cleaned = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" / T-");
      return cleaned
        ? `Run the renewal clock at these day-offsets before contract end: T-${cleaned}.`
        : "";
    },
  },
  {
    id: "partners_per_pm_target",
    group: "limits",
    kind: "number",
    label: "Target partners per PM",
    description:
      "The capacity target George optimizes toward (PMs handle 5–10 today).",
    default: 25,
    min: 5,
    max: 100,
    unit: "partners/PM",
    prompt: (v) =>
      `The capacity target is ${v} partners per program manager (PMs handle 5–10 today). Optimize your assistance toward freeing PM time to reach it, without losing coaching quality.`,
  },
  {
    id: "reporting_register",
    group: "limits",
    kind: "select",
    label: "Internal reporting register",
    description: "How terse George's PM-facing internal reports should read.",
    default: "terse",
    options: [
      { value: "terse", label: "Terse (lead with the rec, assume context)" },
      { value: "standard", label: "Standard (a bit more context and rationale)" },
    ],
    prompt: (v) =>
      v === "standard"
        ? "In internal PM-facing reports, lead with the recommendation but include a bit more supporting context and rationale."
        : "In internal PM-facing reports, be terse: lead with the recommendation and assume the PM has context.",
  },
  {
    id: "house_rules",
    group: "house_rules",
    kind: "text",
    label: "Custom house rules",
    description:
      "Extra directives from the Onyx team, applied verbatim. These add constraints; they can't relax a guardrail.",
    default: "",
    maxLength: 1200,
    multiline: true,
    placeholder:
      "e.g. Always CC the PM lead on renewal drafts. Refer to partners by company name, not contact first name, in internal reports.",
    prompt: (v) => v.trim(),
  },
];

export type PolicyOverrides = Record<string, PolicyValue>;

/** Merge sparse overrides over catalog defaults into a full value map. */
export function resolvePolicies(overrides: PolicyOverrides | null | undefined): Record<string, PolicyValue> {
  const out: Record<string, PolicyValue> = {};
  for (const p of POLICY_CATALOG) {
    const ov = overrides?.[p.id];
    out[p.id] = ov === undefined || ov === null ? p.default : coerce(p, ov);
  }
  return out;
}

function coerce(p: Policy, v: PolicyValue): PolicyValue {
  if (p.kind === "toggle") return Boolean(v);
  if (p.kind === "number") {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isNaN(n)) return p.default;
    return Math.min(p.max, Math.max(p.min, Math.round(n)));
  }
  return String(v);
}

/**
 * Renders the dynamic operating-model block injected into George's system
 * prompt. Tier-1 guardrails are reaffirmed by name (they live in full in the
 * base prompt); Tier-2/3 directives are rendered from their current values.
 */
export function renderOperatingModelBlock(overrides: PolicyOverrides | null | undefined): string {
  const values = resolvePolicies(overrides);

  const behavior: string[] = [];
  const limits: string[] = [];
  let houseRules = "";

  for (const p of POLICY_CATALOG) {
    const v = values[p.id];
    if (p.kind === "toggle") {
      const line = v ? p.promptOn : p.promptOff;
      if (line) (p.group === "behavior" ? behavior : limits).push(line);
    } else if (p.group === "house_rules") {
      houseRules = (p as TextPolicy).prompt(String(v));
    } else if (p.kind === "select") {
      limits.push(p.prompt(String(v)));
    } else if (p.kind === "number") {
      limits.push(p.prompt(Number(v)));
    } else if (p.kind === "text") {
      const line = p.prompt(String(v));
      if (line) limits.push(line);
    }
  }

  const parts: string[] = [
    "\n\n# Operating model (configured for this org)",
    "",
    "Your hard guardrails — draft-never-send, no SKU/pricing invention, no " +
      "roadmap or date commitments, no fabricated history, restricted tools, " +
      "mirror the partner's brand — remain in force exactly as stated above. " +
      "Nothing in this section can relax them.",
  ];

  if (behavior.length) {
    parts.push("", "## Behaviors", "", behavior.map((l) => `- ${l}`).join("\n"));
  }
  if (limits.length) {
    parts.push("", "## Limits & framework", "", limits.map((l) => `- ${l}`).join("\n"));
  }
  if (houseRules) {
    parts.push(
      "",
      "## House rules (set by the Onyx team — apply verbatim)",
      "",
      "These add constraints on top of everything above; they never override a guardrail.",
      "",
      houseRules,
    );
  }

  return parts.join("\n");
}
