/**
 * Generic autonomous-mode runner for George. Powers any non-chat trigger
 * (cron-driven standing jobs, inbound-email webhooks, transcript-ready
 * webhooks). Streaming, SSE, and persistence are the caller's job — this
 * module just runs George once and returns what happened.
 *
 * Shared invariants vs. chat mode:
 *   - `send_email_draft` is stripped from the tool allowlist. Drafts must be
 *     reviewed by a human in the chat session before sending.
 *   - `AskUserQuestion` is excluded — no UI to answer it.
 *   - The system prompt includes GEORGE_AUTONOMOUS_RUN_PROMPT, which asks
 *     George to finish with a structured Actions / Awaiting review / Notes
 *     summary that callers can persist as a run record.
 */
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeCodeExecutable } from "./sdk-binary";
import { buildGeorgeMcpServer } from "./tools";
import { georgeCanUseTool } from "./permissions";
import { buildGeorgeSystemPrompt } from "./system-prompt";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type RunAutonomousInput = {
  orgId: string;
  /** The user message that prompts George. Caller's job to frame it. */
  userPrompt: string;
  /** Hard wall-time ceiling. Defaults to 4 minutes. */
  timeBudgetMs?: number;
  /** Forwarded to MCP tools that audit actor. Defaults to null. */
  userId?: string | null;
  /** Tag for SDK telemetry: e.g. "agent-george-job/0.1", "agent-george-event/0.1". */
  clientAppTag?: string;
  /** Resume an existing SDK session. Used when an inbound event extends an
   *  in-progress thread. */
  resumeSdkSessionId?: string | null;
  /** Our agent_sessions.id for this run, if one exists. Forwarded into
   *  audit_log so the Inbox UI can link outbound rows back to the chat. */
  sessionId?: string | null;
};

export type RunAutonomousResult = {
  status: "succeeded" | "failed" | "timed_out";
  summary: string | null;
  sdkSessionId: string | null;
  error: string | null;
};

const DEFAULT_TIME_BUDGET_MS = 240_000;

export async function runGeorgeAutonomous(
  input: RunAutonomousInput,
): Promise<RunAutonomousResult> {
  const admin = createSupabaseAdmin();
  const timeBudgetMs = input.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;

  const systemPrompt = await buildGeorgeSystemPrompt(admin, {
    orgId: input.orgId,
    autonomous: true,
  });

  const { server: georgeServer, toolNames } = buildGeorgeMcpServer({
    orgId: input.orgId,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
  });

  // Autonomous mode allowlist:
  //   - WebFetch / WebSearch: research is fine in the background.
  //   - send_email_draft stripped: drafts go to humans for review.
  //   - AskUserQuestion excluded from builtinAllow: no UI to answer.
  const builtinAllow = ["WebFetch", "WebSearch"];
  const allowedMcpTools = toolNames.filter(
    (n) => !n.endsWith("send_email_draft"),
  );

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeBudgetMs);
  let timedOut = false;
  abortController.signal.addEventListener("abort", () => {
    timedOut = true;
  });

  let assistantText = "";
  let sdkSessionId: string | null = null;
  let runtimeError: string | null = null;

  try {
    const q = query({
      prompt: input.userPrompt,
      options: {
        abortController,
        model: "claude-sonnet-4-6",
        systemPrompt,
        tools: builtinAllow,
        mcpServers: { george: georgeServer },
        allowedTools: [...builtinAllow, ...allowedMcpTools],
        canUseTool: georgeCanUseTool,
        pathToClaudeCodeExecutable: resolveClaudeCodeExecutable(),
        resume: input.resumeSdkSessionId ?? undefined,
        cwd: process.cwd(),
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          CLAUDE_AGENT_SDK_CLIENT_APP:
            input.clientAppTag ?? "agent-george-autonomous/0.1",
        } as Record<string, string | undefined>,
      },
    });

    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === "assistant") {
        const blocks = msg.message?.content ?? [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) assistantText += b.text;
        }
        sdkSessionId ??= msg.session_id ?? null;
      } else if (msg.type === "system" || msg.type === "result") {
        sdkSessionId ??=
          (msg as { session_id?: string }).session_id ?? sdkSessionId;
      }
    }
  } catch (err: unknown) {
    runtimeError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const status: "succeeded" | "failed" | "timed_out" = timedOut
    ? "timed_out"
    : runtimeError
    ? "failed"
    : "succeeded";

  return {
    status,
    summary: assistantText || null,
    sdkSessionId,
    error: runtimeError,
  };
}
