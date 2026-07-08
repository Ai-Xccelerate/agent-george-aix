# George → AIX Core integration plan

**Status:** planning → execution. This is George's concrete adaptation of the AIX
workforce handoff docs (`ai-workforce-docs/core-platform/handoff/agent-integration/`).
Those docs assume a **split FE/BE, Python/NestJS, plain-Postgres, Clerk** agent.
George is different — a **single Next.js app (FE+BE in one service), TypeScript,
Supabase (DB+Auth+Storage)** — so this plan records what we keep, what we change,
and the file-level shape.

## What AIX Core requires (the contract)
1. Verify a **Clerk JWT** on every authed request (shared JWKS, RS256).
2. Call Core `GET /api/v1/agents/george/access` with that JWT; **block if `has_access:false`** (fail-closed: 401 token bad, 503 Core down / agent not in catalog, 403 not entitled).
3. **JIT-mirror** user/org rows on first authed request, keyed by `clerk_user_id`/`clerk_org_id`. **No Clerk webhooks** — Core owns the only subscription.
4. Mount Clerk on the FE; session is shared across `*.aiworkforce.md`.
5. Don't store identity/org/membership/entitlement — Core owns it. George keeps only its own per-org data, every table keyed by `organization_id` + `user_id`.

Agent id: **`george`**. FE domains: `george-staging.aiworkforce.md` / `george.aiworkforce.md`.

## Decisions (locked for this plan)
- **DB stays Supabase** (DB + Storage). We swap **only auth** (Supabase Auth → Clerk). Rationale: 351 PostgREST queries + 2 storage buckets + pgvector already work; moving off Supabase is a separate, larger project.
- **Keep RLS** via **Supabase third-party auth with Clerk** (Supabase validates Clerk's JWKS; `auth.jwt()->>'sub'` = Clerk user id). Rationale: RLS is George's defense-in-depth for a multi-tenant AI-agent product; dropping it to route everything through the service-role client weakens that. Cost: `org_members.user_id` migrates from `auth.users` UUID → Clerk id (text), and the RLS helpers (`is_org_member`, `is_org_admin`, `user_org_ids`) get rewritten to read the Clerk `sub`.
- **Chokepoint strategy:** concentrate the change in two files — `src/lib/supabase/middleware.ts` (`updateSession`, the route gate) and `src/lib/supabase/current-user.ts` (`getCurrentUser`, the server chokepoint 38 callers use). Keep `getCurrentUser`'s return shape (`{ id, orgId, role, ... }`) identical so callers + queries don't change.

## What gets deleted / replaced
- `src/app/(auth)/*` (signin/signup/forgot-password pages + `actions.ts`), `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts` → replaced by Clerk's hosted sign-in + `<ClerkProvider>` + Clerk middleware.
- `src/lib/auth/access-policy.ts` (`admitUser`, `ALLOWED_DOMAINS`, bootstrap-owner, invites) → replaced by Core `/access` + JIT-mirror. Entitlement is Core's job now.
- `src/app/(app)/settings/users/*` invite flow → Core dashboard owns org membership/assignment. (Keep a read-only roster via Core `/members` if wanted.)
- `src/lib/supabase/browser.ts` client-side auth → Clerk `useAuth`.

## What stays unchanged
- Every `.from('...')` query, the agent tools (`tools.ts`) + their explicit `org_id` scoping, Composio, the knowledge pipeline, chat SSE — all keep working. They depend on `getCurrentUser().orgId`, which stays a local UUID.

## Phased execution
**Phase 1 — Clerk scaffold (no Core yet).** `pnpm add @clerk/nextjs`. Add `<ClerkProvider>` in `layout.tsx`. Swap `proxy.ts`/`updateSession` to `clerkMiddleware()` + route protection. Replace `(auth)` pages with Clerk `<SignIn>`. Env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWKS_URL` (staging values from `aix-clerk-core-env-values.md`). *Verifiable locally: Clerk login works.*

**Phase 2 — Tenant re-key + JIT-mirror.** Migration: `org_members.user_id` UUID→text (Clerk id); add `clerk_org_id` to `orgs`. New `ensureTenantRows(clerkUserId, clerkOrgId)` (TS port of the doc's `ensure_tenant_rows`) wired into `getCurrentUser`. Rewrite RLS helpers to use the Clerk `sub`. Configure Supabase → Authentication → Third-Party Auth → Clerk.

**Phase 3 — Core /access gate.** New `src/lib/aix-core/access.ts` — TS port of the doc's `check_core_access` (fetch `${AIX_CORE_API_URL}/api/v1/agents/george/access` with the Clerk JWT, ≤60s cache, fail-closed). Call it inside `getCurrentUser` (and the `/api/chat` + `/api/messages` entrypoints) **before** JIT-mirror. Add the denied-access UI. Env: `AIX_CORE_API_URL`.

**Phase 4 — Deploy + domain.** Railway env (staging Clerk + Core values); custom domain `george-staging.aiworkforce.md` (Cloudflare CNAME + Railway custom domain). `NEXT_PUBLIC_APP_URL` → the subdomain.

**Phase 5 — Core side (Deepak) + smoke.** Deepak: catalog row `george`, enable for a test org, add origins to Core CORS. Smoke as owner/admin (implicit `owner_admin`) and plain member (403 → assign → `assigned`).

## The /access gate — TS shape (Phase 3)
```ts
// src/lib/aix-core/access.ts
const AGENT_ID = "george";
const CORE = process.env.AIX_CORE_API_URL!.replace(/\/$/, "");
const cache = new Map<string, { ok: boolean; reason?: string; at: number }>();
const TTL_MS = 60_000; // ≤60s per the contract

export async function requireCoreAccess(clerkUserId: string, jwt: string) {
  const hit = cache.get(clerkUserId);
  if (hit && Date.now() - hit.at < TTL_MS) return assertOk(hit);
  let res: Response;
  try {
    res = await fetch(`${CORE}/api/v1/agents/${AGENT_ID}/access`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
  } catch { throw new CoreError(503, "AIX Core unreachable"); } // fail closed
  if (res.status === 401) throw new CoreError(401, "Token rejected by Core");
  if (res.status === 404) throw new CoreError(503, "george not in Core catalog");
  if (res.status >= 500) throw new CoreError(503, `Core /access ${res.status}`);
  const data = await res.json();
  cache.set(clerkUserId, { ok: !!data.has_access, reason: data.reason, at: Date.now() });
  return assertOk({ ok: !!data.has_access, reason: data.reason });
}
```

## Reference implementations to crib from
- Auth contract + lifecycle: `agent-aix-core-auth-integration.md`
- Monorepo conversion (AIXDraw worked example): `monorepo-agent-aix-core-integration.md`
- Env values (staging/prod, live keys — private repo only): `aix-clerk-core-env-values.md`
- TS JWT verify reference: **Tony BE** (`recall-server`, uses `jose`)

## Blockers (Deepak — nothing smoke-tests without these)
- [ ] `george` in `agents.catalog` (staging)
- [ ] `george` enabled for a test org
- [ ] George origins in Core `CORS_ALLOWED_ORIGINS`
- [ ] `george-staging.aiworkforce.md` confirmed ours
