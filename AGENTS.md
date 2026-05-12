<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent George — Project Context

You're in the codebase for **Agent George**, an AI Customer Success Manager being built by AIXccelerate for Onyx (`getonyx.ai`, the first deployment). George is a chat-first AI employee — minimal UI, conversation-centric, with three core jobs: **onboarding**, **retention/health**, **on-demand support** (v2+).

This file is the source of truth for orientation. Read top to bottom on a fresh context, then dive in.

## Start here, in this order

1. **`docs/00-high-level-requirements.md`** — full product brief (vision, scope, architecture, data model, open questions). Authoritative.
2. **`docs/01-vercel-deployment.md`** — **runtime + deployment reference.** Which Vercel primitive to use for which kind of work (Function vs Workflow vs DurableAgent vs Sandbox), hard rules, and the migration path for long-running tracks. Read before adding any new server route, scheduled job, or agent surface.
3. **`docs/BACKLOG.md`** — every item deliberately deferred, grouped by area, with what / why / where / status. Authoritative for "what's next?". Cross-walked against the HLR — items tagged `[HLR]` come from the HLR audit.
4. **`design/design-system.md`** — AIX Core + Onyx purple theme. Token names, gradients, layout patterns. §0 has explicit "apply this theme" instructions.
5. **`knowledge/core/*.md`** — the actual organizational playbook George ships with. **Listed in the manifest** prepended to George's system prompt every session; fetched in full on demand via the `read_knowledge_doc(path)` tool (see Knowledge Pipeline below).

## Tech stack — locked in

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Styling | Tailwind v4 with `@theme` tokens in `src/app/globals.css` |
| Package manager | pnpm |
| Database / Auth / Storage | Supabase (`https://ckpcvansksrytxbamuvy.supabase.co`) — `@supabase/ssr` for browser+server clients, `@supabase/supabase-js` admin client for service-role ops |
| Agent runtime | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), model `claude-sonnet-4-6`. Server-side via `/api/chat` route handler streaming SSE. |
| Integrations | Composio (`@composio/core`) for M365 Outlook + Calendar, Fireflies, OneDrive. Direct integrations only when Composio doesn't cover. |
| Memory | Mem0 (long-term, **not yet wired**) + Supabase `memories` table (short/mid-term, schema only). See `docs/BACKLOG.md` #7/#28/#29. |

## Project layout

```
george/
├── AGENTS.md               # ← you are here
├── CLAUDE.md               # just `@AGENTS.md`
├── docs/
│   ├── 00-high-level-requirements.md
│   └── BACKLOG.md
├── knowledge/
│   └── core/               # canonical org playbooks, loaded into prompt at session start
│       ├── 01-csm-onboarding-process.md
│       ├── 02-agent-george-role.md
│       ├── 03-agent-george-lifecycle-steps.md
│       └── README.md
├── public/onyx-logo.svg    # white wordmark, drawn for dark surfaces
├── scripts/
│   ├── sync-knowledge.ts   # pnpm sync:knowledge — pushes knowledge/ into Supabase
│   └── verify-composio.ts  # pnpm tsx scripts/verify-composio.ts — sanity-checks Composio wiring
├── src/
│   ├── proxy.ts            # Next 16 renamed `middleware.ts` → `proxy.ts`. Refreshes Supabase session, gates protected routes.
│   ├── app/
│   │   ├── layout.tsx      # Server: reads `george-theme` cookie, applies `dark` class. Dark-first default.
│   │   ├── globals.css     # Tailwind v4 @theme — Onyx purple palette
│   │   ├── (app)/          # Authenticated app shell (sidebar + topbar via (app)/layout.tsx)
│   │   │   ├── dashboard/
│   │   │   ├── chat/                   # /chat → newest session; /chat/[id] → that session
│   │   │   │   ├── layout.tsx          # History rail + content
│   │   │   │   ├── page.tsx            # Redirect to newest or empty state
│   │   │   │   ├── [id]/page.tsx       # Loads agent_messages from DB
│   │   │   │   ├── _chat-client.tsx    # Client: send/stream/tool-render
│   │   │   │   ├── _history-rail.tsx   # Collapsible sidebar
│   │   │   │   └── actions.ts          # newChatAction, deleteChatAction
│   │   │   ├── customers/              # /customers list + /customers/[id] detail (read-only)
│   │   │   └── settings/
│   │   │       ├── layout.tsx          # Settings shell with role-aware sub-nav
│   │   │       ├── _nav.tsx            # admin items hidden for non-admins
│   │   │       ├── profile/            # Everyone; stub (edit in backlog #15)
│   │   │       ├── users/              # Admin-only; invite/role/revoke. RLS-gated.
│   │   │       ├── integrations/       # Admin-only; embedded Composio connect flow
│   │   │       └── organization/       # Admin-only; stub (edit in backlog #14)
│   │   ├── (auth)/                     # Auth pages (brand-panel layout)
│   │   │   ├── signin/                 # Email/password + magic link
│   │   │   ├── signup/                 # Notice page only — invite-only, no form
│   │   │   └── actions.ts              # signInAction, magicLinkAction, signOutAction
│   │   ├── auth/callback/route.ts      # OAuth/magic-link code exchange + admitUser()
│   │   └── api/
│   │       ├── chat/route.ts           # Agent SDK query() over SSE
│   │       ├── integrations/composio/callback/route.ts
│   │       └── webhooks/composio/route.ts   # Stub — persists to audit_log (auto-respond is backlog #1)
│   ├── components/
│   │   ├── sidebar.tsx, topbar.tsx     # App shell
│   │   ├── brand-logo.tsx              # Onyx wordmark (dark direct / light pill)
│   │   └── ui/badge.tsx                # LifecycleBadge, HealthBadge, StepStatusBadge
│   └── lib/
│       ├── agent/
│       │   ├── prompt.ts               # GEORGE_SYSTEM_PROMPT
│       │   ├── tools.ts                # buildGeorgeMcpServer — 11 Supabase MCP tools
│       │   ├── composio-tools.ts       # 9 Composio MCP tools (email/cal/fireflies)
│       │   └── permissions.ts          # canUseTool — SSRF guard on WebFetch
│       ├── auth/access-policy.ts       # ALLOWED_DOMAINS, admitUser() — single source of truth
│       ├── supabase/{server,browser,admin,middleware,current-user}.ts
│       └── composio/{client,connections}.ts
└── supabase/migrations/    # SQL — applied via psql against pooler (see "Database" below)
```

