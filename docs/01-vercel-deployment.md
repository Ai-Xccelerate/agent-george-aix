# Agent George on Vercel — runtime & deployment reference

> **⚠️ SUPERSEDED — we do not deploy on Vercel.** Agent George runs on **Railway** as a
> persistent Docker container (`Dockerfile` → `next start`), project **Agent George - Onyx**,
> service `george-onyx`, building from `rvbhavsar/george-onyx`. See AGENTS.md →
> "Railway is the host" and "Runtime — what's actually true on Railway" for the current model.
>
> What this means for everything below:
> - **No 300s Function ceiling.** It's a long-lived server; long work is bounded by deploys/restarts, not a per-request cap. The entire "Function → migrate to Workflow at 5 min" framing does not apply.
> - **No Vercel Cron, Workflow DevKit, DurableAgent, Sandbox, Queues, or AI Gateway.** None of these primitives exist on Railway. The `vercel.json` cron was inert here and has been **removed** — scheduled jobs currently have no trigger (see `docs/BACKLOG.md`).
> - **`after()` still works** (it's a Next.js feature, not Vercel-only).
> - **Supabase is unchanged** — that part of the design holds on any host.
>
> Kept as a reference for the long-running/agentic design options (Workflow/DurableAgent shapes,
> Sandbox isolation) **if** we ever move to a serverless host. Treat it as one option, not the
> committed path. Do not follow it as current guidance.

---

This is the canonical reference for **which Vercel primitive to use for which kind of work**, the hard rules to follow, and the migration path for the long-running surfaces in the backlog. Read this before adding any new server route, background task, or scheduled job.

Last verified: 2026-05-12 against Vercel's Feb 2026 platform baseline.

---

## TL;DR — decision rules

| If the work is… | Use this primitive | Code shape |
|---|---|---|
| **Synchronous HTTP** (incl. SSE streaming chat) | Fluid Compute Function | Plain Next.js route handler. 300s ceiling. |
| **Fire-and-forget after a 200** (webhook → background processing ≤ ~4 min) | Fluid Compute + `after()` | `import { after } from "next/server"` |
| **Recurring on a schedule** (≤ ~4 min per tick) | Vercel Cron | `vercel.ts` `crons` entry → route handler |
| **Durable, long-running, pause/resume** (anything > 5 min, multi-step, retries, sleeps, waits-on-event) | **Vercel Workflow DevKit** | `"use workflow"` orchestration + `"use step"` units |
| **LLM agent loop > 5 min OR needs durability** | **`DurableAgent`** from `@workflow/ai` | Inside a `"use workflow"` function |
| **Untrusted code execution / browser automation** | **Vercel Sandbox** | Ephemeral Firecracker microVM via `@vercel/sandbox` |
| **At-least-once event delivery / fan-out** | Vercel Queues (public beta) | `import { Queue } from "vercel/queue"` |
| **Provider-agnostic LLM routing + observability** | Vercel AI Gateway | `"anthropic/claude-sonnet-4-5"` string vs direct SDK |

If the table doesn't list your case, default to **Fluid Compute Function**. If it might run > 5 min, default to **Workflow**.

---

## Hard rules

These exist to keep us out of categories of failure that are easy to drift into.

1. **No Edge Functions.** Deprecated. Use Fluid Compute (which is the default — you don't have to opt in).
2. **Don't exceed 300s in a Function.** If a job might, it belongs in a Workflow. Don't try to "split" a single logical job across multiple Function invocations with manual checkpointing — that's what workflows + steps are for.
3. **Don't poll long-running external work from a Function.** Submit the work, return, and let a webhook or `createHook()` resume the workflow. Polling burns Active CPU $ and competes with the 300s ceiling.
4. **Don't put background work in the chat SSE handler.** The SSE handler exists to stream tokens to the user. Anything else (analyses, batch operations, multi-step research) belongs in a workflow that the chat handler *triggers* and links to via `agent_job_runs` / `agent_events`.
5. **Don't execute untrusted code in-process.** If George ever ends up running user-supplied scripts, contract-parser code, or browser automation, that goes in **Vercel Sandbox** — never in the Function process.
6. **Don't enable filesystem tools (Bash/Read/Write/etc.) on the chat path.** Already locked in AGENTS.md; same logic applies to any new agent surface.
7. **Don't use Vercel Postgres or Vercel KV — they don't exist anymore.** Storage stays on Supabase.
8. **Always rotate secrets before exposing a deploy** (backlog #11) and **disable Supabase self-signup** at the platform layer (#13).

---

## How each existing surface maps to Vercel

This is the deploy plan with **zero code changes** for v1. Everything works as-is.

| Surface | File | Runtime | Notes |
|---|---|---|---|
| Chat SSE | `src/app/api/chat/route.ts` | Fluid Compute Function (`maxDuration = 300`) | Bounded by chat naturally. Stale-resume fallback already handled. |
| Inbound webhook | `src/app/api/webhooks/composio/route.ts` | Fluid Compute + `after()` | `after(() => processAgentEvent(id))` is native on Vercel. |
| Hourly cron | `src/app/api/cron/run-jobs/route.ts` | Vercel Cron | Bearer auth via `CRON_SECRET`. Already declared in `vercel.json`. |
| Job runner (≤ 4 min budget) | `src/lib/agent/run-job.ts` | Fluid Compute (called from cron and `runNowAction`) | Stays as-is. |
| Inbound-event processor | `src/lib/agent/process-event.ts` | Fluid Compute via `after()` | Stays as-is. Belt-and-braces cron sweep keeps it resilient. |
| Generic autonomous runner | `src/lib/agent/run-autonomous.ts` | Fluid Compute | Caller bounds it (default 240s). |
| Knowledge sync (offline) | `scripts/sync-knowledge.ts` | Local CLI | Not deployed. |

**You can deploy today without changing any of these files.**

---

## What changes when long-running work lands

These backlog items will need the Workflow DevKit. Don't pre-build — wait until the first concrete job that needs > 5 min.

### Backlog #17 — Cloud-managed long-running agents

Today every autonomous run is bounded to 240s inside `run-autonomous.ts`. Once a job needs longer (multi-hour utilization analyses, overnight portfolio sweeps, etc.):

1. Install: `pnpm add workflow @workflow/ai @workflow/next`
2. Convert `runGeorgeJob` (or a sibling `runGeorgeLongJob`) into a workflow:

   ```ts
   import { withWorkflow } from "workflow/next";
   import { DurableAgent } from "@workflow/ai/agent";
   import { start } from "workflow/api";
   import { getWritable } from "workflow";

   async function loadJob(jobId: string) {
     "use step";
     // existing supabase admin lookup
   }

   async function persistRunOutcome(runId: string, /* … */) {
     "use step";
     // existing agent_job_runs update
   }

   export async function longRunningJobWorkflow(jobId: string) {
     "use workflow";

     const job = await loadJob(jobId);
     const agent = new DurableAgent({
       model: "anthropic/claude-sonnet-4-5",
       system: await buildSystemPromptStep(job.org_id),  // "use step"
       tools: { /* MCP tools, wrapped per @workflow/ai's tool spec */ },
     });

     const result = await agent.stream({
       messages: [{ role: "user", content: job.directive }],
       writable: getWritable(),
       maxSteps: 200,        // generous — workflow survives across hours
     });

     await persistRunOutcome(/* … */);
     return result.messages;
   }
   ```

3. Start it from the cron route via `start(longRunningJobWorkflow, [jobId])`. The cron route returns immediately; the workflow runs for as long as it needs.
4. Stream observability via `getWritable({ namespace: "logs" })` for verbose telemetry, default stream for final results. The UI consumes the readable stream by run id.

### Backlog #10 — Sub-agents

Sub-agents map cleanly to `DurableAgent` instances launched by the parent. From inside a workflow, fan-out via `start()` wrapped in a step:

```ts
async function spawnSubAgent(prompt: string) {
  "use step";
  const run = await start(subAgentWorkflow, [prompt]);
  return run.runId;
}

export async function parentAgentWorkflow(directive: string) {
  "use workflow";
  const ids = await Promise.all([
    spawnSubAgent("research market A"),
    spawnSubAgent("research market B"),
    spawnSubAgent("research market C"),
  ]);
  // wait for each, aggregate
}
```

`start()` returns immediately and the parent can either await `run.returnValue` per child or fire-and-forget.

### Backlog #1 — Inbound email loop (already shipped internally)

Today's path: webhook → `after()` → `processAgentEvent()` → ≤ 240s autonomous run. **This is correct.** Most inbound replies finish well under 4 min.

Only migrate this to Workflow if a real reply pattern needs > 5 min (e.g., transcript-based deep replies). The migration is local — `processAgentEvent` becomes a workflow start point.

### Future — Untrusted execution / browser automation

If George ever needs to:
- Parse a contract by rendering the PDF (no MIME-only inspection)
- Scrape a partner portal (HLR §2.2 — Onyx Support Hub if direct API isn't available)
- Run a code snippet a user dropped in chat

→ Use **Vercel Sandbox**. Pattern is in `node_modules/@vercel/sandbox/...` once installed. Pre-build a sandbox **snapshot** with Chromium + agent-browser to get sub-second startup.

---

## Best practices baked in

### Function surfaces

- Default to **Node.js 24 LTS** (Fluid Compute default).
- Export `maxDuration` per route if the work is bounded — be honest about how long it can take. Default is now 300s on all plans; don't set higher than you actually need.
- Use `after()` for any post-response work. The Cron sweep we built for `agent_events` is the right shape: `after()` is best-effort, the sweep is the durability backstop.
- Don't put DB writes inside the SSE iteration loop — buffer assistant text and write once in `finally`, like the chat route does.

### Workflows

- **Put logic in `"use step"` functions, orchestration in `"use workflow"`.** Steps have full Node.js. Workflows run in a sandboxed VM with limited APIs. If you have to import `fs` or `crypto`, you're in a step.
- **Use deterministic hook tokens** for external systems (`createHook({ token: "approval-${id}" })`) so retries land on the same hook.
- **Use namespaced streams** for long jobs: default stream = final results, `namespace: "logs:info"` = verbose progress. The UI can subscribe to only what it needs and the replay cost stays bounded.
- **Use `FatalError` vs `RetryableError`** deliberately. 4xx from a customer system = fatal; 429 / 5xx = retry.
- **Serialization matters.** Only plain JSON-ish values cross step boundaries. No class instances, no functions, no symbols.

### DurableAgent

- Tools that need Node.js / npm access → put the `execute` function in a `"use step"`.
- Tools that use workflow primitives (`sleep`, `createHook`) → DON'T mark them as steps; they run at the workflow level.
- Cap `maxSteps` even when generous (e.g., 200). It's a safety net against an LLM loop.

### AI Gateway

- If you flip to the Gateway, prefer string model ids: `"anthropic/claude-sonnet-4-5"`. Don't import `@ai-sdk/anthropic` directly — that bypasses the Gateway's routing + observability.
- Set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` to the Gateway key in Vercel env; nothing else changes.
- Zero data retention is on by default on Gateway. Confirm before sending PII.

### Config

- Prefer **`vercel.ts`** (with `@vercel/config`) over `vercel.json` for new projects. TypeScript, dynamic logic, env-aware. Existing `vercel.json` keeps working — migrate when you next need to touch it.
- Crons go in the config, not inline.

### Observability

- The **Vercel MCP server** lets Claude Code (and other AI agents) inspect deployments, logs, and projects from chat. Optional — useful when debugging "why did this prod deploy 500?"
- **Vercel Agent** (separate product, public beta) does AI code reviews on PRs and prod investigations. Independent of the runtime; consider for CI.

---

## Pricing reality

- **Hobby**: fine for personal dev and previews. Cron limited to daily; you'll need ≥ Pro for hourly.
- **Pro ($20/mo)**: minimum for production. Unlocks hourly cron, the 300s timeout consistently, team features. **Required for v1 prod.**
- **Workflow runs** are billed on Active CPU (same as Functions). Sleeping/waiting time is free — that's the whole point of durable workflows.
- **Sandbox** is billed per microVM minute. Pre-built snapshot drops cold-start cost dramatically.

---

## Migration sequence — concrete next steps

When you're ready to ship to prod:

1. **Today**: Just deploy. Connect repo → Vercel → paste env vars → ship. No code changes.
2. **Pre-prod**: Rotate secrets (#11), disable Supabase self-signup (#13). 5 minutes each.
3. **Optional**: Migrate `vercel.json` → `vercel.ts` for typed cron config.
4. **When you build #17**: Install `workflow` + `@workflow/ai`. Port `run-autonomous.ts` into a workflow per the sketch above. Existing short-bounded `run-job` keeps using Fluid Compute for the cheap path; long jobs route to the workflow.
5. **When you build #10 sub-agents**: Use `DurableAgent` from day one. Don't bolt sub-agents onto the existing single-agent chat route.
6. **When you hit a "needs untrusted code" use case**: Add `@vercel/sandbox`, pre-build a snapshot for the dependencies you need (Chromium, etc.), wrap in a `withSandbox` helper.
7. **When provider fallback or cost routing matters**: Flip Anthropic API key → AI Gateway key. Switch model strings to `"provider/model"` format. No other code changes.

---

## What stays on Supabase forever

Don't move these to Vercel-side primitives — Supabase is purpose-built for them:

- Postgres (15+ tables, RLS, pgvector for knowledge embeddings)
- Auth (`@supabase/ssr`, magic links, email/password, invite flow)
- Storage (`customer-docs`, `org-assets` buckets)
- Realtime (if/when we wire it)

---

## Anti-patterns we've decided against

- Building a custom queue/worker on top of `agent_events` polling — Vercel Queues will be GA soon; if we need pub/sub before then, fold into the existing cron sweep.
- Migrating the chat path to Edge for "lower latency" — Edge is deprecated; Fluid Compute is the answer.
- Trying to make a long agent run inside the chat SSE handler — that's what Workflow is for; the chat handler triggers it and shows progress.
- Running migrations from Function code — keep migrations in `supabase/migrations/` applied via `pnpm db:migrate`.

---

## Pointer for future Claude sessions

When working in this codebase, default to:
- Fluid Compute Function for any new HTTP route, unless the work might exceed 5 min
- Vercel Workflow + DurableAgent for new long-running or agentic tracks
- Supabase for storage and auth — never Vercel-side
- The decision table at the top of this doc when in doubt
