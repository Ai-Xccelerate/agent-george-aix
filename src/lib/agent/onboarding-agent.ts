/**
 * The onboarding sub-agent.
 *
 * WHY A SUB-AGENT AND NOT A PROMPT FLAG
 * Tool grants used to be withheld by filtering the allowlist at the call site
 * (run-autonomous.ts), which works but scales badly: every new autonomous path
 * has to remember to filter, and forgetting is silent. An AgentDefinition
 * carries its own grant, so a capability belongs to an agent rather than to
 * whoever remembered.
 *
 * The blast radius is the point. This agent gets a small, named list; every
 * other autonomous path keeps tool-absence, which is a guarantee rather than an
 * instruction. That principle is also why the send tool is NOT in the list —
 * see the note above ONBOARDING_AGENT_TOOLS.
 *
 * WHAT IT IS NOT ALLOWED TO DECIDE
 * It does not decide what happened — onboarding-state.ts does that in code and
 * hands it over as a finding. It does not decide who to write to — the recipient
 * is resolved from the account record and passed in. It writes the email.
 */
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { TenantProcess, ProcessTouchpoint } from "./tenant-process";
import type { OnboardingAssessment } from "./onboarding-state";
import { renderOnboardingStateBlock } from "./onboarding-state";

export const ONBOARDING_AGENT_NAME = "onboarding";

/**
 * The tools this agent may use, named deliberately rather than inherited.
 *
 * Listing them out is the mechanism, not documentation: AgentDefinition.tools
 * omitted means "inherit everything from the parent", which would hand the
 * onboarding agent the whole surface including tools that have nothing to do
 * with onboarding. A short explicit list is what keeps the grant small enough
 * to reason about.
 */
export const ONBOARDING_AGENT_TOOLS = [
  // Read the account.
  "mcp__george__get_customer",
  "mcp__george__list_onboarding_steps",
  "mcp__george__list_objectives",
  "mcp__george__get_email_thread",
  // Read the playbook.
  "mcp__george__search_knowledge",
  "mcp__george__read_knowledge_doc",
  // Move the account forward.
  "mcp__george__create_onboarding_plan",
  "mcp__george__update_onboarding_step",
  "mcp__george__create_objective",
  "mcp__george__update_objective",
  "mcp__george__record_health_check",
  // Say one thing, and put it in front of a human.
  "mcp__george__draft_email",
  "mcp__george__draft_email_reply",
  "mcp__george__raise_decision",
];

/**
 * DELIBERATELY ABSENT: mcp__george__send_email_draft.
 *
 * An earlier version of this list held it, on the reasoning that the capability
 * should be scoped to one agent rather than to a code path. That reasoning is
 * right about where the grant belongs and wrong about when to make it.
 *
 * In F1 every send goes through human approval: this agent drafts, raises a
 * decision carrying the draft, and a person approves it — the send happens in
 * the approval action, not in an agent turn. So granting the tool here would
 * mean holding a capability the agent is instructed not to use, which is
 * precisely the 2026-08-20 shape: a restraint that lives in a prompt rather
 * than in what the agent can reach. Prompts are advisory. Absent tools are not.
 *
 * Add it here — and only here — when the approval gate relaxes and this agent
 * is genuinely the thing doing the sending.
 */

/**
 * Which tone instruction wins, and why.
 *
 * PRECEDENCE, IN CODE RATHER THAN IN A COMMIT MESSAGE
 *
 *   tenant_process.voice  >  agent_settings.personality  >  nothing
 *
 * `personality` is how George sounds everywhere — chat, internal notes,
 * escalations. `voice` is how this tenant wants their *customers* written to
 * during onboarding. When both exist they are not in competition on equal
 * terms: one is a house style and the other is a specific instruction about a
 * specific audience, and the specific instruction wins.
 *
 * Scoped to this agent deliberately. A tenant setting an onboarding voice is not
 * asking George to answer internal chat differently, and letting `voice` leak
 * into the base prompt would make a customer-facing tone setting silently change
 * how George talks to his own colleagues.
 */
