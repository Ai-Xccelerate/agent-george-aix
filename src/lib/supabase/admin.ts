import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestClient } from "@/lib/db/postgrest";

/**
 * Server-only database handle — never import from a client component.
 *
 * MIGRATION SWITCH (Supabase -> Railway Postgres)
 * There are two backends behind this one function, chosen by whether
 * DATABASE_URL is set:
 *
 *   unset  -> supabase-js, talking to PostgREST. The original behaviour.
 *   set    -> `.from()` / `.rpc()` run as real SQL against Postgres via the
 *             shim in src/lib/db/postgrest.ts, while `.storage` still goes to
 *             Supabase Storage.
 *
 * Splitting it this way lets the database move ship and be verified on its own,
 * before file storage moves to Cloudflare R2. Storage is a separate concern with
 * a separate blast radius; coupling them would mean one deploy where a failure
 * could come from either half.
 *
 * Flipping back is deleting an environment variable — no code change, no
 * redeploy of anything else. That reversibility is the point: 143 call sites go
 * through here, so this is the only place the swap has to be correct.
 */
function supabaseClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function createSupabaseAdmin(): SupabaseClient {
  if (!process.env.DATABASE_URL) return supabaseClient();

  const pg = createPostgrestClient();

  // Storage has no Postgres equivalent, so it keeps using Supabase until the R2
  // migration lands. Built lazily: most requests never touch a bucket, and
  // constructing the client eagerly would require the Supabase env vars to stay
  // present on a deployment that has otherwise fully cut over.
  const hybrid = {
    from: pg.from.bind(pg),
    rpc: pg.rpc.bind(pg),
    get storage() {
      return supabaseClient().storage;
    },
  };

  // The shim implements the audited subset of the client surface this codebase
  // uses (see src/lib/db/postgrest.ts), not all of SupabaseClient. Asserting the
  // wider type is what keeps the swap to zero call-site changes; anything
  // outside the subset throws a named error at runtime rather than failing
  // quietly, which is the trade we chose deliberately.
  return hybrid as unknown as SupabaseClient;
}
