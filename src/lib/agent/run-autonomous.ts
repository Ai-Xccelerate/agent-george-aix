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
import {
  query,
  type AgentDefinition,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeCodeExecutable } from "./sdk-binary";
import { buildGeorgeMcpServer } from "./tools";
import { buildScribeMcpServer } from "./scribe";
import { isActive } from "./integration-toggle";
import { isScribeConfigured } from "./scribe";
import { isNylasEnabled } from "@/lib/nylas/client";
import { buildAgentDbMcpServer, clerkOrgIdFor } from "./agentdb";
import { georgeCanUseTool } from "./permissions";
import { resolveOperatingMode, renderAutonomyBlock } from "./operating-mode";
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
  /**
   * Sub-agents this run may delegate to.
   *
   * This is how a capability gets scoped to one agent instead of to a code
   * path. An AgentDefinition carries its own tool grant, so the onboarding
   * agent can hold `send_email_draft` while this run's own allowlist does not —
   * and every other autonomous path keeps tool-absence without having to
   * remember to filter for it.
   *
   * Note the interaction with emailSendPolicy below: the policy governs what
   * THIS run may do directly. A sub-agent's grant is its own.
   */
  agents?: Record<string, AgentDefinition>;
  /**
   * Run AS this agent, rather than registering it for delegation.
   *
   * WHY THIS EXISTS ALONGSIDE `agents`
   * The SDK invokes a registered subagent through the `Task` tool. `Task` is
   * disabled across this codebase (AGENTS.md, tool allowlist), so an agents map
   * on its own is registered and unreachable — the parent has no way to call it.
   *
   * Enabling `Task` on an autonomous path is a real decision: it hands the model
   * a general delegation primitive on a path with no human in the loop. For a
   * single-purpose run like onboarding there is nothing to decide between — one
   * agent does the work — so the definition is used directly instead: its prompt
   * layers onto George's own, and its tool list becomes this run's allowlist.
   *
   * The safety property is unchanged and arguably stronger. Under delegation the
   * grant is enforced on the child; here it is enforced on the only thing
   * running. Either way the tools this run can reach are exactly the ones the
   * AgentDefinition names.
   */
  asAgent?: AgentDefinition;
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

  // Resolved once and used twice: it decides the grant below, and George is
  // told the same thing in words. The block and the gate are edited together —
  // when they drift, the prompt is the one that lies.
  const operatingMode = await resolveOperatingMode(admin, input.orgId);

  const basePrompt =
    (await buildGeorgeSystemPrompt(admin, {
      orgId: input.orgId,
      autonomous: true,
      emailSendPolicy,
    })) +
    "\n\n" +
    renderAutonomyBlock(operatingMode);
  // Layered, not replaced: the agent prompt is task framing, and it still
  // needs the identity, organisation profile and signature block that decide
  // which company George says he works for.
  const systemPrompt = input.asAgent
    ? `${basePrompt}

${input.asAgent.prompt}`
    : basePrompt;

  // Per-org on/off, resolved before the tools are assembled. An integration a
  // human has not switched on for THIS org contributes no tools at all.
  const [nylasOn, scribeOn] = await Promise.all([
    isActive(admin, input.orgId, "nylas", isNylasEnabled()),
    isActive(admin, input.orgId, "scribe", isScribeConfigured()),
  ]);

  // Every run through this function is one nobody asked for. Whether it may
  // create work for a human is the org's operating mode, decided here rather
  // than left to the prompt — see operating-mode.ts.
  const mayRaise = operatingMode === "operator";

  const { server: georgeServer, toolNames } = buildGeorgeMcpServer({
    orgId: input.orgId,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    emailSendPolicy: emailSendPolicy === "internal_only" ? "internal_only" : "chat",
    mayRaiseDecisions: mayRaise,
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
  //
  // This governs a run that is not running as a named agent. When `asAgent` is
  // set, the agent's own list replaces this entirely — see below.
  const builtinAllow = ["WebFetch", "WebSearch"];
  // Running AS an agent: its named list is the allowlist, intersected with
  // what is actually registered — a name the server does not expose is a
  // typo, not a grant, and silently allowing it would hide the typo.
  const allowedMcpTools = input.asAgent?.tools
    ? toolNames.filter((n) => input.asAgent!.tools!.includes(n))
    : emailSendPolicy === "internal_only"
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
        ...(input.agents ? { agents: input.agents } : {}),
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
