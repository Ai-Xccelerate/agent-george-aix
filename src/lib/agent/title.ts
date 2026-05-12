/**
 * Generate a short, descriptive title for a chat session from the first
 * user message + George's first reply. Used by the chat route to replace
 * the "New chat" placeholder on the history rail after turn one.
 *
 * Uses Claude Haiku 4.5 — fast and cheap, this is a single ~30-token
 * generation off the critical path (scheduled with `after()` so the SSE
 * stream closes immediately). Falls back to a slice of the user message
 * if the model call fails for any reason; the caller passes that
 * fallback in.
 */
import Anthropic from "@anthropic-ai/sdk";

const MAX_TITLE_LEN = 60;

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cached;
}

export async function generateSessionTitle(args: {
  userMessage: string;
  assistantReply: string;
  fallback: string;
}): Promise<string> {
  const fallback = args.fallback.slice(0, MAX_TITLE_LEN).trim() || "New chat";
  try {
    const res = await client().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 40,
      system:
        "You generate concise chat titles. Reply with the title only — no quotes, no punctuation at the end, no prefix, no explanation. 3–6 words, Title Case, summarising the user's intent. Examples: \"Kickoff Plan for Acme Partner\", \"Drafting Renewal Email\", \"Reviewing November Utilization\".",
      messages: [
        {
          role: "user",
          content: `User said:\n${args.userMessage.slice(0, 600)}\n\nGeorge replied:\n${args.assistantReply.slice(0, 600)}\n\nTitle:`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return fallback;
    const raw = block.text
      .trim()
      .replace(/^["'`*_#-]+|["'`*_#-]+$/g, "")
      .replace(/\s+/g, " ");
    if (!raw) return fallback;
    return raw.slice(0, MAX_TITLE_LEN);
  } catch (err) {
    console.warn("[generateSessionTitle] falling back:", err);
    return fallback;
  }
}
