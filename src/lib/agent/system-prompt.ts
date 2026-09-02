/**
 * Shared builder for George's system prompt. Used by the chat route, the
 * standing-jobs runner, and the inbound-event processor so the prompt shape
 * never drifts between paths.
 *
 *  - Base instructions:     GEORGE_SYSTEM_PROMPT
 *  - Organization profile:  appended when org row found
 *  - Knowledge manifest:    appended always (path + title only, CLAUDE.md style)
 *  - Autonomous suffix:     appended when `autonomous: true`
 *
 * Knowledge is loaded lazily — no `content_md` here. George fetches docs in
 * full via `mcp__george__read_knowledge_doc(path)` or searches with
 * `mcp__george__search_knowledge(query)`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAutonomousRunPrompt,
  buildGeorgeSystemPromptBase,
  type AutonomousSendPolicy,
  type CompanyIdentity,
} from "./prompt";
import {
  getAgentSettings,
  operatingModeLabel,
  personalityPrompt,
  type AgentSettings,
} from "./agent-settings";
import { renderOperatingModelBlock } from "./operating-model";
import { internalDescription, resolveOrgIdentity } from "./identity";

/**
 * Thrown when an org has not said who it is. Distinct from a generic error so
 * callers can render "this organisation needs a name and domain" rather than
 * a stack trace, and so it is greppable in logs.
 */
export class CompanyIdentityMissingError extends Error {
  constructor(readonly orgId: string, readonly missing: string[]) {
    super(
      `Organisation ${orgId} is missing ${missing.join(" and ")}. George cannot ` +
        `compose as a company he cannot name — set these on the organisation profile.`,
    );
    this.name = "CompanyIdentityMissingError";
  }
}

/**
 * Resolve the company George works for, or refuse.
 *
 * Fails closed on purpose, and it is worth being explicit about why, because
 * the tempting alternative is a fallback string.
 *
 * The base prompt's first sentence is "You are George, an AI teammate working
 * at X". Whatever X is, George will introduce himself that way to customers and
 * sign mail as that company. A default would make a misconfigured org silently
 * inherit someone else's identity — which is precisely the bug this replaces:
 * the name used to be hardcoded to Onyx while GEORGE_ORG_ID pointed at AIX.
 *
 * Refusing is loud, recoverable, and happens before anything is sent. Guessing
 * is quiet and reaches a customer.
 */
export function requireCompanyIdentity(
  orgId: string,
  org: OrgProfile | null,
): CompanyIdentity {
  // display_name is the customer-facing name; `name` is often a slug ("aix").
  const name = org?.display_name?.trim() || org?.name?.trim() || "";
  const domain = org?.domain?.trim().toLowerCase() || "";

  const missing: string[] = [];
  if (!name) missing.push("a name");
  if (!domain) missing.push("a domain");
  if (missing.length) throw new CompanyIdentityMissingError(orgId, missing);

  return { name, domain };
}

type OrgProfile = {
  name?: string | null;
  display_name?: string | null;
  customer_brand_name?: string | null;
  domain?: string | null;
  tagline?: string | null;
  default_timezone?: string | null;
  business_hours?:
    | { start?: string | null; end?: string | null; days?: string[] | null }
    | null;
};

type KnowledgeDoc = {
  path: string;
  title: string | null;
  is_core: boolean;
  concept_type: string | null;
  tags: string[] | null;
};

export type BuildSystemPromptOptions = {
  orgId: string;
  /** When true, appends the autonomous-run suffix at the end. */
  autonomous?: boolean;
  /** Email send policy for autonomous runs. Default "none" (draft-only). */
  emailSendPolicy?: AutonomousSendPolicy;
  /** When set, this conversation is scoped to one customer (the account hub's
   *  "Ask George about <partner>" chat). Appends a "Current account" block so
   *  George knows who the conversation is about without being told. */
  customerId?: string | null;
};

