/**
 * Verify the Parchment integration against a real instance.
 *
 * This is the check unit tests cannot fake: whether the shared secret works,
 * whether an org resolves to a workspace, and whether George's own
 * `search_knowledge` tool actually returns Parchment sections rather than
 * silently falling back to local search.
 *
 * Read-only. The internal agent path is read-and-propose only, so there is
 * nothing here that can write to a workspace — /ingest is refused by design.
 *
 * Usage:
 *   pnpm verify:parchment                 # uses the AIX org from the database
 *   pnpm verify:parchment -- <clerk_org>  # or a specific Clerk org id
 *
 * Requires PARCHMENT_API_URL + PARCHMENT_INTERNAL_AGENT_KEY, and DATABASE_URL if
 * you want it to look the org up rather than passing one.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });

let passed = 0;
const failures: string[] = [];
const notes: string[] = [];

const ok = (label: string) => {
  passed++;
  console.log(`  ok    ${label}`);
};
const bad = (label: string, detail: string) => {
  failures.push(`${label} — ${detail}`);
  console.log(`  FAIL  ${label}`);
};
const note = (label: string) => {
  notes.push(label);
  console.log(`  note  ${label}`);
};

async function main() {
  const { createParchmentClient, documentCount, parchmentDeployment, parchmentMissingVars } =
    await import("@/lib/parchment/client");

  const deployment = parchmentDeployment();
  if (!deployment) {
    console.error(
      `Parchment is not configured. Missing: ${parchmentMissingVars().join(", ")}\n\n` +
        `Set these in .env.local:\n` +
        `  PARCHMENT_API_URL=https://parchment-api-staging.aiworkforce.md\n` +
        `  PARCHMENT_INTERNAL_AGENT_KEY=...   # the shared internal agent secret\n\n` +
        `This is the internal agent path — there is no per-workspace API key to mint.`,
    );
    process.exit(1);
  }

  // Which org to test as. Parchment identifies tenants by Clerk org id.
  let clerkOrgId = process.argv.slice(2).find((a) => a.startsWith("org_"));
  if (!clerkOrgId) {
    if (!process.env.DATABASE_URL) {
      console.error(
        "Pass a Clerk org id (org_...) or set DATABASE_URL so the org can be looked up.",
      );
      process.exit(1);
    }
    const { query } = await import("@/lib/db/pool");
    const { rows } = await query<{ clerk_org_id: string | null; name: string }>(
      "select clerk_org_id, name from orgs where clerk_org_id is not null order by created_at limit 1",
    );
    if (rows.length === 0) {
      console.error("No org in the database has a clerk_org_id yet — sign in once through Core.");
      process.exit(1);
    }
    clerkOrgId = rows[0].clerk_org_id!;
    console.log(`org: ${rows[0].name} (${clerkOrgId})`);
  }

  console.log(`endpoint: ${deployment.base}`);
  console.log(`key:      ${deployment.internalKey.slice(0, 6)}…  (read-only run)\n`);

  const client = createParchmentClient({ ...deployment, clerkOrgId });

  // ---- reachability ---------------------------------------------------
  const health = await client.health();
  if (!health.ok) {
    bad("health", health.error);
    console.error("\nCannot reach Parchment — aborting the rest of the checks.");
    return;
  }
  ok(`health (database: ${health.data?.database ?? "unknown"})`);

  // ---- the credential resolves this org to a workspace ----------------
  // Also the provisioning step: first call for a new org creates its default.
  const ws = await client.resolveWorkspaces();
  if (!ws.ok) {
    bad("workspaces/resolve — is the internal key right, and enabled on this instance?", ws.error);
    return;
  }
  const workspaces = ws.data.workspaces ?? [];
  ok(
    `resolved org to ${workspaces.length} workspace(s), default ${ws.data.default_workspace_id?.slice(0, 8)}…`,
  );
  if (workspaces.length === 0) {
    note("resolve returned no workspaces, which is unexpected — provisioning may have failed.");
  }

  // ---- reads -----------------------------------------------------------
  const docs = await client.documents();
  if (!docs.ok) {
    bad("documents", docs.error);
  } else {
    const count = documentCount(docs.data);
    if (count === null) {
      bad("documents", `unrecognised response shape: ${JSON.stringify(docs.data).slice(0, 120)}`);
    } else {
      ok(`documents (${count} in this workspace)`);
      if (count === 0) {
        note(
          "workspace is EMPTY — searches will return nothing, so a green run here does not mean George will find anything. Add content in Parchment.",
        );
      }
    }
  }

  const q = await client.query({ query: "onboarding process", limit: 3 });
  if (!q.ok) {
    bad("query", q.error);
  } else {
    ok(`query returned ${q.data.count ?? q.data.results?.length ?? 0} result(s)`);
    const first = (q.data.results ?? [])[0];
    if (!first) {
      note("query matched nothing — not proof the search path is broken if the workspace is empty.");
    } else if (!first.section_id || !first.hierarchy_path) {
      bad("query result shape", "missing section_id or hierarchy_path (lost provenance)");
    } else {
      ok(`sections carry provenance ("${first.hierarchy_path}")`);
      const sec = await client.section(first.section_id);
      if (!sec.ok) bad("sections/{id}", sec.error);
      else ok("sections/{id} retrieves a single section");
    }
  }

  // ---- George's tool, end to end --------------------------------------
  // The point of the integration: the tool the agent calls must report
  // mode:"parchment", not fall back to local search.
  if (!process.env.DATABASE_URL) {
    note("skipped the search_knowledge tool check — needs DATABASE_URL to resolve the org row.");
  } else {
    const { query } = await import("@/lib/db/pool");
    const { rows } = await query<{ id: string }>(
      "select id from orgs where clerk_org_id = $1 limit 1",
      [clerkOrgId],
    );
    if (rows.length === 0) {
      note(`no local org row for ${clerkOrgId} — skipped the tool check.`);
    } else {
      const { buildGeorgeMcpServer } = await import("@/lib/agent/tools");
      const { server } = buildGeorgeMcpServer({ orgId: rows[0].id, userId: null });
      const reg = (
        server as unknown as {
          instance: {
            _registeredTools: Record<
              string,
              {
                handler: (
                  a: unknown,
                  b: unknown,
                ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
              }
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
            `fell back to mode="${payload.mode}" — Parchment is not actually in the agent's path`,
          );
        } else {
          ok(`search_knowledge uses Parchment (mode=parchment, ${payload.hits?.length ?? 0} hits)`);
        }
      }
      const { getPool } = await import("@/lib/db/pool");
      await getPool().end();
    }
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
