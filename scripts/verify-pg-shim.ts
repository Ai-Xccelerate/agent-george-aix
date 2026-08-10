/**
 * Integration check for the PostgREST shim (src/lib/db/postgrest.ts).
 *
 * Exercises the exact query shapes the codebase uses — pulled from real call
 * sites, not invented — against a live Postgres. Unit tests cover the string
 * parsing; only a real database proves the generated SQL is valid, that embeds
 * resolve their foreign keys, and that SQLSTATE codes survive (the webhook
 * dedupe and the atomic event claim both branch on "23505").
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm tsx scripts/verify-pg-shim.ts
 *
 * Writes are confined to a temporary org row and rolled back by deleting it at
 * the end, so it is safe to point at a staging database.
 */
import { createPostgrestClient } from "../src/lib/db/postgrest";
import { getPool } from "../src/lib/db/pool";

const db = createPostgrestClient();

let passed = 0;
let failed = 0;

/** Multi-row results come back as an array; narrow without fighting the generic. */
function rows(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  console.log("\n— reads —");

  const orgs = await db.from("orgs").select("id, name").limit(5);
  check("select + limit", !orgs.error && Array.isArray(orgs.data), orgs.error);

  const orgId = (orgs.data as Array<{ id: string }> | null)?.[0]?.id;
  if (!orgId) {
    console.error("no org rows to test against — restore data first");
    process.exit(1);
  }

  const one = await db.from("orgs").select("id, name").eq("id", orgId).maybeSingle();
  check("eq + maybeSingle", !one.error && (one.data as { id?: string })?.id === orgId, one.error);

  const missing = await db
    .from("orgs")
    .select("id")
    .eq("id", "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check("maybeSingle on no rows -> null, no error", !missing.error && missing.data === null, missing.error);

  const star = await db.from("agent_sessions").select("*").limit(3);
  check("select *", !star.error, star.error);

  const ordered = await db
    .from("agent_messages")
    .select("id, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  check("order desc + limit", !ordered.error && rows(ordered.data).length <= 5, ordered.error);

  const counted = await db
    .from("agent_messages")
    .select("*", { count: "exact", head: true });
  check("count exact + head", !counted.error && typeof counted.count === "number", counted);
  console.log(`        agent_messages count = ${counted.count}`);

  const inList = await db.from("orgs").select("id").in("id", [orgId]);
  check("in()", !inList.error && rows(inList.data).length === 1, inList.error);

  const isNull = await db.from("agent_sessions").select("id").is("title", null).limit(3);
  check("is(col, null)", !isNull.error, isNull.error);

  const notNull = await db
    .from("agent_sessions")
    .select("id")
    .not("customer_id", "is", null)
    .limit(3);
  check("not(col, is, null)", !notNull.error, notNull.error);

  const ored = await db
    .from("orgs")
    .select("id, name")
    .or("name.ilike.%a%,name.ilike.%e%")
    .limit(5);
  check("or() with ilike terms", !ored.error, ored.error);

  console.log("\n— embedded resources (joins) —");

  const leftEmbed = await db
    .from("audit_log")
    .select("id, action, customer_id, customers(name)")
    .limit(3);
  check("LEFT embed customers(name)", !leftEmbed.error, leftEmbed.error);

  const innerEmbed = await db
    .from("cadences")
    .select("id, customer_id, customers!inner(name, customer_kind)")
    .eq("customers.org_id", orgId)
    .limit(3);
  check("INNER embed + filter on embedded column", !innerEmbed.error, innerEmbed.error);

  const chunkEmbed = await db
    .from("knowledge_chunks")
    .select("content, ordinal, knowledge_docs!inner(path, title, org_id, is_core)")
    .eq("org_id", orgId)
    .eq("knowledge_docs.is_core", false)
    .limit(5);
  check("knowledge_chunks -> knowledge_docs embed", !chunkEmbed.error, chunkEmbed.error);

  // One-to-many: the child holds the FK, so PostgREST returns an ARRAY. Both the
  // customer detail page and get_customer index into this, so an object here is
  // a broken page rather than a caught error.
  //
  // These tables are empty in the migrated data, so assert against fixtures we
  // create — otherwise the check passes vacuously and proves nothing, which is
  // exactly how this bug survived the first round of tests.
  const fx = await db
    .from("customers")
    .insert({ org_id: orgId, name: "shim-verify-customer" })
    .select("id")
    .single();
  const fxCustomer = (fx.data as { id?: string })?.id;
  const plan = await db
    .from("onboarding_plans")
    .insert({ customer_id: fxCustomer })
    .select("id")
    .single();
  const fxPlan = (plan.data as { id?: string })?.id;
  await db.from("onboarding_steps").insert([
    { plan_id: fxPlan, customer_id: fxCustomer, ordinal: 1, title: "first" },
    { plan_id: fxPlan, customer_id: fxCustomer, ordinal: 2, title: "second" },
  ]);

  const toMany = await db
    .from("onboarding_plans")
    .select("id, status, onboarding_steps(id, ordinal, title, status)")
    .eq("id", fxPlan)
    .maybeSingle();
  check("one-to-many embed runs", !toMany.error, toMany.error);
  const steps = (toMany.data as { onboarding_steps?: unknown })?.onboarding_steps;
  check("one-to-many returns an ARRAY, not an object", Array.isArray(steps), steps);
  check(
    "one-to-many returned both child rows",
    Array.isArray(steps) && steps.length === 2,
    Array.isArray(steps) ? steps.length : steps,
  );

  const toManyStar = await db
    .from("onboarding_plans")
    .select("*, onboarding_steps(*)")
    .eq("id", fxPlan)
    .maybeSingle();
  const starSteps = (toManyStar.data as { onboarding_steps?: unknown })?.onboarding_steps;
  check("one-to-many with (*) returns full child rows", Array.isArray(starSteps) && starSteps.length === 2, toManyStar.error);

  const emptyPlan = await db
    .from("customers")
    .insert({ org_id: orgId, name: "shim-verify-empty" })
    .select("id")
    .single();
  const emptyCustomer = (emptyPlan.data as { id?: string })?.id;
  const bare = await db
    .from("onboarding_plans")
    .insert({ customer_id: emptyCustomer })
    .select("id")
    .single();
  const bareRead = await db
    .from("onboarding_plans")
    .select("id, onboarding_steps(id)")
    .eq("id", (bare.data as { id?: string })?.id)
    .maybeSingle();
  check(
    "no children -> [] like PostgREST, not null",
    Array.isArray((bareRead.data as { onboarding_steps?: unknown })?.onboarding_steps) &&
      ((bareRead.data as { onboarding_steps: unknown[] }).onboarding_steps.length === 0),
    (bareRead.data as { onboarding_steps?: unknown })?.onboarding_steps,
  );

  // Cascades clean up plans and steps.
  await db.from("customers").delete().in("id", [fxCustomer, emptyCustomer]);

  // NULLS LAST — Postgres defaults DESC to NULLS FIRST, so this must be explicit
  // or an unsigned contract sorts as the most recent one.
  const nullsLast = await db
    .from("contracts")
    .select("id, signed_at")
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(20);
  check("order with nullsFirst:false", !nullsLast.error, nullsLast.error);
  const seq = rows(nullsLast.data) as Array<{ signed_at: string | null }>;
  const firstNull = seq.findIndex((r) => r.signed_at === null);
  const lastNonNull = seq.map((r) => r.signed_at !== null).lastIndexOf(true);
  check(
    "nulls really sort last",
    firstNull === -1 || lastNonNull === -1 || firstNull > lastNonNull,
    seq.map((r) => r.signed_at),
  );

  console.log("\n— rpc —");

  const vec = `[${Array.from({ length: 1536 }, () => 0.01).join(",")}]`;
  const rpc = await db.rpc("match_knowledge_chunks", {
    p_org_id: orgId,
    p_query: vec,
    p_limit: 5,
  });
  check("rpc match_knowledge_chunks (pgvector)", !rpc.error, rpc.error);

  console.log("\n— writes —");

  const tmpClerkId = `shim-verify-${Date.now()}`;
  const ins = await db
    .from("orgs")
    .insert({ name: "shim-verify-temp", clerk_org_id: tmpClerkId })
    .select("id, name")
    .single();
  check("insert + select + single", !ins.error && Boolean((ins.data as { id?: string })?.id), ins.error);
  const tmpId = (ins.data as { id?: string })?.id;

  const dup = await db
    .from("orgs")
    .insert({ name: "shim-verify-dupe", clerk_org_id: tmpClerkId });
  check("unique violation surfaces SQLSTATE 23505", dup.error?.code === "23505", dup.error);

  const upd = await db
    .from("orgs")
    .update({ name: "shim-verify-updated" })
    .eq("id", tmpId)
    .select("name")
    .maybeSingle();
  check(
    "update + returning",
    !upd.error && (upd.data as { name?: string })?.name === "shim-verify-updated",
    upd.error,
  );

  const noReturn = await db.from("orgs").update({ tagline: "x" }).eq("id", tmpId);
  check("update without select -> data null, no error", !noReturn.error && noReturn.data === null, noReturn.error);

  const upsertIgnore = await db
    .from("orgs")
    .upsert({ clerk_org_id: tmpClerkId, name: "should-not-overwrite" }, {
      onConflict: "clerk_org_id",
      ignoreDuplicates: true,
    });
  check("upsert ignoreDuplicates", !upsertIgnore.error, upsertIgnore.error);

  const afterUpsert = await db.from("orgs").select("name").eq("id", tmpId).maybeSingle();
  check(
    "ignoreDuplicates preserved existing row",
    (afterUpsert.data as { name?: string })?.name === "shim-verify-updated",
    afterUpsert.data,
  );

  const upsertMerge = await db
    .from("orgs")
    .upsert({ clerk_org_id: tmpClerkId, name: "merged" }, { onConflict: "clerk_org_id" });
  check("upsert DO UPDATE", !upsertMerge.error, upsertMerge.error);

  const afterMerge = await db.from("orgs").select("name").eq("id", tmpId).maybeSingle();
  check("upsert merged the row", (afterMerge.data as { name?: string })?.name === "merged", afterMerge.data);

  const del = await db.from("orgs").delete().eq("id", tmpId).select("id");
  check("delete + returning", !del.error, del.error);

  const gone = await db.from("orgs").select("id").eq("id", tmpId).maybeSingle();
  check("row is gone", gone.data === null, gone.data);

  console.log("\n— guardrails (must fail loudly, not silently) —");

  const badOp = await db.from("orgs").select("id").not("name", "eq", "x");
  check("unsupported .not() throws", Boolean(badOp.error), badOp.error?.message);

  const badEmbedFilter = await db.from("orgs").select("id").eq("customers.name", "x");
  check("filter on non-embedded table throws", Boolean(badEmbedFilter.error), badEmbedFilter.error?.message);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await getPool().end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