export async function buildGeorgeSystemPrompt(
  admin: SupabaseClient,
  {
    orgId,
    autonomous = false,
    customerId = null,
    emailSendPolicy = "none",
  }: BuildSystemPromptOptions,
): Promise<string> {
  const [orgRes, docsRes, agent] = await Promise.all([
    admin
      .from("orgs")
      .select(
        "name, display_name, customer_brand_name, domain, tagline, default_timezone, business_hours",
      )
      .eq("id", orgId)
      .maybeSingle(),
    admin
      .from("knowledge_docs")
      .select("path, title, is_core, concept_type, tags")
      .eq("org_id", orgId)
      .eq("status", "active") // never surface pending_review proposals in retrieval
      .order("is_core", { ascending: false })
      .order("path"),
    getAgentSettings(admin, orgId),
  ]);

  const identityBlock = await buildIdentityBlock(admin, orgId, agent);
  const operatingBlock = renderOperatingModelBlock(agent.operating_policy);
  const orgBlock = buildOrgBlock((orgRes.data ?? null) as OrgProfile | null);
  const knowledgeBlock = buildKnowledgeBlock(
    (docsRes.data ?? []) as KnowledgeDoc[],
  );
  const accountBlock = await buildAccountBlock(admin, orgId, customerId);
  const signatureBlock = buildSignatureBlock(
    agent,
    (orgRes.data ?? null) as OrgProfile | null,
    (await resolveOrgIdentity(admin, orgId)).address,
  );

  // Before anything else: George must know which company he works for. This
  // throws rather than defaulting — see requireCompanyIdentity.
  const company = requireCompanyIdentity(
    orgId,
    (orgRes.data ?? null) as OrgProfile | null,
  );

  const parts: string[] = [
    buildGeorgeSystemPromptBase(company),
    identityBlock,
    operatingBlock,
    orgBlock,
    accountBlock,
    signatureBlock,
    knowledgeBlock,
  ];
  if (autonomous) parts.push("\n\n" + buildAutonomousRunPrompt(emailSendPolicy));
  return parts.join("");
}

/**
 * The email signature, rendered from this deployment's own values.
 *
 * This used to be a fixed block of HTML inside the base prompt naming Onyx and
 * a colleague's personal address. Onyx was the first deployment, and when George
 * became AIX's own product nobody revisited it — so every draft George wrote
 * signed off as an Onyx teammate contactable at a human's mailbox. A customer
 * reading one would have been told the wrong company and given the wrong
 * address to reply to.
 *
 * Built from the agent record (name, title) and the org profile, so it follows
 * whoever the deployment belongs to. Anything unknown is LEFT OUT rather than
 * guessed: an incomplete signature is a cosmetic problem, a confidently wrong
 * one is a credibility problem.
 */
