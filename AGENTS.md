<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent George — Project Context

You're in the codebase for **Agent George**, an AI Customer Success Manager being built by AIXccelerate for Onyx (`getonyx.ai`, the first deployment). George is a chat-first AI employee — minimal UI, conversation-centric, with three core jobs: **onboarding**, **retention/health**, **on-demand support** (v2+).

This file is the source of truth for orientation. Read top to bottom on a fresh context, then dive in.

## Start here, in this order

1. **`docs/00-high-level-requirements.md`** — full product brief (vision, scope, architecture, data model, open questions). Authoritative.
2. **`docs/01-vercel-deployment.md`** — **superseded.** We deploy on **Railway** (see "Railway is the host" below), not Vercel. This doc captures the earlier Vercel-primitive design (Function vs Workflow vs DurableAgent vs Sandbox); keep it as a future-option reference only. For the current runtime model read the "Runtime — what's actually true on Railway" section below.
3. **`docs/BACKLOG.md`** — every item deliberately deferred, grouped by area, with what / why / where / status. Authoritative for "what's next?". Cross-walked against the HLR — items tagged `[HLR]` come from the HLR audit.
4. **The AIX theme** — George's entire front end is the AI Xccelerate UI template, ported in 2026-08. The design language (colour, radius, type, glass chrome, liquid backdrop) lives in `src/app/globals.css`; primitives are in `src/components/ui/`, `src/components/form/`, `src/components/aix/`; app chrome is in `src/layout/` + `src/context/`. The upstream template repo is the reference — read it, don't guess. Template commit at port time: `91c44f0`.
5. **`knowledge/core/*.md`** — the actual organizational playbook George ships with. **Listed in the manifest** prepended to George's system prompt every session; fetched in full on demand via the `read_knowledge_doc(path)` tool (see Knowledge Pipeline below).

