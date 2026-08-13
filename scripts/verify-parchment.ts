/**
 * Verify the Parchment integration against a real workspace.
 *
 * This is the check that cannot be faked by unit tests: whether the key works,
 * whether the workspace has content, and whether George's `search_knowledge`
 * tool actually returns Parchment sections rather than falling back to local
 * search. Read-only by default — pass --write to also exercise ingestion, which
 * requires an editor-role key and writes a clearly-marked probe document.
 *
 * Usage:
 *   pnpm verify:parchment              # read-only
 *   pnpm verify:parchment -- --write   # also test /ingest (editor key needed)
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });

const WRITE = process.argv.includes("--write");

let passed = 0;
const failures: string[] = [];
const notes: string[] = [];

function ok(label: string) {
  passed++;
  console.log(`  ok    ${label}`);
}
function bad(label: string, detail: string) {
  failures.push(`${label} — ${detail}`);
  console.log(`  FAIL  ${label}`);
}
function note(label: string) {
  notes.push(label);
  console.log(`  note  ${label}`);
}

async function main() {
  const { isParchmentEnabled, parchment, parchmentConfig, parchmentMissingVars, toKnowledgeHits } =
    await import("@/lib/parchment/client");

  if (!isParchmentEnabled()) {
    console.error(
      `Parchment is not configured. Missing: ${parchmentMissingVars().join(", ")}\n\n` +
        `Set them in .env.local:\n` +
        `  PARCHMENT_API_BASE=https://<parchment-api-host>\n` +
        `  PARCHMENT_API_KEY=pcm_...        # agent role for read, editor to ingest\n\n` +
        `The key must belong to an AIX workspace — keys are workspace-bound, so an\n` +
        `Onyx key would read Onyx's knowledge.`,
    );
    process.exit(1);
  }

  const cfg = parchmentConfig()!;
  console.log(`endpoint: ${cfg.base}`);
  console.log(`key:      ${cfg.apiKey.slice(0, 8)}…  (${WRITE ? "write tests ON" : "read-only"})\n`);

  // ---- reachability ---------------------------------------------------
  const health = await parchment.health();
  if (!health.ok) {
    bad("health", health.error);
    // Everything downstream will fail the same way; stop with a clear reason.
    console.error("\nCannot reach Parchment — aborting the rest of the checks.");
    return;
  }
  ok(`health (database: ${health.data?.database ?? "unknown"})`);

  // ---- the key is valid and scoped to a workspace ---------------------
  const docs = await parchment.documents();
  if (!docs.ok) {
    bad("documents — is the key valid for this workspace?", docs.error);
  } else {
    const count = Array.isArray(docs.data) ? docs.data.length : 0;
    ok(`documents (${count} in this workspace)`);
    if (count === 0) {
      note(
        "workspace is EMPTY — searches will return nothing, so a green run here does not mean George will find anything. Ingest content first.",
      );
    }
  }

  const taxonomy = await parchment.taxonomy();
  if (!taxonomy.ok) bad("taxonomy", taxonomy.error);
  else ok("taxonomy");

  const overview = await parchment.overview();
  if (!overview.ok) bad("knowledge/overview", overview.error);
  else ok("knowledge/overview");

  // ---- query: the endpoint George actually depends on -----------------
  const q = await parchment.query({ query: "onboarding process", limit: 3 });
  if (!q.ok) {
    bad("query", q.error);
  } else {
    ok(`query returned ${q.data.count ?? q.data.results.length} result(s)`);

    if (q.data.results.length === 0) {
      note(
        "query matched nothing — either the workspace is empty or the term is absent. Not proof the search path is broken.",
      );
    } else {
      const first = q.data.results[0];
      // Sections, not chunks: this is the whole reason for using Parchment.
      if (!first.section_id) bad("query result shape", "no section_id");
      else if (!first.hierarchy_path) bad("query result shape", "no hierarchy_path (lost provenance)");
      else ok(`sections carry provenance ("${first.hierarchy_path}")`);

      // Follow-up retrieval, used when George needs full ancestor context.
      const sec = await parchment.section(first.section_id);
      if (!sec.ok) bad("sections/{id}", sec.error);
      else ok("sections/{id} retrieves a single section");

      // The mapping George's tool depends on.
      const hits = toKnowledgeHits(q.data);
      if (hits.length !== q.data.results.length) {
        bad("toKnowledgeHits", `mapped ${hits.length} of ${q.data.results.length}`);
      } else if (hits[0].is_core !== false) {
        bad("toKnowledgeHits", "Parchment hits must be marked non-core");
      } else {
        ok("maps onto the shape search_knowledge already returns");
      }
    }
  }

  // ---- George's tool, end to end --------------------------------------
  // The point of the integration: the tool the agent calls must return
  // mode:"parchment", not fall back to local search.
  const { buildGeorgeMcpServer } = await import("@/lib/agent/tools");
  const { server } = buildGeorgeMcpServer({
    orgId: "00000000-0000-0000-0000-000000000001",
    userId: null,
  });
  const reg = (
    server as unknown as {
      instance: {
        _registeredTools: Record<
          string,
          { handler: (a: unknown, b: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }
        >;
      };
    }
  ).instance._registeredTools;

  const res = await reg["search_knowledge"].handler({ query: "onboarding process" }, {});
  if (res.isError) {
    bad("search_knowledge tool", res.content?.[0]?.text?.slice(0, 200) ?? "unknown");
  } else {
    const payload = JSON.parse(res.content[0].text) as { mode?: string; hits?: unknown[] };
    if (payload.mode !== "parchment") {
      bad(
        "search_knowledge tool",
        `fell back to mode="${payload.mode}" instead of querying Parchment — the integration is not actually in the path`,
      );
    } else {
      ok(`search_knowledge uses Parchment (mode=parchment, ${payload.hits?.length ?? 0} hits)`);
    }
  }

  // ---- ingestion (editor key only) ------------------------------------
  if (WRITE) {
    const probePath = "supplemental/_george-verify-probe.md";
    const ing = await parchment.ingest({
      source_file: probePath,
      content:
        "# George verification probe\n\nWritten by scripts/verify-parchment.ts to confirm ingestion works. Safe to delete.\n",
    });
    if (!ing.ok) {
      bad("ingest (needs an editor-role key)", ing.error);
    } else {
      ok(`ingest accepted (job ${ing.data.job_id})`);
      // The job is async; a 202 alone proves nothing about the outcome.
      const status = await parchment.status(ing.data.job_id);
      if (!status.ok) bad("status/{job_id}", status.error);
      else ok(`status/{job_id} reports "${status.data.status}"`);
      note(
        `left "${probePath}" in the workspace — remove it from the Parchment console if you do not want it there.`,
      );
    }
  } else {
    note("ingestion not tested (read-only run). Pass --write with an editor key to test it.");
  }
}

main()
  .catch((err) => failures.push(`HARNESS CRASHED — ${String(err)}`))
  .finally(() => {
    console.log("\n" + "=".repeat(64));
    console.log(`passed: ${passed}`);
    console.log(`failed: ${failures.length}`);
    if (notes.length) {
      console.log("\nNOTES (not failures, but read them):");
      for (const n of notes) console.log(`  - ${n}`);
    }
    if (failures.length) {
      console.log("\nFAILURES:");
      for (const f of failures) console.log(`  x ${f}`);
    }
    console.log("=".repeat(64));
    process.exit(failures.length > 0 ? 1 : 0);
  });
