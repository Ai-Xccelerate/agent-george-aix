/**
 * Derives meeting intelligence (sentiment + distilled learnings) from a synced
 * transcript. Scribe's `insights` payload has decisions / action items / topics
 * but no sentiment or takeaways, so we generate those with one Sonnet call at
 * sync time and merge them into the stored `insights` jsonb.
 *
 * Uses `claude-sonnet-4-6` (the project's default agent model) via a forced
 * tool call for reliable structured output. Best-effort: the caller treats a
 * null return as "no intelligence" and stores the transcript regardless.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";
// Cap the transcript we send — sentiment + takeaways don't need the full 40-min
// text, and this bounds token cost per sync.
const MAX_TRANSCRIPT_CHARS = 40_000;

export type MeetingIntelligence = {
  sentiment: string;
  sentiment_rationale: string;
  learnings: string[];
};

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cached;
}

export async function analyzeMeetingIntelligence(args: {
  transcriptText: string | null;
  summary: string | null;
}): Promise<MeetingIntelligence | null> {
  const transcript = (args.transcriptText ?? "").trim();
  if (!transcript) return null;

  const context = [
    args.summary ? `MEETING SUMMARY:\n${args.summary}` : null,
    `TRANSCRIPT (may be truncated):\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      tool_choice: { type: "tool", name: "record_meeting_intelligence" },
      tools: [
        {
          name: "record_meeting_intelligence",
          description:
            "Record the overall sentiment and key learnings from a customer meeting transcript.",
          input_schema: {
            type: "object",
            properties: {
              sentiment: {
                type: "string",
                description:
                  "One or two words for the overall tone from the customer's side, e.g. 'Positive', 'Neutral', 'At risk', 'Frustrated', 'Enthusiastic'.",
              },
              sentiment_rationale: {
                type: "string",
                description: "One sentence explaining the sentiment call.",
              },
              learnings: {
                type: "array",
                items: { type: "string" },
                description:
                  "3-6 durable takeaways a CSM should remember — needs, risks, commitments, context about the account. Not a summary; the things worth carrying into the next interaction.",
              },
            },
            required: ["sentiment", "sentiment_rationale", "learnings"],
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Analyze this customer meeting and record its sentiment and key learnings.\n\n${context}`,
        },
      ],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return null;
    const input = block.input as Partial<MeetingIntelligence>;
    if (!input.sentiment || !Array.isArray(input.learnings)) return null;
    return {
      sentiment: String(input.sentiment),
      sentiment_rationale: String(input.sentiment_rationale ?? ""),
      learnings: input.learnings.map(String).filter(Boolean),
    };
  } catch (err) {
    console.warn("[meeting-intelligence] analysis failed:", err);
    return null;
  }
}
