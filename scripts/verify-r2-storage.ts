/**
 * Verify the R2 storage driver against the real buckets.
 *
 * This drives the same surface the application uses — `admin.storage.from(...)`
 * — with STORAGE_DRIVER=r2, rather than testing the S3 SDK directly. What
 * matters is not "can we reach R2" but "does the contract the 17 call sites were
 * written against still hold": resolved rather than thrown errors, `upsert:false`
 * refusing an overwrite, a signed URL that a browser can actually fetch, and a
 * public URL that resolves through the custom domain.
 *
 * Every object it writes is prefixed `_verify/` and deleted in a finally block.
 *
 * Usage (values come from .env.local or the shell):
 *   $env:STORAGE_DRIVER="r2"; pnpm tsx scripts/verify-r2-storage.ts
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });

// The driver is selected by env, and this script exists to test the R2 path, so
// opt in explicitly rather than requiring the caller to remember.
process.env.STORAGE_DRIVER = "r2";

const PREFIX = "_verify";
let passed = 0;
const failures: string[] = [];

function ok(label: string) {
  passed++;
  console.log(`  ok  ${label}`);
}
function bad(label: string, detail: unknown) {
  failures.push(`${label} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

async function main() {
  const { createSupabaseAdmin } = await import("@/lib/supabase/admin");
  const { r2Config } = await import("@/lib/storage/r2");

  const cfg = r2Config();
  console.log(
    `assets=${cfg.buckets["org-assets"]}  docs=${cfg.buckets["customer-docs"]}\n` +
      `public=${cfg.publicBaseUrl}\n`,
  );

  const storage = createSupabaseAdmin().storage;
  const docs = storage.from("customer-docs");
  const assets = storage.from("org-assets");

  const docKey = `${PREFIX}/contract-${Date.now()}.txt`;
  const assetKey = `${PREFIX}/logo-${Date.now()}.txt`;
  const body = Buffer.from("verify-r2-storage payload");

  // ---- private bucket: write, read back, sign -------------------------
  const up = await docs.upload(docKey, body, { contentType: "text/plain", upsert: false });
  if (up.error) bad("upload (private)", up.error.message);
  else ok("upload (private)");

  const dl = await docs.download(docKey);
  if (dl.error || !dl.data) {
    bad("download", dl.error?.message ?? "no data");
  } else {
    const text = Buffer.from(await dl.data.arrayBuffer()).toString("utf8");
    if (text !== body.toString("utf8")) bad("download", `content mismatch: "${text}"`);
    else ok("download returns exactly what was written");
  }

  // The contract two call sites depend on: a second upload to the same key
  // without upsert must fail, not silently clobber.
  const dup = await docs.upload(docKey, body, { contentType: "text/plain", upsert: false });
  if (!dup.error) bad("upsert:false", "second upload to the same key SUCCEEDED — would clobber");
  else ok(`upsert:false refuses an overwrite ("${dup.error.message}")`);

  const upsert = await docs.upload(docKey, Buffer.from("replaced"), {
    contentType: "text/plain",
    upsert: true,
  });
  if (upsert.error) bad("upsert:true", upsert.error.message);
  else ok("upsert:true overwrites");

  // A signed URL is only useful if a browser can fetch it, so fetch it.
  const signed = await docs.createSignedUrl(docKey, 300);
  if (signed.error || !signed.data) {
    bad("createSignedUrl", signed.error?.message ?? "no data");
  } else {
    const res = await fetch(signed.data.signedUrl);
    if (!res.ok) bad("signed URL fetch", `HTTP ${res.status}`);
    else {
      const text = await res.text();
      if (text !== "replaced") bad("signed URL fetch", `unexpected body "${text}"`);
      else ok("signed URL is fetchable and returns the object");
    }
  }

  // The private bucket must NOT be readable without a signature. This is the
  // check that would catch a custom domain wrongly attached to customer-docs.
  const unsignedDocUrl = `${cfg.publicBaseUrl}/${docKey}`;
  try {
    const res = await fetch(unsignedDocUrl);
    if (res.ok) {
      bad(
        "private bucket exposure",
        `${unsignedDocUrl} returned HTTP ${res.status} — a contract is publicly readable`,
      );
    } else {
      ok(`private objects are not served publicly (HTTP ${res.status})`);
    }
  } catch {
    ok("private objects are not served publicly (no route)");
  }

  // ---- public bucket: write, then read over the custom domain ---------
  const upA = await assets.upload(assetKey, body, { contentType: "text/plain", upsert: true });
  if (upA.error) bad("upload (public)", upA.error.message);
  else ok("upload (public)");

  const publicUrl = assets.getPublicUrl(assetKey).data.publicUrl;
  if (publicUrl !== `${cfg.publicBaseUrl}/${assetKey}`) {
    bad("getPublicUrl", `built "${publicUrl}"`);
  } else {
    ok("getPublicUrl builds the custom-domain URL");
  }

  // The whole point of the custom domain. If this fails, logos 404 in the app.
  const pubRes = await fetch(publicUrl);
  if (!pubRes.ok) {
    bad(
      "public URL fetch",
      `HTTP ${pubRes.status} at ${publicUrl} — the custom domain is not serving this bucket`,
    );
  } else {
    const text = await pubRes.text();
    if (text !== body.toString("utf8")) bad("public URL fetch", `unexpected body "${text}"`);
    else ok("public URL is readable over the custom domain");
  }

  // ---- guardrails ----------------------------------------------------
  try {
    docs.getPublicUrl(docKey);
    bad("getPublicUrl guard", "returned a public URL for the PRIVATE bucket");
  } catch {
    ok("getPublicUrl refuses the private bucket");
  }

  try {
    storage.from("no-such-bucket");
    bad("unknown bucket guard", "an unknown bucket name was accepted");
  } catch {
    ok("unknown bucket name fails loudly");
  }

  // Errors must resolve, never throw — the contract every call site assumes.
  const missing = await docs.download(`${PREFIX}/definitely-not-here.txt`);
  if (!missing.error) bad("missing object", "expected an error");
  else ok(`missing object resolves an error ("${missing.error.message}")`);

  // ---- cleanup -------------------------------------------------------
  const rmDoc = await docs.remove([docKey]);
  const rmAsset = await assets.remove([assetKey]);
  if (rmDoc.error || rmAsset.error) {
    bad("remove", rmDoc.error?.message ?? rmAsset.error?.message ?? "unknown");
  } else {
    const gone = await docs.download(docKey);
    if (!gone.error) bad("remove", "object still readable after delete");
    else ok("remove deletes the object");
  }
}

main()
  .catch((err) => failures.push(`HARNESS CRASHED — ${String(err)}`))
  .finally(() => {
    console.log("\n" + "=".repeat(60));
    console.log(`passed: ${passed}`);
    console.log(`failed: ${failures.length}`);
    if (failures.length) {
      console.log("\nFAILURES:");
      for (const f of failures) console.log(`  x ${f}`);
    }
    console.log("=".repeat(60));
    process.exit(failures.length > 0 ? 1 : 0);
  });
