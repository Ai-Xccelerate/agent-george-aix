/**
 * Single pg connection pool for the whole server process.
 *
 * Supabase gave us PostgREST, which owned connection pooling on the far side of
 * an HTTP call — the app never held a database connection. Talking to Postgres
 * directly means we own that now, so this must be a true singleton: Next's dev
 * server re-evaluates modules on every edit, and a per-module Pool would leak a
 * fresh set of connections on each hot reload until Postgres refused new ones.
 * Stashing it on globalThis survives HMR.
 *
 * Sizing: George runs as ONE Railway container (see AGENTS.md — the in-process
 * cron depends on that), so the pool only has to cover concurrent requests in a
 * single process, not a fleet. Ten is generous for that; raise PGPOOL_MAX if
 * connection waits ever show up in traces.
 */
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __georgePgPool: Pool | undefined;
}

/**
 * Railway's private network (postgres.railway.internal) is unencrypted and
 * rejects a TLS handshake; its public TCP proxy and most managed providers
 * require TLS. Default to the private-network case and let DATABASE_SSL=require
 * opt in, since that is how this deploys.
 */
function sslConfig() {
  const mode = (process.env.DATABASE_SSL ?? "").toLowerCase();
  if (mode === "require" || mode === "true") {
    // Railway terminates TLS with a cert chain Node doesn't ship a root for;
    // verification would fail on an otherwise healthy connection.
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export function getPool(): Pool {
  if (!globalThis.__georgePgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set — the Postgres shim cannot connect. " +
          "In Railway this comes from the Postgres service; locally, point it " +
          "at a tunnel (railway connect Postgres-<id> --tunnel-only).",
      );
    }

    const pool = new Pool({
      connectionString,
      max: Number(process.env.PGPOOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslConfig(),
    });

    // An idle client erroring (server restart, network blip) emits on the pool.
    // Without a listener Node treats it as an unhandled error and kills the
    // process — pg removes the broken client either way, so log and continue.
    pool.on("error", (err) => {
      console.error("[db] idle client error", err.message);
    });

    globalThis.__georgePgPool = pool;
  }
  return globalThis.__georgePgPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getPool().query(text, values);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}