function buildSignatureBlock(
  agent: AgentSettings,
  org: OrgProfile | null,
  address: string,
): string {
  const company = (org?.display_name || org?.name || "").trim();
  const domain = (org?.domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  const roleLine = [agent.title, company].filter(Boolean).join(" · ");
  const contact = [
    // No address configured means no address printed. Inventing one, or falling
    // back to a colleague's, is how a customer gets told to reply to the wrong
    // person — see the note in identity.ts.
    address ? `<a href="mailto:${address}">${address}</a>` : null,
    domain ? `<a href="https://${domain}">${domain}</a>` : null,
  ]
    .filter(Boolean)
    .join(" · ");


  const html = [
    "<p>Thanks,<br>",
    `<strong>${agent.name}</strong><br>`,
    roleLine ? `${roleLine}<br>` : null,
    contact ? `${contact}</p>` : "</p>",
    '<p style="color:#888;font-size:11px;margin-top:18px;">',
    // "Drafted" was the previous wording and it was not true. This footer only
    // appears on mail George SENDS — when drafting under a human's name the rule
    // above is to drop this paragraph entirely. So "drafted" implied a person had
    // reviewed and sent it, which is precisely the impression the 16 recaps of
    // 2026-08-20 left with fourteen colleagues. Say what happened instead.
    // The previous line said "someone from the {company} team will pick it up",
    // which described the opposite of how this works and contradicted the
    // signature immediately above it: the signature gives George's own
    // address, and George reads what comes back. Telling a customer their
    // reply goes to a team is both untrue and a reason not to reply properly.
    //
    // The second clause is what keeps it honest: replies reach George, and a
    // person still decides anything that needs deciding.
    "Written and sent by an AI teammate, not a person. Reply to this email and it " +
      `comes back to ${agent.name} — a person here picks up anything that needs a decision.`,
    "</p>",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "\n\n## Email signature",
    "",
    "End every draft with exactly this, changing nothing:",
    "",
    "```html",
    html,
    "```",
    "",
    "If you are drafting on behalf of a named human, swap the first two lines for",
    "their name and title, drop the grey paragraph, and say so in chat.",
  ].join("\n");
}

/**
 * Agent identity overlay — the editable employee record from /settings/agent.
 * Customises name, title, bio, tone, default mode, and human owner. It is
 * deliberately ADDITIVE: it can change who George *is* and how he *sounds*, but
 * it must never relax an operating rule. The closing line restates that so a
 * future edit to copy can't quietly imply otherwise.
 */
async function buildIdentityBlock(
  admin: SupabaseClient,
  orgId: string,
  agent: AgentSettings,
): Promise<string> {
  type Owner = { full_name: string | null; email: string | null };
  let owner: Owner | null = null;
  if (agent.owner_user_id) {
    const { data } = await admin
      .from("org_members")
      .select("full_name, email")
      .eq("org_id", orgId)
      .eq("user_id", agent.owner_user_id)
      .maybeSingle();
    owner = (data as Owner | null) ?? null;
  }

  // WHICH DOMAINS ARE INTERNAL, STATED.
  //
  // De-hardcoding @aixccelerate.com out of the prompts left George knowing the
  // RULE ("internal recipients are fine") without the ANSWER (which domains
  // those are). In chat it then did the safe thing — assumed approval was
  // needed and offered to request it — for an address that was already
  // internal and would have sent fine. Correct caution, missing information.
  const identity = await resolveOrgIdentity(admin, orgId);

  const lines: string[] = [
    `- Name: ${agent.name}`,
    `- Title: ${agent.title}`,
    `- Internal addresses for this organisation: ${internalDescription(identity)}. Anyone else is external.`,
  ];
  if (identity.address) {
    lines.push(`- Your own address: ${identity.address}`);
  }
  if (agent.bio) lines.push(`- Bio: ${agent.bio}`);
  if (owner) {
    const who = [owner.full_name, owner.email].filter(Boolean).join(" · ");
    if (who) {
      lines.push(
        `- Reports to (human owner / escalation contact): ${who}. When a task needs human sign-off, a send authority you don't have, or a judgement call above your remit, this is who you escalate to.`,
      );
    }
  }
  lines.push(
    `- Default operating mode: ${operatingModeLabel(agent.operating_mode)}` +
      (agent.operating_mode === "assistant"
        ? " (prepare/draft/surface; a human reviews and acts unless told otherwise)"
        : " (execute end-to-end and report back; a human post-reviews on cadence)"),
  );
  lines.push(`- Tone preset: ${personalityPrompt(agent.personality)}`);
  if (agent.knowledge_reviewers.length) {
    lines.push(
      `- Knowledge reviewers: ${agent.knowledge_reviewers.join(", ")}. These people review your proposed knowledge on a weekly cadence; address the weekly knowledge-review digest to them.`,
    );
  }

  return (
    "\n\n# Agent identity (configured for this org)\n\n" +
    "These settings define who you are and how you sound for this organization. " +
    `They take precedence over the default name, title, and tone mentioned ` +
    `above — sign emails as **${agent.name}, ${agent.title}** (keep the mailbox ` +
    "address and the AI-teammate disclaimer line in the signature unchanged).\n\n" +
    lines.join("\n") +
    "\n\nThese identity and tone settings do NOT override any of your operating " +
    "rules or safety policies — draft-never-send, route-don't-invent, no SKU or " +
    "pricing invention, and the tool allowlist all remain in force exactly as " +
    "written above. Personality changes your wording, never your guardrails."
  );
}

/**
 * "Current account" block — appended when a conversation is scoped to one
 * customer so George opens already knowing who it's about. He should still use
 * the tools (get_customer, list_objectives, get_thread) for live detail; this
 * is just the anchor so he doesn't have to ask "which customer?".
 */
async function buildAccountBlock(
  admin: SupabaseClient,
  orgId: string,
  customerId: string | null,
): Promise<string> {
  if (!customerId) return "";
  const { data } = await admin
    .from("customers")
    .select("id, name, domain, lifecycle, customer_kind, industry")
    .eq("org_id", orgId)
    .eq("id", customerId)
    .maybeSingle();
  if (!data) return "";
  const c = data as {
    id: string;
    name: string;
    domain: string | null;
    lifecycle: string;
    customer_kind: string;
    industry: string | null;
  };
  const lines = [
    `- Name: ${c.name}`,
    `- Customer id: \`${c.id}\` (use this with get_customer / list_objectives / create_objective)`,
    `- Kind: ${c.customer_kind}`,
    `- Lifecycle: ${c.lifecycle}`,
    c.domain ? `- Domain: ${c.domain}` : null,
    c.industry ? `- Industry: ${c.industry}` : null,
  ].filter(Boolean);
  return (
    "\n\n# Current account\n\nThis conversation is about the following customer. " +
    "Assume questions and actions are about them unless told otherwise; call " +
    "`get_customer` for the full picture (contacts, objectives, plan, health).\n\n" +
    lines.join("\n")
  );
}

export function buildOrgBlock(org: OrgProfile | null): string {
  if (!org) return "";
  const lines: string[] = [];
  const display = org.display_name ?? org.name;
  if (display) lines.push(`- Display name: ${display}`);
  if (org.name && org.name !== display) lines.push(`- Legal name: ${org.name}`);
  if (org.customer_brand_name) {
    lines.push(`- Customer-facing brand: ${org.customer_brand_name}`);
  }
  if (org.domain) lines.push(`- Primary domain: ${org.domain}`);
  if (org.tagline) lines.push(`- Tagline: ${org.tagline}`);
  if (org.default_timezone) {
    lines.push(`- Default timezone: ${org.default_timezone}`);
  }
  const bh = org.business_hours;
  if (bh && (bh.start || bh.end || (bh.days && bh.days.length))) {
    const range =
      bh.start && bh.end ? `${bh.start}–${bh.end}` : bh.start ?? bh.end ?? "—";
    const days = bh.days && bh.days.length ? bh.days.join(", ") : "any day";
    lines.push(`- Business hours: ${range} (${days})`);
  }
  if (!lines.length) return "";
  return (
    "\n\n# Organization profile\n\nUse these facts when introducing the company or writing customer-facing copy. Prefer the customer-facing brand name in outbound emails; reserve the legal name for contracts and formal documents.\n\n" +
    lines.join("\n")
  );
}

export function buildKnowledgeBlock(docs: KnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const fmt = (d: KnowledgeDoc) => {
    const meta: string[] = [];
    if (d.concept_type) meta.push(d.concept_type);
    if (d.tags && d.tags.length) meta.push(d.tags.map((t) => `#${t}`).join(" "));
    const suffix = meta.length ? `  _(${meta.join(" · ")})_` : "";
    return `- \`${d.path}\` — ${d.title ?? "(untitled)"}${suffix}`;
  };
  const core = docs.filter((d) => d.is_core);
  const supp = docs.filter((d) => !d.is_core);
  const sections: string[] = [
    "# Knowledge base — hybrid RAG policy",
    "",
    "Below is the manifest of every knowledge doc available to you for this org.",
    "Two retrieval tools, two distinct contracts — follow them strictly:",
    "",
    "- **Core playbooks** (listed first) carry your role, scope, lifecycle, and",
    "  process rules. Accuracy here must be exact. They are NOT in vector search.",
    "  For any question touching role / scope / rules / lifecycle / process,",
    "  fetch the relevant core doc whole with",
    "  `mcp__george__read_knowledge_doc(path)` and quote it directly. Never",
    "  paraphrase or summarise a core rule from memory.",
    "",
    "- **Supplemental** docs (niche playbooks, reference material) are chunked",
    "  and embedded. Use `mcp__george__search_knowledge(query)` when you don't",
    "  know which supplemental doc has the answer. You can still fetch a",
    "  supplemental doc whole with `read_knowledge_doc(path)` if a chunk is",
    "  insufficient context.",
    "",
    "If you're unsure whether a question is core or supplemental, treat it as",
    "core and `read_knowledge_doc` the most likely core file.",
  ];
  if (core.length > 0) {
    sections.push(
      "",
      "## Core playbook — fetch whole via `read_knowledge_doc(path)`",
      "",
      core.map(fmt).join("\n"),
    );
  }
  if (supp.length > 0) {
    sections.push(
      "",
      "## Supplemental — searchable via `search_knowledge(query)`",
      "",
      supp.map(fmt).join("\n"),
    );
  }
  return "\n\n" + sections.join("\n");
}