export function resolveOnboardingVoice(
  processVoice: string | null,
  personalityPrompt: string | null,
): { instruction: string; source: "process_voice" | "agent_personality" | "none" } {
  if (processVoice && processVoice.trim()) {
    return { instruction: processVoice.trim(), source: "process_voice" };
  }
  if (personalityPrompt && personalityPrompt.trim()) {
    return { instruction: personalityPrompt.trim(), source: "agent_personality" };
  }
  return { instruction: "", source: "none" };
}

export type OnboardingAgentInput = {
  process: TenantProcess;
  assessment: OnboardingAssessment;
  /** The touchpoint being written, if this run is writing one. */
  touchpoint: ProcessTouchpoint | null;
  /** Resolved from the account record. Never inferred — see the prompt below. */
  recipient: { email: string; name: string | null; role: string } | null;
  /** Account facts from buildAccountBlock, passed through unchanged. */
  accountBlock: string;
  /** From agent_settings, used only when the process states no voice. */
  personalityPrompt: string | null;
  /** Whether a human has to approve before anything leaves. True in F1. */
  requireApproval: boolean;
};

function renderProcessBlock(p: TenantProcess): string {
  const stages = p.stages.map((s, i) => `  ${i + 1}. ${s.name} — ${s.description}`).join("\n");
  const touchpoints = p.touchpoints
    .map((t) => `  - day ${t.day_offset} · ${t.key} · ${t.purpose} · the ask: ${t.ask}`)
    .join("\n");
  const rules = p.escalation.rules.map((r) => `  - ${r.when} → ${r.action} (${r.urgency})`).join("\n");

  return [
    "# This tenant's onboarding process",
    "",
    `Objective: ${p.objective}`,
    "",
    "Stages:",
    stages,
    "",
    "Touchpoints:",
    touchpoints,
    "",
    `Silence: no reply for ${p.escalation.silence_days} days counts as silent; escalate after ${p.escalation.silence_escalate_after}.`,
    rules ? "Escalate when:\n" + rules : "",
    "",
    p.firstValue.configured
      ? `First value for this tenant: **${p.firstValue.label}** — ${p.firstValue.definition} ` +
        `Target: day ${p.firstValue.target_days}. Evidence: ${p.firstValue.evidence}`
      : "First value: NOT DEFINED by this tenant. See the warning below.",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderRecipientBlock(r: OnboardingAgentInput["recipient"]): string {
  if (!r) {
    return [
      "# Recipient",
      "",
      "**There is no resolved recipient for this account.** Do not choose one. Do not read a",
      "name out of a transcript, an email thread, a contact's job title, or the customer's",
      "domain. Raise a decision asking for the right contact to be added with a role, and",
      "stop. Assembling a recipient list from content is exactly what caused the 2026-08-20",
      "incident.",
    ].join("\n");
  }
  return [
    "# Recipient",
    "",
    `Write to: ${r.name ? `${r.name} <${r.email}>` : r.email}`,
    `Their role on this account: ${r.role}`,
    "",
    "This was resolved from the account record. Do not add recipients, do not cc anyone who",
    "is not named here, and do not substitute somebody who appears in a thread or a",
    "transcript. If you believe a different person should receive this, raise a decision",
    "saying so rather than acting on it.",
  ].join("\n");
}

/**
 * Compose the sub-agent.
 *
 * The prompt is assembled from the tenant's process, the computed state, and the
 * account — in that order, because that is the order of authority: what this
 * tenant does, what is true of this account, and only then the general facts.
 */
export function buildOnboardingAgent(input: OnboardingAgentInput): AgentDefinition {
  const voice = resolveOnboardingVoice(input.process.voice, input.personalityPrompt);

  const touchpointBlock = input.touchpoint
    ? [
        "# The touchpoint you are writing",
        "",
        `Key: ${input.touchpoint.key} (day ${input.touchpoint.day_offset} of the process)`,
        `Its purpose: ${input.touchpoint.purpose}`,
        `Its ask: ${input.touchpoint.ask}`,
        "",
        "The touchpoint says what this contact is FOR. The account state says what to write.",
        "Where they disagree, the state wins — a day-7 access check sent to somebody who has",
        "not replied in nine days is the wrong email, however faithfully it follows the plan.",
      ].join("\n")
    : "";

  const approvalBlock = input.requireApproval
    ? [
        "# Nothing you write is sent by you",
        "",
        "Draft the email, then raise a decision carrying that draft so a human can read it",
        "and approve it. What they approve is what will be sent, unchanged, so the draft must",
        "be finished — not a sketch, not a description of what you would write.",
        "",
        "Do not send. Do not describe the email in the decision instead of drafting it.",
      ].join("\n")
    : "";

  const prompt = [
    "You are George, writing one onboarding email for one customer.",
    "",
    "You are not running a sequence. Somebody at a company is partway through starting to",
    "use a product they have paid for, and your job is to move that forward by one step and",
    "then listen. The email is one step in five: read the state, decide what moves it, say",
    "one thing, listen, update the record.",
    "",
    renderProcessBlock(input.process),
    "",
    renderOnboardingStateBlock(input.assessment).trim(),
    "",
    touchpointBlock,
    "",
    renderRecipientBlock(input.recipient),
    "",
    input.accountBlock.trim(),
    "",
    "# Hide the machinery, keep the facts",
    "",
    "Everything above is why you are writing. The customer gets the conclusion, not the working.",
    "But the conclusion is about *their* account, and it has to sound like it.",
    "",
    "Two different things, and only one of them is forbidden.",
    "",
    "**Internal vocabulary — never appears.** The state name or that a state was assessed at",
    "all; the touchpoint key or its stated purpose; day numbers as labels; stage names,",
    "process steps, escalation rules and first-value definitions used as terms; the fact that",
    "this is a scheduled contact rather than you deciding to write; anything about what",
    "usually happens at this point with other customers.",
    "",
    "**The facts underneath — required.** Dates, milestones, what they committed to, who owes",
    "what, and what is actually blocking them. These are the customer's own circumstances.",
    "They are not machinery, and stripping them is not discretion — it produces an email that",
    "could have been sent to anybody, which is the thing that reads as software.",
    "",
    "The distinction is how a colleague would say it, not whether it gets said:",
    "",
    "- \"You are at the day-7 mark\" is machinery. \"You go live on 25 September and we need",
    "  accounts provisioned before then\" is the same fact, said by a person.",
    "- \"first_value is not yet confirmed\" is machinery. \"You mentioned wanting the first",
    "  campaign out before the end of the month\" is the same fact, said by a person.",
    "- \"An objective is blocked on your side\" is machinery. \"You were waiting on IT to open",
    "  the firewall — did that come through?\" is the same fact, said by a person.",
    "",
    "The test for vocabulary: every sentence still makes sense to somebody who has never heard",
    "of the process and does not know George is following one.",
    "",
    "**The test for substance: at least one thing in this email must be true only of this account.**",
    "A date, a milestone, a named blocker, or something they told you. If you could send the",
    "same words to a different customer without changing them, it is not finished. Use their",
    "words for their own commitments, not your labels.",
    "",
    "# How to write it",
    "",
    "- **One ask, with a date.** Three requests gets zero replies; one gets an answer, and",
    "  the answer is the point. If two things are needed, ask for the one that unblocks the",
    "  other and keep the second for the reply.",
    "- Short enough to answer from a phone. No recap of what they already know.",
    "- No status-update requests that the account record already answers. Asking someone to",
    "  confirm something you can see is how George reads as software.",
    "- Never promise a date, a price, a discount, a contractual term, or a roadmap item.",
    "  Those are decisions a person makes — raise one instead.",
    voice.instruction ? `- Voice (${voice.source.replace("_", " ")}): ${voice.instruction}` : "",
    "",
    approvalBlock,
    "",
    "# When you are finished",
    "",
    "Update what you learned into the record — step status, a new objective with an owner",
    "and a due date, a health check — rather than leaving it in prose. The next run reads",
    "the record, not your summary.",
  ]
    .filter((s) => s !== "")
    .join("\n");

  return {
    description:
      "Writes one onboarding email for one customer, from the tenant's onboarding process " +
      "and the current state of the account. Drafts and escalates; it does not send — a " +
      "human approves the draft and the approval performs the send.",
    prompt,
    tools: ONBOARDING_AGENT_TOOLS,
    // Reuses the parent's registered George server rather than standing up its
    // own: same tools, same org scoping, same audit actor.
    mcpServers: ["george"],
  };
}
