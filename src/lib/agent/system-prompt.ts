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
import { GEORGE_AUTONOMOUS_RUN_PROMPT, GEORGE_SYSTEM_PROMPT } from "./prompt";
import {
  getAgentSettings,
  operatingModeLabel,
  personalityPrompt,
  type AgentSettings,
} from "./agent-settings";
import { renderOperatingModelBlock } from "./operating-model";

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
  /** When true, appends GEORGE_AUTONOMOUS_RUN_PROMPT at the end. */
  autonomous?: boolean;
  /** When set, this conversation is scoped to one customer (the account hub's
   *  "Ask George about <partner>" chat). Appends a "Current account" block so
   *  George knows who the conversation is about without being told. */
  customerId?: string | null;
};

export async function buildGeorgeSystemPrompt(
  admin: SupabaseClient,
  { orgId, autonomous = false, customerId = null }: BuildSystemPromptOptions,
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

  const parts: string[] = [
    GEORGE_SYSTEM_PROMPT,
    identityBlock,
    operatingBlock,
    orgBlock,
    accountBlock,
    knowledgeBlock,
  ];
  if (autonomous) parts.push("\n\n" + GEORGE_AUTONOMOUS_RUN_PROMPT);
  return parts.join("");
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

  const lines: string[] = [
    `- Name: ${agent.name}`,
    `- Title: ${agent.title}`,
  ];
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
