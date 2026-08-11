import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestClient } from "@/lib/db/postgrest";
import { createR2Storage, isR2Enabled } from "@/lib/storage/r2";

/**
 * Server-only database handle — never import from a client component.
 *
 * TWO INDEPENDENT MIGRATION SWITCHES
 * Both halves of the Supabase exit are selected here, by separate variables, so
 * either can move — or roll back — without touching the other:
 *
 *   DATABASE_URL    unset -> supabase-js talking to PostgREST (original)
 *                   set   -> `.from()` / `.rpc()` as real SQL against Postgres
 *                            via src/lib/db/postgrest.ts
 *
 *   STORAGE_DRIVER  unset -> `.storage` goes to Supabase Storage (original)
 *                   =r2   -> `.storage` goes to Cloudflare R2 via
 *                            src/lib/storage/r2.ts
 *
 * They are deliberately not one flag. The database is 33 tables and every
 * feature; storage is two files. Coupling them would mean one deploy where a
 * failure could have come from either half. Staging moved the database first,
 * proved it, and only then moved storage.
 *
 * Flipping either back is deleting an environment variable — no code change, no
 * redeploy of anything else. That reversibility is the point: 143 database call
 * sites and 17 storage call sites go through here, so this is the only place the
 * swap has to be correct.
 */
function supabaseClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Whichever backend serves files. Built lazily by the callers below because most
 * requests never touch a bucket — and while the driver is still `supabase`, an
 * eager client would demand the Supabase env vars on a deployment that has
 * otherwise fully cut over to Postgres.
 */
function storageBackend() {
  return isR2Enabled() ? createR2Storage() : supabaseClient().storage;
}

export function createSupabaseAdmin(): SupabaseClient {
  if (!process.env.DATABASE_URL) {
    // Database still on Supabase. Storage may nonetheless have moved, so the
    // driver is honoured here too rather than assuming the two travel together.
    if (!isR2Enabled()) return supabaseClient();
    const sb = supabaseClient();
    return new Proxy(sb, {
      get(target, prop, receiver) {
        if (prop === "storage") return createR2Storage();
        return Reflect.get(target, prop, receiver);
      },
    }) as SupabaseClient;
  }

  const pg = createPostgrestClient();

  const hybrid = {
    from: pg.from.bind(pg),
    rpc: pg.rpc.bind(pg),
    get storage() {
      return storageBackend();
    },
  };

  // The shim implements the audited subset of the client surface this codebase
  // uses (see src/lib/db/postgrest.ts), not all of SupabaseClient. Asserting the
  // wider type is what keeps the swap to zero call-site changes; anything
  // outside the subset throws a named error at runtime rather than failing
  // quietly, which is the trade we chose deliberately.
  return hybrid as unknown as SupabaseClient;
}
