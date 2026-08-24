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
import { buildScribeMcpServer } from "./scribe";
import { isActive } from "./integration-toggle";
import { isScribeConfigured } from "./scribe";
import { isNylasEnabled } from "@/lib/nylas/client";
import { buildAgentDbMcpServer, clerkOrgIdFor } from "./agentdb";
import { georgeCanUseTool } from "./permissions";
import { buildGeorgeSystemPrompt } from "./system-prompt";
import type { AutonomousSendPolicy } from "./prompt";
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
  /**
   * Whether George may send email in this run.
   *   - "none" (default): draft-only; send_email_draft is stripped.
   *   - "internal_only": send_email_draft is available but the tool refuses
   *     any draft whose recipients are not all internal. Used for inbound mail so
   *     George can reply to internal threads / escalate to his manager.
   */
  emailSendPolicy?: AutonomousSendPolicy;
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
  const emailSendPolicy = input.emailSendPolicy ?? "none";

  const systemPrompt = await buildGeorgeSystemPrompt(admin, {
    orgId: input.orgId,
    autonomous: true,
    emailSendPolicy,
  });

  // Per-org on/off, resolved before the tools are assembled. An integration a
  // human has not switched on for THIS org contributes no tools at all.
  const [nylasOn, scribeOn] = await Promise.all([
    isActive(admin, input.orgId, "nylas", isNylasEnabled()),
    isActive(admin, input.orgId, "scribe", isScribeConfigured()),
  ]);

  const { server: georgeServer, toolNames } = buildGeorgeMcpServer({
    orgId: input.orgId,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    emailSendPolicy: emailSendPolicy === "internal_only" ? "internal_only" : "chat",
    enabled: { nylas: nylasOn },
  });
  const scribe = scribeOn ? buildScribeMcpServer() : null;
  // Same read-only AgentDB access as the chat path — an autonomous run must
  // not get a wider grant than a supervised one.
  const agentdb = buildAgentDbMcpServer({
    clerkOrgId: await clerkOrgIdFor(admin, input.orgId),
  });

  // Autonomous mode allowlist:
  //   - WebFetch / WebSearch: research is fine in the background.
  //   - AskUserQuestion excluded from builtinAllow: no UI to answer.
  //   - send_email_draft: stripped under "none"; kept under "internal_only"
  //     (the tool itself refuses external recipients).
  const builtinAllow = ["WebFetch", "WebSearch"];
  const allowedMcpTools =
    emailSendPolicy === "internal_only"
      ? toolNames
      : toolNames.filter((n) => !n.endsWith("send_email_draft"));

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
        mcpServers: {
          george: georgeServer,
          ...(scribe ? { scribe: scribe.server } : {}),
          ...(agentdb ? { agentdb: agentdb.server } : {}),
        },
        allowedTools: [
          ...builtinAllow,
          ...allowedMcpTools,
          ...(scribe ? scribe.toolNames : []),
          ...(agentdb ? agentdb.toolNames : []),
        ],
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
