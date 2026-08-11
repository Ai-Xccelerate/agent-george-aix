/**
 * Copy every object from the Supabase Storage buckets into the R2 buckets.
 *
 * Paths are preserved exactly. That is what makes the switch a no-op for the
 * database: `documents.storage_path`, `orgs.logo_square_path` and friends hold a
 * PATH, not a URL, so once the same paths exist in R2 the same rows resolve
 * against the new backend with no migration of their own.
 *
 * Idempotent — an object already present in R2 with the same size is skipped, so
 * this can be re-run right before the cutover to catch anything uploaded in the
 * meantime. Nothing is deleted from Supabase; the copy is additive and the old
 * files stay put until the project is decommissioned.
 *
 * Usage:
 *   pnpm tsx scripts/copy-storage-to-r2.ts            # report only
 *   pnpm tsx scripts/copy-storage-to-r2.ts --apply    # actually copy
 */
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local", override: false });

const APPLY = process.argv.includes("--apply");

/** Logical bucket -> the Supabase bucket name, which is the logical name. */
const BUCKETS = ["org-assets", "customer-docs"] as const;

type Entry = { path: string; size: number };

/**
 * Supabase's list() is per-prefix and does not recurse, so walk it. Files have
 * an `id`; folders come back with a null id, which is the only reliable way to
 * tell them apart.
 */
async function listRecursive(
  sb: SupabaseClient,
  bucket: string,
  prefix = "",
): Promise<Entry[]> {
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);

  const out: Entry[] = [];
  for (const item of data ?? []) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      out.push(...(await listRecursive(sb, bucket, full)));
    } else {
      const size = (item.metadata as { size?: number } | null)?.size ?? 0;
      out.push({ path: full, size });
    }
  }
  return out;
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase variables are required — this reads FROM Supabase Storage. " +
        "They must stay set until the storage cutover is complete.",
    );
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Force the R2 driver for the destination regardless of how this environment
  // is configured — copying into Supabase-from-Supabase would be a no-op that
  // silently reported success.
  process.env.STORAGE_DRIVER = "r2";
  const { createR2Storage, r2Config } = await import("@/lib/storage/r2");
  const cfg = r2Config();
  const r2 = createR2Storage();

  console.log(
    `source: ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n` +
      `target: ${cfg.buckets["org-assets"]} / ${cfg.buckets["customer-docs"]}\n` +
      (APPLY ? "mode:   APPLY\n" : "mode:   dry run (pass --apply to copy)\n"),
  );

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const bucket of BUCKETS) {
    const entries = await listRecursive(sb, bucket);
    console.log(`${bucket}: ${entries.length} object(s)`);

    for (const entry of entries) {
      // Already there at the same size? Leave it. Size is a weak equality check
      // but the alternative is hashing both sides on every re-run, and these
      // paths are content-addressed by uuid in practice.
      const existing = await r2.from(bucket).download(entry.path);
      if (!existing.error && existing.data && existing.data.size === entry.size) {
        console.log(`  skip  ${entry.path} (${entry.size} B, already in R2)`);
        skipped++;
        continue;
      }

      if (!APPLY) {
        console.log(`  would copy  ${entry.path} (${entry.size} B)`);
        copied++;
        continue;
      }

      const dl = await sb.storage.from(bucket).download(entry.path);
      if (dl.error || !dl.data) {
        console.error(`  FAIL  ${entry.path} — download: ${dl.error?.message ?? "no data"}`);
        failed++;
        continue;
      }

      const bytes = Buffer.from(await dl.data.arrayBuffer());
      const up = await r2.from(bucket).upload(entry.path, bytes, {
        contentType: dl.data.type || "application/octet-stream",
        upsert: true,
      });
      if (up.error) {
        console.error(`  FAIL  ${entry.path} — upload: ${up.error.message}`);
        failed++;
        continue;
      }

      // Read it back rather than trusting a 200 — a truncated copy of a contract
      // is worse than a failed one, because nothing would flag it.
      const back = await r2.from(bucket).download(entry.path);
      if (back.error || !back.data || back.data.size !== bytes.length) {
        console.error(
          `  FAIL  ${entry.path} — verify: expected ${bytes.length} B, got ${back.data?.size ?? "error"}`,
        );
        failed++;
        continue;
      }

      console.log(`  copied  ${entry.path} (${bytes.length} B, verified)`);
      copied++;
    }
  }

  console.log(
    `\n${APPLY ? "copied" : "would copy"}: ${copied}   skipped: ${skipped}   failed: ${failed}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
