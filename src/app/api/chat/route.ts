import { NextRequest } from "next/server";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildGeorgeMcpServer } from "@/lib/agent/tools";
import { buildScribeMcpServer } from "@/lib/agent/scribe";
import { georgeCanUseTool } from "@/lib/agent/permissions";
import { buildGeorgeSystemPrompt } from "@/lib/agent/system-prompt";
import { generateSessionTitle } from "@/lib/agent/title";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveClaudeCodeExecutable } from "@/lib/agent/sdk-binary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ChatTurn = { role: "user" | "assistant"; content: string };

type AttachmentInput = {
  document_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size: number;
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { messages, sessionId, attachments } = (await req.json()) as {
    messages: ChatTurn[];
    sessionId?: string;
    attachments?: AttachmentInput[];
  };
  const attachmentList: AttachmentInput[] = Array.isArray(attachments)
    ? attachments
    : [];

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return new Response("no user message", { status: 400 });

  const admin = createSupabaseAdmin();

  // Resolve or create the chat session row.
  let dbSession = sessionId
    ? (
        await admin
          .from("agent_sessions")
          .select("id, sdk_session_id, title, customer_id")
          .eq("id", sessionId)
          .eq("org_id", user.orgId)
          .maybeSingle()
      ).data
    : null;

  if (!dbSession) {
    const { data } = await admin
      .from("agent_sessions")
      .insert({
        org_id: user.orgId,
        user_id: user.id,
        channel: "chat",
        // Seed with a slice of the first user message so the history rail
        // shows something meaningful immediately. We'll upgrade this to an
        // LLM-summarised title after the assistant's first reply (see the
        // `after()` block below).
        title: lastUser.content.slice(0, 80),
      })
      .select("id, sdk_session_id, title, customer_id")
      .single();
    dbSession = data;
  }

  // True only on the first turn of a session created without a title
  // (i.e. the user clicked "New chat" → `newChatAction` inserted a
  // row with `title: null`, then sent a message). We upgrade that row
  // to a real summary after the assistant replies.
  const needsTitle = !dbSession!.title;
  if (needsTitle) {
    // Interim title so the history rail shows something on the next
    // render, even before the LLM-summarised title replaces it.
    const interim = lastUser.content.slice(0, 80);
    await admin
      .from("agent_sessions")
      .update({ title: interim })
      .eq("id", dbSession!.id);
    dbSession!.title = interim;
  }

  // Inline attachment metadata so George can see which files were sent
  // with this turn and can call `read_document` on them by id.
  const attachmentMarkers = attachmentList
    .map(
      (a) =>
        `[Attached file: ${a.original_name} (${a.mime_type}, document_id=${a.document_id})]`,
    )
    .join("\n");
  const userContentForLog = attachmentMarkers
    ? `${attachmentMarkers}\n\n${lastUser.content}`
    : lastUser.content;

  const userMsgInsert = await admin.from("agent_messages").insert({
    session_id: dbSession!.id,
    role: "user",
    content: userContentForLog,
    content_json:
      attachmentList.length > 0 ? { attachments: attachmentList } : null,
  });
  if (userMsgInsert.error) {
    console.error("[chat] user message insert failed", { sessionId: dbSession!.id, error: userMsgInsert.error.message });
  }

  // Build transcript context. SDK `resume` will swap to its own context once we
  // capture the sdk_session_id from the first turn.
  const transcript = messages
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "George"}: ${m.content}`)
    .join("\n\n");
  const prompt = transcript
    ? `${transcript}\n\nUser: ${userContentForLog}`
    : userContentForLog;

  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );

      let assistantText = "";
      let sdkSessionId: string | undefined;

      const { server: georgeServer, toolNames } = buildGeorgeMcpServer({
        orgId: user.orgId,
        userId: user.id,
        sessionId: dbSession!.id,
      });
      const scribe = buildScribeMcpServer();

      const fullSystemPrompt = await buildGeorgeSystemPrompt(admin, {
        orgId: user.orgId,
        customerId:
          (dbSession as { customer_id?: string | null } | null)?.customer_id ??
          null,
      });

      // Explicit built-in allowlist. We intentionally EXCLUDE Bash, Read,
      // Write, Edit, NotebookEdit, Glob, Grep, Task, TodoWrite, Skill —
      // those would give an LLM filesystem + shell access to our own server.
      // George gets:
      //   - WebFetch  — to learn about a customer from their website
      //   - WebSearch — to look up context the agent doesn't already have
      //   - AskUserQuestion — structured Q&A back to the user
      //   - all 11 mcp__george__* tools — the only path to our Supabase data
      const builtinAllow = ["WebFetch", "WebSearch", "AskUserQuestion"];

      // Run the agent once, returning either "ok" or "stale_resume" so the
      // caller can retry from scratch when the SDK can't find the stored
      // session id (server restart wiped the local conversation store,
      // session came from autonomous mode, etc.).
      async function runOnce(
        resumeId: string | undefined,
      ): Promise<"ok" | "stale_resume"> {
        console.log("[chat] runOnce.start", {
          sessionId: dbSession!.id,
          resumeId: resumeId ?? null,
          hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
          home: process.env.HOME ?? null,
        });
        const q = query({
          prompt,
          options: {
            abortController,
            model: "claude-sonnet-4-6",
            systemPrompt: fullSystemPrompt,
            tools: builtinAllow,
            mcpServers: {
              george: georgeServer,
              ...(scribe ? { scribe: scribe.server } : {}),
            },
            allowedTools: [
              ...builtinAllow,
              ...toolNames,
              ...(scribe ? scribe.toolNames : []),
            ],
            canUseTool: georgeCanUseTool,
            pathToClaudeCodeExecutable: resolveClaudeCodeExecutable(),
            resume: resumeId,
            cwd: process.cwd(),
            env: {
              ...process.env,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
              CLAUDE_AGENT_SDK_CLIENT_APP: "agent-george/0.1",
            } as Record<string, string | undefined>,
          },
        });

        let sawAny = false;
        for await (const msg of q as AsyncIterable<SDKMessage>) {
          if (!sawAny) {
            sawAny = true;
            console.log("[chat] first SDK message", { type: msg.type });
          }
          if (msg.type === "assistant") {
            const blocks = msg.message?.content ?? [];
            for (const b of blocks) {
              if (b.type === "text" && b.text) {
                // If we got the "no conversation found" surface as a model
                // text reply (Agent SDK 0.2.x emits the resume miss as a
                // result-style error message inside the stream), abort and
                // signal a retry without resume.
                if (
                  resumeId &&
                  !assistantText &&
                  /No conversation found with session ID/i.test(b.text)
                ) {
                  return "stale_resume";
                }
                assistantText += b.text;
                send("text", { text: b.text });
              } else if (b.type === "tool_use") {
                send("tool_use", {
                  id: b.id,
                  name: b.name,
                  input: b.input,
                });
              }
            }
            sdkSessionId ??= msg.session_id;
          } else if (msg.type === "user") {
            const blocks = msg.message?.content;
            if (Array.isArray(blocks)) {
              for (const b of blocks as Array<{ type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>) {
                if (b.type === "tool_result") {
                  send("tool_result", {
                    id: b.tool_use_id,
                    is_error: b.is_error ?? false,
                  });
                }
              }
            }
          } else if (msg.type === "system") {
            sdkSessionId ??= msg.session_id;
            send("system", {
              sessionId: dbSession!.id,
              subtype: (msg as { subtype?: string }).subtype,
            });
          } else if (msg.type === "result") {
            sdkSessionId ??= msg.session_id;
            send("done", { sessionId: dbSession!.id });
          }
        }
        return "ok";
      }

      try {
        let result = await runOnce(dbSession!.sdk_session_id ?? undefined);

        if (result === "stale_resume") {
          // Clear the stored id so we don't keep retrying on every send.
          await admin
            .from("agent_sessions")
            .update({ sdk_session_id: null })
            .eq("id", dbSession!.id);
          dbSession!.sdk_session_id = null;
          assistantText = "";
          sdkSessionId = undefined;
          send("system", { sessionId: dbSession!.id, subtype: "reset" });
          result = await runOnce(undefined);
        }

        if (result === "stale_resume") {
          send("error", {
            message:
              "Could not resume this session and the fallback also failed. Try a new chat.",
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chat] query failed", {
          sessionId: dbSession!.id,
          message,
          stack: err instanceof Error ? err.stack : undefined,
        });
        // Some Agent SDK builds THROW on resume miss instead of streaming
        // it (the streamed-text version is handled inside runOnce via the
        // "stale_resume" return). Mirror that recovery here: clear the
        // stale id and retry without resume in the SAME request so the
        // user gets their reply without having to re-send.
        if (
          dbSession!.sdk_session_id &&
          /No conversation found with session ID/i.test(message)
        ) {
          await admin
            .from("agent_sessions")
            .update({ sdk_session_id: null })
            .eq("id", dbSession!.id);
          dbSession!.sdk_session_id = null;
          assistantText = "";
          sdkSessionId = undefined;
          send("system", { sessionId: dbSession!.id, subtype: "reset" });
          try {
            const retry = await runOnce(undefined);
            if (retry === "stale_resume") {
              send("error", {
                message:
                  "Could not start a fresh session after the previous one was lost. Try sending your message again.",
              });
            }
          } catch (retryErr: unknown) {
            const retryMsg =
              retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.error("[chat] retry after stale resume failed", {
              sessionId: dbSession!.id,
              message: retryMsg,
              stack: retryErr instanceof Error ? retryErr.stack : undefined,
            });
            send("error", { message: retryMsg });
          }
        } else {
          send("error", { message });
        }
      } finally {
        if (assistantText) {
          await admin.from("agent_messages").insert({
            session_id: dbSession!.id,
            role: "assistant",
            content: assistantText,
          });
        }
        if (sdkSessionId && sdkSessionId !== dbSession!.sdk_session_id) {
          await admin
            .from("agent_sessions")
            .update({ sdk_session_id: sdkSessionId })
            .eq("id", dbSession!.id);
        }
        // Upgrade the interim title to an LLM-summarised one. We run
        // this inline (before close) — the `done` event has already
        // streamed, so the user sees the assistant's reply complete
        // immediately; this adds ~1s of held-open SSE during which we
        // emit a `title` event so the client can refresh the rail. If
        // the Haiku call fails the interim slice stays as-is.
        if (needsTitle && assistantText) {
          try {
            const title = await generateSessionTitle({
              userMessage: lastUser.content,
              assistantReply: assistantText,
              fallback: lastUser.content,
            });
            await admin
              .from("agent_sessions")
              .update({ title })
              .eq("id", dbSession!.id);
            send("title", { sessionId: dbSession!.id, title });
          } catch (err) {
            console.warn("[chat] title generation failed:", err);
          }
        }
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