## Locked-in architectural decisions

These are decided; **don't redo them without saying so**.

- **Chat-first UX.** Don't build SaaS-style CRUD screens for things you can do via chat. Customer records are created by George from conversation, not by a form. (HLR §1, §6.)
- **Org-scoped integrations.** Composio uses `org-<orgId>` as the user_id (`composioOrgIdentity` in `src/lib/composio/client.ts`). Every human in an org shares the same George inbox/calendar/Fireflies. **Never** use a per-human user_id in Composio.
- **Invite-only access.** No self-signup. Allowed domains: `getonyx.ai`, `aixccelerate.com` (in `src/lib/auth/access-policy.ts`). Owners/admins invite via `/settings/users`; flow uses `supabase.auth.admin.inviteUserByEmail`.
- **First-bootstrap exception.** If Onyx org has zero members, the first allowlisted login becomes owner. Closes once one member exists.
- **Tool allowlist.** Built-ins enabled: `WebFetch` (SSRF-guarded), `WebSearch`, `AskUserQuestion`. Disabled: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Task`, `TodoWrite`, `Skill`. Wired in `src/app/api/chat/route.ts`. **Never enable filesystem tools on the chat path** — would expose `.env.local` and the source tree to a prompt-injected agent.
- **Email policy.** George must `draft_email` / `draft_email_reply`, surface preview, wait for explicit user confirm, then `send_email_draft`. Never auto-send. Calendar events go direct (less sensitive). Enforced in the system prompt; deviations would be a regression.
- **Knowledge pipeline (manifest + on-demand).** The system prompt prepends a **manifest** — every knowledge doc's path + title, with `is_core=true` entries grouped at the top as the "core playbook." No `content_md` in the prompt. George fetches docs in full with `mcp__george__read_knowledge_doc(path)` when it knows which doc has the answer, or `mcp__george__search_knowledge(query)` (chunks span the full KB, core + supplemental) when it doesn't. Pattern is deliberate — CLAUDE.md-style: tiny preamble, deep content read lazily. Don't reintroduce eager full-load of core; it doesn't scale and the manifest gives the agent enough to pick the right doc. Customer-specific data still goes through the Supabase MCP tools, not the knowledge path.
- **Theme.** Dark-first. Onyx purple palette (`#6D45F5` primary). Server-side cookie (`george-theme`) sets the `dark` class on `<html>` — no FOUC. Toggle in topbar.
- **Vercel as the host.** Deployed on Vercel Fluid Compute (Node 24, 300s default). Long-running and agentic work belongs in **Vercel Workflow DevKit** (`"use workflow"` orchestration + `"use step"` units), not in plain Functions. See `docs/01-vercel-deployment.md` for the decision table and migration sketches. Supabase stays where it is; **never** migrate Postgres / Auth / Storage to Vercel-side primitives.

## Runtime — when to use what

Quick decision table; the full version is in `docs/01-vercel-deployment.md`.

