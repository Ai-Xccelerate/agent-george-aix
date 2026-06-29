/**
 * Agent identity / configuration — the editable "employee record" for George,
 * stored per org in `agent_settings` and edited from /settings/agent.
 *
 * This is an ADDITIVE overlay on GEORGE_SYSTEM_PROMPT: it customises identity
 * and tone. It does NOT — and must never — override the locked operating rules
 * (draft-never-send, no SKU invention, the tool allowlist). Those live in code.
 *
 * Shared by the settings page (read + edit) and the system-prompt builder
 * (read), so the field set never drifts between the two.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PolicyOverrides } from "./operating-model";

export const AGENT_SLUG = "george" as const;

export type Personality = "concise_direct" | "warm_consultative" | "formal";
export type OperatingMode = "assistant" | "operator";

export type AgentSettings = {
  name: string;
  title: string;
  bio: string | null;
  personality: Personality;
  operating_mode: OperatingMode;
  owner_user_id: string | null;
  avatar_path: string | null;
  /** Sparse Tier-2/3 policy overrides; merged over the code catalog at use. */
  operating_policy: PolicyOverrides;
  /** Emails that review George's knowledge proposals weekly (e.g. Nawaz, John). */
  knowledge_reviewers: string[];
};

/** Matches the in-code prompt defaults so an unconfigured org reads identically. */
export const AGENT_DEFAULTS: AgentSettings = {
  name: "George",
  title: "AI Customer Success Teammate",
  bio: null,
  personality: "concise_direct",
  operating_mode: "assistant",
  owner_user_id: null,
  avatar_path: null,
  operating_policy: {},
  knowledge_reviewers: [],
};

export const PERSONALITY_OPTIONS: {
  value: Personality;
  label: string;
  /** One-line tone modifier injected into the prompt. Layered on the locked tone rules. */
  prompt: string;
}[] = [
  {
    value: "concise_direct",
    label: "Concise & Direct",
    prompt:
      "Concise & Direct — terse, lead with the recommendation, minimal preamble. Trim every sentence that doesn't add a fact or a decision.",
  },
  {
    value: "warm_consultative",
    label: "Warm & Consultative",
    prompt:
      "Warm & Consultative — friendly and approachable; give a bit more context and rationale behind a recommendation, while staying specific and concrete.",
  },
  {
    value: "formal",
    label: "Formal",
    prompt:
      "Formal — buttoned-up and professional, suited to exec-facing communication. Full sentences, no contractions, measured tone.",
  },
];

export const OPERATING_MODE_OPTIONS: {
  value: OperatingMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "assistant",
    label: "Mode A — Assistant",
    hint: "Prepares, drafts, and surfaces; a human reviews and acts. Safer default.",
  },
  {
    value: "operator",
    label: "Mode B — Independent operator",
    hint: "Executes end-to-end and reports back; human post-reviews on cadence.",
  },
];

export function personalityLabel(p: Personality): string {
  return PERSONALITY_OPTIONS.find((o) => o.value === p)?.label ?? p;
}

export function personalityPrompt(p: Personality): string {
  return (
    PERSONALITY_OPTIONS.find((o) => o.value === p)?.prompt ??
    PERSONALITY_OPTIONS[0].prompt
  );
}

export function operatingModeLabel(m: OperatingMode): string {
  return OPERATING_MODE_OPTIONS.find((o) => o.value === m)?.label ?? m;
}

/**
 * Reads the org's George settings (falling back to defaults). Pass a
 * service-role admin client so RLS doesn't block the read on the prompt path.
 */
export async function getAgentSettings(
  admin: SupabaseClient,
  orgId: string,
): Promise<AgentSettings> {
  const { data } = await admin
    .from("agent_settings")
    .select(
      "name, title, bio, personality, operating_mode, owner_user_id, avatar_path, operating_policy, knowledge_reviewers",
    )
    .eq("org_id", orgId)
    .eq("agent_slug", AGENT_SLUG)
    .maybeSingle();

  if (!data) return { ...AGENT_DEFAULTS };
  return {
    name: data.name ?? AGENT_DEFAULTS.name,
    title: data.title ?? AGENT_DEFAULTS.title,
    bio: data.bio ?? null,
    personality: (data.personality as Personality) ?? AGENT_DEFAULTS.personality,
    operating_mode:
      (data.operating_mode as OperatingMode) ?? AGENT_DEFAULTS.operating_mode,
    owner_user_id: data.owner_user_id ?? null,
    avatar_path: data.avatar_path ?? null,
    operating_policy: (data.operating_policy as PolicyOverrides) ?? {},
    knowledge_reviewers: (data.knowledge_reviewers as string[]) ?? [],
  };
}
