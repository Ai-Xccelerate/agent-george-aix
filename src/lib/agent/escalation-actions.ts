/**
 * Generates structured `suggested_actions` for an escalation from its
 * title/detail/recommendation. George populates these directly when raising new
 * decisions (see raise_decision); this is for backfilling ones raised before
 * the field existed.
 *
 * Uses claude-sonnet-4-6 via a forced tool call for reliable structured output.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

export type SuggestedAction = {
  label: string;
  kind: "create" | "assign" | "update" | "email" | "confirm" | "other";
};

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cached;
}

export async function generateSuggestedActions(args: {
  title: string;
  detail: string | null;
  recommendation: string | null;
}): Promise<SuggestedAction[] | null> {
  const context = [
    `TITLE: ${args.title}`,
    args.detail ? `DETAIL: ${args.detail}` : null,
    args.recommendation ? `GEORGE'S RECOMMENDATION: ${args.recommendation}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await client().messages.create({
      model: MODEL,
      max_tokens: 512,
      tool_choice: { type: "tool", name: "record_suggested_actions" },
      tools: [
        {
          name: "record_suggested_actions",
          description:
            "Record the concrete next-actions a human reviewer could take on this decision.",
          input_schema: {
            type: "object",
            properties: {
              actions: {
                type: "array",
                maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description:
                        "The action as a short imperative the reviewer hands back to George, e.g. 'Add Fraser Maclean as a platform user and assign him as RKON's owner'.",
                    },
                    kind: {
                      type: "string",
                      enum: ["create", "assign", "update", "email", "confirm", "other"],
                    },
                  },
                  required: ["label", "kind"],
                },
              },
            },
            required: ["actions"],
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: `From this decision, list 1–4 concrete actions the reviewer could take. Make them mutually-exclusive options when the decision is a fork (e.g. "Assign Fraser" vs "Assign John"). Keep each label short and specific.\n\n${context}`,
        },
      ],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return null;
    const raw = (block.input as { actions?: unknown }).actions;
    if (!Array.isArray(raw)) return null;
    const actions = raw
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        const label = typeof o.label === "string" ? o.label.trim() : "";
        const kind = typeof o.kind === "string" ? o.kind : "other";
        return label
          ? ({ label, kind: (["create", "assign", "update", "email", "confirm", "other"].includes(kind) ? kind : "other") as SuggestedAction["kind"] })
          : null;
      })
      .filter((x): x is SuggestedAction => !!x)
      .slice(0, 4);
    return actions.length ? actions : null;
  } catch (err) {
    console.warn("[escalation-actions] generation failed:", err);
    return null;
  }
}