## Tech stack — locked in

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Styling | Tailwind v4 with `@theme` tokens in `src/app/globals.css` |
| Package manager | pnpm |
| UI / design system | **AIX UI template** — Tailwind v4, self-hosted Inter / Geist / JetBrains Mono, brand orange `#F47920`, tight radii (controls 5px, cards 8px), glass chrome over `<LiquidBackdrop/>`. Dark-first with a light/dark/**system** preference. |
| Auth | **Clerk** + the AIX Core entitlement gate. `src/proxy.ts` runs `clerkMiddleware` and `auth.protect()`; `src/lib/supabase/current-user.ts` verifies the session, calls `checkCoreAccess`, then JIT-mirrors org/membership rows. There is **no** George-local sign-in — Core hosts it. |
| Database | **Postgres** via `src/lib/db/postgrest.ts` when `DATABASE_URL` is set, otherwise supabase-js against PostgREST. Selected in `src/lib/supabase/admin.ts`. |
| Storage | **Cloudflare R2** when `STORAGE_DRIVER=r2` (`src/lib/storage/r2.ts`), otherwise Supabase Storage. Independent of the database switch — either half rolls back on its own. |
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
│   │   ├── globals.css     # AIX theme: @theme tokens, glass, liquid backdrop
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
│   │   ├── ui/, form/, aix/, common/, header/  # AIX theme primitives
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
- **Theme.** Dark-first, on the AIX palette (brand orange `#F47920`). `src/app/layout.tsx` reads the `george-theme` cookie server-side and stamps `class="dark"` + `data-theme` on `<html>` — no FOUC. `src/context/ThemeContext.tsx` owns the client side and writes both `george-theme` (resolved) and `george-theme-pref` (light/dark/system). **Never** bootstrap the theme with an inline `<script>` — the security hook blocks it, which is why this is cookie-driven.
- **The UI is the AIX template, not bespoke.** Reuse `src/components/ui/*`, `form/*`, `aix/*` before writing a component. Style with the theme's scale utilities (`bg-white dark:bg-white/[0.03]`, `text-gray-800 dark:text-white/90`, `bg-brand-500`) — **not** arbitrary hexes or `var(--color-*)`, which was the pre-port dialect and is fully removed. Cards `rounded-2xl`, controls `rounded-lg`; never hardcode a radius. Glass (`glass-surface`/`glass-float`/`glass-popover`) is for chrome only — content cards stay opaque.
- **Icons.** Template SVGR icons (`@/icons`) for chrome; `lucide-react` for page content. Deliberate: the template ships 57 icons and George needs 54 distinct ones, only ~22 of which have equivalents. Keeping each surface internally consistent beats mixing two styles inside one page.
- **Railway is the host.** Deployed on Railway as a persistent Docker container (`Dockerfile` → `next start`, Node 24), not on serverless functions. Project **Agent George - Onyx**, service `george-onyx`, builds from `rvbhavsar/george-onyx` via the Dockerfile (`railway.json`). Because it's a long-lived server there is **no 300s function ceiling** — long work is bounded only by deploys/restarts (single instance). The earlier Vercel-primitive plan (Fluid Compute / Workflow DevKit / DurableAgent / Sandbox) in `docs/01-vercel-deployment.md` is **superseded** — keep it as a future-option reference, not current reality.

**Supabase is being retired, not preserved** (this reverses an earlier "never migrate off Supabase" rule, deliberately). Auth moved to Clerk; the database moved to Railway Postgres and storage to R2, each behind its own switch (`DATABASE_URL`, `STORAGE_DRIVER`) — see the stack table. Staging runs on both; production still runs on Supabase for database and storage until its cutover, which needs a fresh dump plus a write-freeze or delta-sync decision.

## Runtime — what's actually true on Railway

We run as **one persistent Node server** in a container — not serverless functions. That changes the model from what `docs/01-vercel-deployment.md` describes (that doc is the superseded Vercel design).

| Work shape | How it runs today | Notes |
|---|---|---|
| HTTP route, SSE chat, webhooks | In-process on the running server | No 300s ceiling. Still keep chat responsive; don't block the SSE loop on background work. |
| Background processing right after a 200 | `after()` from `next/server` | Works in self-hosted Next; used in `/api/webhooks/composio`. Best-effort — a restart mid-task drops it, hence the cron sweep backstop. |
| Recurring / scheduled (sweeps, objectives, deferred work) | **✅ Live in-process** | `src/instrumentation.ts` runs a node-cron every minute on boot (prod-on by default; `SCHEDULER_ENABLED` to force), calling `runCronTick()`. `/api/cron/run-jobs` still exists as an external-pinger fallback (`CRON_SECRET` bearer). Correctness under concurrency is the atomic `agent_jobs.running_run_id` claim, so the scheduler stays simple. **Note:** the manual "Standing jobs" settings UI was removed (2026-07-01, unused) — the tick still runs built-in sweeps/objectives; there is no George tool to author `agent_jobs` from chat. |
| Long-running / multi-step / sub-agents (backlog #17/#10) | **Undecided on Railway** | Can run in-process (bounded by deploys/restarts) or move to a separate worker/queue. The Vercel Workflow/DurableAgent sketches in `docs/01` are *one* option, not the committed path. |
| Untrusted code, browser automation | Not yet needed | When it is, isolate it (separate service/sandbox) — never run untrusted code in this server process. |

Hard rules that still hold: **don't put background work in the chat SSE handler**, **don't run untrusted code in-process**, **storage/auth stays on Supabase**. The Vercel-specific rules (Edge, 300s Function ceiling, `createHook()`) don't apply to this host.

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

# Database migrations — Alembic, in db/. See db/README.md for the full workflow.
#   cd db && uv venv && uv pip install -r requirements.txt   # one-time
#   export DATABASE_URL="postgresql://..."                   # never defaulted, always explicit
#   alembic current                                          # where is this database?
#   alembic revision --rev-id 0002 -m "..."                  # new change (raw SQL, both directions)
#   alembic upgrade head                                     # apply
#   alembic upgrade head --sql > review.sql                  # MANDATORY before production
# Inline passwords are blocked by the sandbox — always source from an env file.
```

## Database

15+ tables, all RLS-enabled, gated by `is_org_member(org_id)` and `is_org_admin(org_id)` helpers. Service-role admin client bypasses RLS (used by the agent backend).

Key tables: `orgs`, `org_members`, `invites`, `customers`, `contacts`, `contracts`, `onboarding_plans`, `onboarding_steps`, `customer_health`, `agent_sessions`, `agent_messages`, `memories` (pgvector), `knowledge_docs` (+ `is_core` flag), `knowledge_chunks` (pgvector ivfflat), `integrations`, `audit_log`.

### Migrations — Alembic (`db/`)

Schema changes are managed by **Alembic**, matching AIX Core and Parchment so there is one tool and one playbook across AIX products. Full workflow in **`db/README.md`**; commands in the cheat sheet above.

- The 35 files in `supabase/migrations/` are **history, not the source of truth**. Don't add to them, don't re-run them.
- Revision `0001_baseline` is a `pg_dump --schema-only` of the live schema — it *is* the schema, not a description of it. Existing databases are **stamped** at it (`alembic stamp 0001`); only a brand-new database executes it, which is what makes a from-scratch environment reproducible.
- **No SQLAlchemy models, so `--autogenerate` is off by design.** Revisions are raw SQL in `op.execute()`. With no models, autogenerate would diff against nothing and propose dropping every table.
- `DATABASE_URL` is never defaulted — Alembic exits with instructions if it's unset. Applying a migration to the wrong database is the one mistake worth designing out.
- **Out of scope: RLS policies.** Production (Supabase) has 75; staging (Railway) has none, since every query goes through the service-role admin client and the policies were dropped in the Postgres migration. Managing them here would assert the two environments match when they don't.
- Python lives only in `db/`. `package.json`, the `Dockerfile` and the build are untouched, and Alembic never runs inside the container.

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

- **A verification that cannot report failure is not a verification.** Before
  trusting a check, make it fail on purpose once. Three separate checks here
  passed permanently while proving nothing: a test double more permissive than
  the database, which agreed with the query instead of testing it; a schema
  snapshot nobody refreshed, which could not disagree with the code; and a CI
  typecheck carrying `continue-on-error: true`, which reported a green tick
  while exiting 2. Each read as coverage. None could ever have said no.
  The same applies to a guard you cannot observe firing — see `email.send_blocked`,
  which sat at zero for all time and was assumed to mean "nothing to refuse".
- **Build green = green.** Run `pnpm build` before declaring done — it catches Suspense, RSC/client, and TS issues the dev server hides.
- **New Alembic revision** for every schema change — `cd db && alembic revision --rev-id <next> -m "..."`, raw SQL, both `upgrade()` and `downgrade()`, rollback proven locally before you commit. Ship it in the same PR as the code that needs it. Never edit an applied revision; fix forward.
- **Update `docs/BACKLOG.md`** when you defer something. Always say *why deferred*.
- **Don't introduce alternative stacks.** No Prisma, no Express, no different agent framework, no Drizzle. We chose this stack deliberately — extend it.
- **No emojis in user-facing copy** unless the user uses them first. Match the design system tone (specific, calm, no fluff).