| Work shape | Use | Notes |
|---|---|---|
| HTTP route, SSE chat, webhooks ≤ ~4 min | Fluid Compute Function | Default. 300s ceiling. |
| Background processing right after a 200 | `after()` inside a Function | Native; we use it in `/api/webhooks/composio`. |
| Recurring ≤ ~4 min | Vercel Cron | Already wired in `vercel.json`. Hourly. |
| **Anything > 5 min, multi-step, retries, sleeps, waits on events** | **Vercel Workflow** | `"use workflow"` + `"use step"`. Backlog #17 lives here. |
| **LLM agent loop > 5 min OR needs durability** | **`DurableAgent`** from `@workflow/ai` | Sub-agents (backlog #10) live here. |
| Untrusted code, browser automation | **Vercel Sandbox** | Firecracker microVM. Pre-build a snapshot. |
| Provider-agnostic LLM routing | Vercel AI Gateway | String model ids like `"anthropic/claude-sonnet-4-5"`. |

Hard rules: **no Edge Functions** (deprecated), **don't exceed 300s in a Function** (migrate to Workflow), **don't poll long external work from a Function** (use `createHook()`), **don't run untrusted code in-process** (use Sandbox), **don't put background work in the chat SSE handler** (trigger a workflow instead).

## Commands cheat sheet

```bash
# Dev
pnpm dev                 # Next.js dev server (port 3000 by default; use PORT=3001 if 3000 is busy)
pnpm build               # Production build
pnpm lint                # eslint

# Knowledge
pnpm sync:knowledge      # walks knowledge/, upserts knowledge_docs + chunks. is_core based on path starting with `core/`.

# Composio sanity check
pnpm tsx scripts/verify-composio.ts   # verifies API key + auth config IDs

# Database — there is no CLI access token, use psql against the pooler.
# Pattern that works (load env first):
#   set -a && . ./.env.local && set +a
#   PGPASSWORD="$SUPABASE_DB_PASSWORD" psql -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
#     -U "postgres.$SUPABASE_PROJECT_REF" -d postgres -v ON_ERROR_STOP=1 -f <migration.sql>
# Inline passwords are blocked by the sandbox — always source from env file.
```

## Database

15+ tables, all RLS-enabled, gated by `is_org_member(org_id)` and `is_org_admin(org_id)` helpers. Service-role admin client bypasses RLS (used by the agent backend).

Key tables: `orgs`, `org_members`, `invites`, `customers`, `contacts`, `contracts`, `onboarding_plans`, `onboarding_steps`, `customer_health`, `agent_sessions`, `agent_messages`, `memories` (pgvector), `knowledge_docs` (+ `is_core` flag), `knowledge_chunks` (pgvector ivfflat), `integrations`, `audit_log`.

Migrations live in `supabase/migrations/` — applied in timestamp order. **Always add a new file** rather than editing past ones (prod parity).

## Gotchas (real surprises we hit)

- **Next 16 renamed `middleware.ts` → `proxy.ts`.** Don't recreate `middleware.ts`. The export is `proxy()`, not `middleware()`.
- **`useSearchParams()` needs a Suspense boundary** to prerender. Wrap usage in `<Suspense>`.
- **Inline `<script>` injection in layouts is blocked by a security hook** — even for compile-time-constant content. Use cookie-based server-side state instead of an inline `<script>` for theme bootstrapping. See `src/app/layout.tsx` for the pattern.
- **Sandbox blocks inline DB passwords** on the bash command line. Source `.env.local` first, then use `$PGPASSWORD` from env.
- **Composio prefixes**: `ac_xxxx` = Auth Config (the OAuth recipe). `ca_xxxx` = Connected Account (a specific user's mailbox). They're distinct — don't conflate.
- **WebFetch SSRF guard**: `src/lib/agent/permissions.ts` blocks localhost / private IPv4 / IPv6 ULA / link-local. Don't disable; widen the allowlist instead if a legitimate target is blocked.
- **Lucide icons**: `Puzzle` was removed from the sidebar when Integrations moved under Settings — verify imports if you re-add nav items.

## Memory stack status

Implemented:
- **Interaction memory** — in-process during `query()` (Agent SDK handles)
- **Session memory** — `agent_sessions` + `agent_messages`; SDK `sdk_session_id` stored for `resume()`; UI exposes via `/chat/[id]` + history rail

Pending (see `docs/BACKLOG.md`):
- Short-term, mid-term, long-term (Mem0), agent-level memory. Schema is ready (`memories` table with `scope` enum), no read/write code yet.

When asked "does George remember?", the honest answer today: within a session yes, across sessions no, beyond a session no.

## When you make changes

- **Build green = green.** Run `pnpm build` before declaring done — it catches Suspense, RSC/client, and TS issues the dev server hides.
- **New migration** for every schema change. Apply via the psql pattern above.
- **Update `docs/BACKLOG.md`** when you defer something. Always say *why deferred*.
- **Don't introduce alternative stacks.** No Prisma, no Express, no different agent framework, no Drizzle. We chose this stack deliberately — extend it.
- **No emojis in user-facing copy** unless the user uses them first. Match the design system tone (specific, calm, no fluff).
