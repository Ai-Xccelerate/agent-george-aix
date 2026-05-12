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
};

export type BuildSystemPromptOptions = {
  orgId: string;
  /** When true, appends GEORGE_AUTONOMOUS_RUN_PROMPT at the end. */
  autonomous?: boolean;
};

export async function buildGeorgeSystemPrompt(
  admin: SupabaseClient,
  { orgId, autonomous = false }: BuildSystemPromptOptions,
): Promise<string> {
  const [orgRes, docsRes] = await Promise.all([
    admin
      .from("orgs")
      .select(
        "name, display_name, customer_brand_name, domain, tagline, default_timezone, business_hours",
      )
      .eq("id", orgId)
      .maybeSingle(),
    admin
      .from("knowledge_docs")
      .select("path, title, is_core")
      .eq("org_id", orgId)
      .order("is_core", { ascending: false })
      .order("path"),
  ]);

  const orgBlock = buildOrgBlock((orgRes.data ?? null) as OrgProfile | null);
  const knowledgeBlock = buildKnowledgeBlock(
    (docsRes.data ?? []) as KnowledgeDoc[],
  );

  const parts: string[] = [GEORGE_SYSTEM_PROMPT, orgBlock, knowledgeBlock];
  if (autonomous) parts.push("\n\n" + GEORGE_AUTONOMOUS_RUN_PROMPT);
  return parts.join("");
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
  const fmt = (d: KnowledgeDoc) =>
    `- \`${d.path}\` — ${d.title ?? "(untitled)"}`;
  const core = docs.filter((d) => d.is_core);
  const supp = docs.filter((d) => !d.is_core);
  const sections: string[] = [
    "# Knowledge base — read on demand",
    "",
    "Below is the manifest of every knowledge doc available to you for this org.",
    "Fetch any one in full with `mcp__george__read_knowledge_doc(path)`. When you",
    "don't know which doc has the answer, use `mcp__george__search_knowledge(query)`",
    "to find relevant chunks across the whole KB. Treat fetched docs as authoritative",
    "and quote them directly rather than paraphrasing loosely.",
  ];
  if (core.length > 0) {
    sections.push(
      "",
      "## Core playbook (read these first for role / process / lifecycle questions)",
      "",
      core.map(fmt).join("\n"),
    );
  }
  if (supp.length > 0) {
    sections.push(
      "",
      "## Supplemental (niche playbooks, reference material)",
      "",
      supp.map(fmt).join("\n"),
    );
  }
  return "\n\n" + sections.join("\n");
}
