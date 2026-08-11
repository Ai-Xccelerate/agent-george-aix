/**
 * End-to-end verification of George's DB-backed tools against the Postgres shim.
 *
 * WHY THIS EXISTS, ON TOP OF verify-pg-shim.ts
 * That script proves the shim's *query translator* works, using queries it
 * writes itself. This one proves the *application* works, by calling the real
 * tool handlers from src/lib/agent/tools.ts — the same code paths a live chat
 * hits — with the shim underneath. It is the difference between "my SQL is
 * right" and "George still works".
 *
 * It also solves a problem the migrated database has: it is nearly empty of
 * business data (0 customers, 0 contracts, 0 objectives, 0 cadences). Every
 * read tool would "pass" by returning [], proving nothing — the exact vacuous
 * pass that let the one-to-many embed bug survive its first test. So this
 * script SEEDS a realistic fixture graph first, then asserts that reads come
 * back NON-EMPTY. An empty result is a failure here, not a pass.
 *
 * Fixtures are built by the write tools wherever a tool exists for the job, so
 * the write path is exercised rather than bypassed with raw INSERTs. Raw SQL is
 * used only for tables no tool can create (mail, calendar, transcripts,
 * documents, knowledge docs) and for the org/member rows themselves.
 *
 * SAFETY
 *   - Refuses to run unless DATABASE_URL is set (otherwise it would write to
 *     the live Supabase database instead of the migration target).
 *   - Everything is scoped to one throwaway org id and deleted in a finally
 *     block. Nothing touches a real org's rows.
 *   - Composio tools (draft_email, send_email_draft, create_calendar_event,
 *     list_recent_emails, get_email, search_emails, get_thread,
 *     list_calendar_events) are DELIBERATELY EXCLUDED. They call live Outlook
 *     through Composio, not the database — running them would create real
 *     drafts and real calendar invites, and they prove nothing about the shim.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://...tunnel..."; pnpm tsx scripts/verify-tools-on-pg.ts
 */
import { config as loadEnv } from "dotenv";
import { buildGeorgeMcpServer } from "@/lib/agent/tools";
import { query } from "@/lib/db/pool";

// read_document reaches for Supabase Storage, which needs the Supabase vars even
// on a fully-migrated database. Loading .env.local mirrors the deployed
// environment; DATABASE_URL from the shell still wins, so the tunnel URL is not
// overwritten by whatever the file happens to hold.
loadEnv({ path: ".env.local", override: false });

if (!process.env.DATABASE_URL) {
  console.error(
    "REFUSING TO RUN: DATABASE_URL is unset, so the admin client would talk to\n" +
      "live Supabase and these fixtures would be written to the real database.\n" +
      "Open the Railway tunnel and set DATABASE_URL first.",
  );
  process.exit(1);
}

// Fixed ids so a crashed run can be cleaned up by re-running, and so nothing
// collides with real data. Valid v4-shaped uuids: Postgres validates the type.
const ORG = "ffffffff-ffff-4fff-8fff-ffffffffff01";
const USER = "user_shimtest0000000000000";
const DOC_CORE = "ffffffff-ffff-4fff-8fff-ffffffffff11";
const DOC_SUPP = "ffffffff-ffff-4fff-8fff-ffffffffff12";
const TRANSCRIPT = "ffffffff-ffff-4fff-8fff-ffffffffff21";
const DOCUMENT = "ffffffff-ffff-4fff-8fff-ffffffffff31";
const CONVERSATION = "shimtest-conversation-1";

const { server } = buildGeorgeMcpServer({ orgId: ORG, userId: USER });
const registered = (
  server as unknown as {
    instance: { _registeredTools: Record<string, { handler: Handler }> };
  }
).instance._registeredTools;

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

let passed = 0;
const failures: string[] = [];
/** Tools that returned an empty collection where fixtures should have produced rows. */
const vacuous: string[] = [];

/**
 * Call a tool the way the agent runtime does and judge the result.
 *
 * `expect` receives the parsed payload. Returning a string means failure with
 * that reason — this is how "succeeded but returned nothing" becomes a failure
 * rather than a green tick.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  expect?: (payload: any) => string | void,
  opts?: {
    /**
     * A tool error whose message matches this is the expected outcome. Used for
     * the one tool that must fail here for a reason unrelated to the shim.
     */
    expectErrorMatching?: RegExp;
  },
): Promise<any> {
  const entry = registered[name];
  if (!entry) {
    failures.push(`${name}: NOT REGISTERED — tool renamed or removed?`);
    return undefined;
  }
  let res: ToolResult;
  try {
    res = await entry.handler(args, {});
  } catch (err) {
    // A handler throwing is its own class of bug: supabase-js resolves rather
    // than rejects, so the shim must never surface an exception here.
    failures.push(`${name}: THREW (shim broke the {data,error} contract) — ${String(err)}`);
    return undefined;
  }

  const text = res.content?.[0]?.text ?? "";
  if (res.isError) {
    if (opts?.expectErrorMatching?.test(text)) {
      passed++;
      console.log(`  ok  ${name} (expected error: ${text.slice(0, 60)})`);
      return undefined;
    }
    failures.push(`${name}: tool error — ${text.slice(0, 300)}`);
    return undefined;
  }
  if (opts?.expectErrorMatching) {
    failures.push(`${name}: expected an error matching ${opts.expectErrorMatching} but it succeeded`);
    return undefined;
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (expect) {
    const problem = expect(payload);
    if (problem) {
      const line = `${name}: ${problem}`;
      // Distinguish "wrong answer" from "no data to answer with" — the second
      // is what makes a test suite lie to you.
      if (problem.startsWith("EMPTY")) vacuous.push(line);
      else failures.push(line);
      return payload;
    }
  }

  passed++;
  console.log(`  ok  ${name}`);
  return payload;
}

/** Assert a value is a non-empty array. */
const nonEmpty = (v: unknown, label: string): string | void => {
  if (!Array.isArray(v)) return `expected ${label} to be an array, got ${typeof v}`;
  if (v.length === 0) return `EMPTY ${label} — fixtures should have produced rows`;
};

async function seedRawFixtures() {
  // Org + member. set_customer_owner resolves an email against org_members, so
  // the member row is load-bearing, not decoration.
  await query(
    `insert into orgs (id, name, domain, display_name, default_timezone)
     values ($1, 'SHIM TEST ORG', 'shimtest.invalid', 'Shim Test', 'Asia/Kolkata')
     on conflict (id) do nothing`,
    [ORG],
  );
  await query(
    `insert into org_members (org_id, user_id, role, full_name, email)
     values ($1, $2, 'owner', 'Shim Tester', 'tester@shimtest.invalid')
     on conflict (org_id, user_id) do nothing`,
    [ORG, USER],
  );

  // Knowledge docs: one core, one supplemental. read_knowledge_doc fetches by
  // path; search_knowledge's ilike fallback scores over content.
  await query(
    `insert into knowledge_docs (id, org_id, path, title, content_md, is_core, status, source)
     values ($1, $2, 'core/01-shim-test-playbook.md', 'Shim Test Playbook',
             'The renewal clock starts at T-90 and the CSM owns the utilization review.',
             true, 'active', 'seed'),
            ($3, $2, 'supplemental/licensing-notes.md', 'Licensing Notes',
             'Supplier onboarding requires a signed order form before provisioning licenses.',
             false, 'active', 'seed')
     on conflict (id) do nothing`,
    [DOC_CORE, ORG, DOC_SUPP],
  );

  // search_knowledge scores over knowledge_chunks, not knowledge_docs — seeding
  // only the docs is why the first run reported an empty result. Embeddings are
  // left NULL so the ilike fallback is what gets exercised; the pgvector RPC
  // path is proven separately in verify-pg-shim.ts. Chunks hang off the
  // SUPPLEMENTAL doc because the tool deliberately excludes core docs.
  await query(
    `insert into knowledge_chunks (doc_id, org_id, ordinal, content)
     values ($1, $2, 0, 'Supplier onboarding requires a signed order form before provisioning licenses.'),
            ($1, $2, 1, 'Licenses are provisioned within two business days of the order form being countersigned.')
     on conflict do nothing`,
    [DOC_SUPP, ORG],
  );

  // Mail: two in one thread plus one with a NULL received_at. The null is the
  // point — mailbox ordering is DESC with nullsFirst:false, which Postgres does
  // not do by default, so a regression here shows up as the undated mail
  // sorting to the top.
  await query(
    `insert into email_messages
       (org_id, external_id, conversation_id, direction, subject, body_preview,
        from_address, from_name, to_recipients, received_at, is_read)
     values
       ($1, 'shimtest-mail-1', $2, 'inbound', 'Renewal question',
        'Wanted to check the renewal timeline', 'ops@shimtest.invalid', 'Ops',
        '[{"address":"george@shimtest.invalid"}]'::jsonb, now() - interval '2 days', false),
       ($1, 'shimtest-mail-2', $2, 'outbound', 'RE: Renewal question',
        'Here is the timeline', 'george@shimtest.invalid', 'George',
        '[{"address":"ops@shimtest.invalid"}]'::jsonb, now() - interval '1 day', true),
       ($1, 'shimtest-mail-3', 'shimtest-conversation-2', 'inbound', 'Undated message',
        'No received_at on purpose', 'ops@shimtest.invalid', 'Ops',
        '[{"address":"george@shimtest.invalid"}]'::jsonb, null, false)
     on conflict (org_id, external_id) do nothing`,
    [ORG, CONVERSATION],
  );

  await query(
    `insert into calendar_events
       (org_id, external_id, subject, start_at, end_at, organizer_address, attendees)
     values ($1, 'shimtest-cal-1', 'Quarterly review', now() + interval '2 days',
             now() + interval '2 days' + interval '1 hour', 'george@shimtest.invalid',
             '[{"address":"ops@shimtest.invalid"}]'::jsonb)
     on conflict (org_id, external_id) do nothing`,
    [ORG],
  );

  await query(
    `insert into meeting_transcripts
       (id, org_id, external_id, title, status, started_at, ended_at, duration_min,
        attendees, transcript_text, segment_count, summary)
     values ($1, $2, 'shimtest-ff-1', 'Quarterly review call', 'processed',
             now() - interval '3 days', now() - interval '3 days' + interval '45 minutes',
             45, '[{"name":"Ops"}]'::jsonb,
             'Ops raised the licensing question and asked about the renewal clock.',
             12, 'Renewal timeline and licensing discussed.')
     on conflict (id) do nothing`,
    [TRANSCRIPT, ORG],
  );

  // read_document reads the row, then downloads from storage. Storage still
  // points at Supabase, so the download is expected to fail on a fixture path —
  // what is being verified here is the DB read, and that the tool degrades
  // without throwing.
  await query(
    `insert into documents
       (id, org_id, storage_path, original_name, mime_type, file_size, kind)
     values ($1, $2, 'shimtest/does-not-exist.pdf', 'order-form.pdf',
             'application/pdf', 1024, 'order_form')
     on conflict (id) do nothing`,
    [DOCUMENT, ORG],
  );
}

async function cleanup() {
  // Children first where no cascade is guaranteed. customers cascades to
  // contacts/contracts/plans/steps/health/cadences via FK, but being explicit
  // costs nothing and makes a partial-schema surprise loud instead of silent.
  const scoped = [
    "knowledge_chunks",
    "knowledge_proposals",
    "knowledge_docs",
    "email_messages",
    "calendar_events",
    "meeting_transcripts",
    "documents",
    "escalations",
    "domain_allowlist",
    "objectives",
    "cadences",
    "audit_log",
    "agent_events",
    // agent_messages is scoped by session, not org — deleted via agent_sessions.
    "agent_sessions",
    "agent_settings",
    "agent_scan_state",
  ];
  for (const t of scoped) {
    try {
      await query(`delete from ${t} where org_id = $1`, [ORG]);
    } catch (err) {
      console.warn(`  cleanup: ${t} — ${(err as Error).message}`);
    }
  }
  // customer-scoped tables have no org_id of their own.
  for (const t of ["onboarding_steps", "contacts", "contracts", "onboarding_plans", "customer_health"]) {
    try {
      await query(
        `delete from ${t} where customer_id in (select id from customers where org_id = $1)`,
        [ORG],
      );
    } catch (err) {
      console.warn(`  cleanup: ${t} — ${(err as Error).message}`);
    }
  }
  await query(`delete from customers where org_id = $1`, [ORG]);
  await query(`delete from org_members where org_id = $1`, [ORG]);
  await query(`delete from orgs where id = $1`, [ORG]);
}

async function main() {
  console.log("Seeding raw fixtures (tables no tool can create)…");
  await seedRawFixtures();

  console.log("\nPhase 1 — write tools build the rest of the graph");
  const partner = await callTool(
    "create_customer",
    {
      name: "Shimtest Partner Ltd",
      domain: "shimtest-partner.invalid",
      lifecycle: "onboarding",
      customer_kind: "partner",
      industry: "Logistics",
      notes: "Fixture created by verify-tools-on-pg.",
    },
    (p) => (p?.customer?.id ? undefined : "no customer id returned"),
  );
  const partnerId: string | undefined = partner?.customer?.id;
  if (!partnerId) {
    console.error("\nFATAL: create_customer did not return an id — nothing downstream can run.");
    return;
  }

  // Child customer exercises parent_customer_id, the hierarchy the Customers
  // page filters on.
  const child = await callTool(
    "create_customer",
    {
      name: "Shimtest End Customer",
      domain: "shimtest-end.invalid",
      lifecycle: "active",
      customer_kind: "end_customer",
      parent_customer_id: partnerId,
    },
    (p) => (p?.customer?.id ? undefined : "no customer id returned"),
  );
  const childId: string | undefined = child?.customer?.id;

  const contact = await callTool(
    "add_contact",
    {
      customer_id: partnerId,
      full_name: "Priya Ops",
      email: "priya@shimtest-partner.invalid",
      title: "Head of Ops",
      is_primary: true,
    },
    (p) => (p?.contact?.id ? undefined : "no contact id returned"),
  );
  const contactId: string | undefined = contact?.contact?.id;

  // Two contracts: one signed, one never signed. "Latest contract" orders DESC
  // with nullsFirst:false — if that flag is dropped, the UNSIGNED one wins.
  await callTool("record_contract", {
    customer_id: partnerId,
    status: "active",
    arr_cents: 4_800_000,
    currency: "USD",
    signed_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    summary: "Signed annual contract",
  });
  await callTool("record_contract", {
    customer_id: partnerId,
    status: "draft",
    arr_cents: 9_900_000,
    currency: "USD",
    summary: "Unsigned draft — must NOT sort as the latest",
  });

  // The one-to-many embed that broke yesterday: plan -> steps.
  await callTool(
    "create_onboarding_plan",
    {
      customer_id: partnerId,
      start_date: "2026-08-01",
      target_end_date: "2026-09-15",
      pace: "standard",
      steps: [
        { title: "Kickoff call", ordinal: 1, status: "completed" },
        { title: "Supplier onboarding", ordinal: 2, status: "in_progress" },
        { title: "Go-live review", ordinal: 3, status: "planned" },
      ],
    },
    (p) => (p?.plan?.id ? undefined : "no plan id returned"),
  );

  await callTool("record_health_check", {
    customer_id: partnerId,
    band: "yellow",
    score: 62,
    reason: "Utilization below target for two consecutive weeks",
  });

  await callTool(
    "set_cadence",
    {
      customer_id: partnerId,
      frequency: "monthly",
      channel: "call",
      duration_min: 30,
      timezone: "Asia/Kolkata",
      next_meeting_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    },
    (p) => (p?.cadence?.id ? undefined : "no cadence id returned"),
  );

  await callTool("set_customer_owner", {
    customer_id: partnerId,
    owner_email: "tester@shimtest.invalid",
  });

  // Objective due inside the default window so list_due_objectives has a hit.
  const objective = await callTool(
    "create_objective",
    {
      customer_id: partnerId,
      title: "Confirm licensing counts for renewal",
      description: "Need seat counts before the T-60 checkpoint.",
      kind: "standard",
      responsible_side: "customer",
      responsible_contact_id: contactId,
      due_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      followup_interval_hours: 24,
      max_followups: 3,
      start_clock: true,
    },
    (p) => (p?.objective?.id ? undefined : "no objective id returned"),
  );
  const objectiveId: string | undefined = objective?.objective?.id;

  await callTool("raise_decision", {
    title: "Shimtest: unclear renewal owner",
    detail: "Two contacts claim ownership of the renewal.",
    recommendation: "Confirm with the partner lead before T-60.",
    urgency: "normal",
    customer_id: partnerId,
  });

  await callTool("request_domain_approval", {
    domain: "shimtest-external.invalid",
    reason: "Partner's procurement team needs to be included.",
    customer_id: partnerId,
  });

  await callTool("propose_knowledge", {
    path: "supplemental/shimtest-proposal.md",
    type: "reference",
    title: "Shimtest proposal",
    description: "Fixture proposal.",
    content_md: "Order forms must be countersigned within five business days.",
    source: "meeting",
    rationale: "Came up twice in partner calls.",
  });

  console.log("\nPhase 2 — read tools must return NON-EMPTY results");
  await callTool("find_customer", { query: "Shimtest" }, (p) =>
    nonEmpty(p?.matches, "matches"),
  );
  await callTool("list_customers", { limit: 10 }, (p) => nonEmpty(p?.customers, "customers"));
  await callTool("list_customers", { lifecycle: "onboarding" }, (p) =>
    nonEmpty(p?.customers, "customers filtered by lifecycle"),
  );
  await callTool("list_customers", { customer_kind: "end_customer" }, (p) =>
    nonEmpty(p?.customers, "customers filtered by kind"),
  );
  await callTool("list_customers", { parent_customer_id: partnerId }, (p) =>
    nonEmpty(p?.customers, "child customers by parent"),
  );

  // The big one: get_customer fans out across contacts, contracts, health,
  // plan + steps (one-to-many), cadence. If any embed is wrong this is where it
  // shows.
  // Payload is flat: { customer, contacts, contracts, active_plan, latest_health,
  // cadence }. active_plan is selected as "*, onboarding_steps(*)" — the
  // one-to-many embed that broke yesterday.
  await callTool("get_customer", { customer_id: partnerId }, (p) => {
    if (!p?.customer) return "no customer returned";
    if (!Array.isArray(p.contacts) || p.contacts.length === 0) return "EMPTY contacts";
    if (!Array.isArray(p.contracts) || p.contracts.length === 0) return "EMPTY contracts";
    if (!p.active_plan) return "EMPTY active_plan — plan lookup or status filter regressed";
    const steps = p.active_plan.onboarding_steps;
    if (!Array.isArray(steps))
      return "onboarding_steps is not an array — the one-to-many embed regressed to many-to-one";
    if (steps.length !== 3) return `expected 3 onboarding_steps, got ${steps.length}`;
    if (!p.latest_health) return "EMPTY latest_health";
    if (!p.cadence) return "EMPTY cadence";
    return undefined;
  });

  await callTool("list_onboarding_steps", { customer_id: partnerId }, (p) =>
    nonEmpty(p?.steps, "onboarding steps"),
  );
  await callTool("list_upcoming_cadences", { within_days: 14 }, (p) =>
    nonEmpty(p?.cadences, "upcoming cadences"),
  );
  await callTool("list_objectives", { customer_id: partnerId }, (p) =>
    nonEmpty(p?.objectives, "objectives"),
  );
  await callTool("list_due_objectives", { within_hours: 72 }, (p) =>
    nonEmpty(p?.objectives, "due objectives"),
  );
  await callTool("list_open_decisions", {}, (p) => nonEmpty(p?.open_decisions, "open decisions"));
  await callTool("list_domain_allowlist", {}, (p) => nonEmpty(p?.domains ?? p?.entries, "domain allowlist"));
  await callTool("list_pending_knowledge", {}, (p) =>
    nonEmpty(p?.proposals ?? p?.pending, "pending knowledge proposals"),
  );
  await callTool("read_knowledge_doc", { path: "core/01-shim-test-playbook.md" }, (p) =>
    p?.doc?.content_md || p?.content_md ? undefined : "no document content returned",
  );
  // Falls back to ilike scoring unless OPENAI_API_KEY is set; the pgvector RPC
  // path is covered by verify-pg-shim.ts.
  await callTool("search_knowledge", { query: "supplier onboarding order form" }, (p) =>
    nonEmpty(p?.hits, "knowledge hits"),
  );
  await callTool("search_mailbox", { query: "renewal", limit: 10 }, (p) =>
    nonEmpty(p?.messages ?? p?.results, "mailbox messages"),
  );
  await callTool("get_email_thread", { conversation_id: CONVERSATION }, (p) =>
    nonEmpty(p?.messages ?? p?.thread, "thread messages"),
  );
  await callTool("list_calendar", {}, (p) => nonEmpty(p?.events, "calendar events"));
  await callTool("list_transcripts", { limit: 10 }, (p) =>
    nonEmpty(p?.transcripts, "transcripts"),
  );
  await callTool("read_transcript", { transcript_id: TRANSCRIPT }, (p) =>
    p?.transcript ? undefined : "no transcript returned",
  );
  // read_document is the one tool that spans both backends: the row comes from
  // Postgres via the shim, the bytes come from Supabase Storage. The fixture
  // path does not exist in the bucket, so the expected outcome is a clean
  // storage error — which proves the DB half worked (a shim failure errors
  // earlier, with a different message) and that the tool degrades into the
  // {data,error} contract instead of throwing.
  //
  // Worth knowing: with the Supabase env vars absent this THROWS
  // ("supabaseUrl is required") from deep inside the handler rather than
  // returning a tool error. Those vars must stay set after the database
  // cutover — see the warning in src/lib/supabase/admin.ts.
  await callTool("read_document", { document_id: DOCUMENT }, undefined, {
    expectErrorMatching: /Object not found|Could not fetch the file/i,
  });

  console.log("\nPhase 3 — updates against rows created above");
  const steps = await callTool("list_onboarding_steps", { customer_id: partnerId });
  const stepId = (steps?.steps ?? [])[0]?.id;
  if (stepId) {
    await callTool("update_onboarding_step", { step_id: stepId, status: "blocked" });
  } else {
    failures.push("update_onboarding_step: could not resolve a step id to update");
  }
  if (objectiveId) {
    await callTool("update_objective", { objective_id: objectiveId, status: "awaiting", bump_followup: true });
  }
  const cadences = await callTool("list_upcoming_cadences", { within_days: 14 });
  const cadenceId = (cadences?.cadences ?? [])[0]?.id;
  if (cadenceId) {
    await callTool("mark_cadence_met", {
      cadence_id: cadenceId,
      met_at: new Date().toISOString(),
      notes: "Fixture check-in",
    });
  }

  console.log("\nPhase 4 — ordering semantics that Postgres gets wrong by default");
  // Directly assert the nullsFirst:false behaviour the app relies on, through
  // the shim, rather than trusting that a tool happened to look right.
  const { createSupabaseAdmin } = await import("@/lib/supabase/admin");
  const db = createSupabaseAdmin();
  const { data: mail, error: mailErr } = await db
    .from("email_messages")
    .select("external_id, received_at")
    .eq("org_id", ORG)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(3);
  if (mailErr) {
    failures.push(`ordering: mailbox query errored — ${mailErr.message}`);
  } else if (!mail?.length) {
    vacuous.push("ordering: EMPTY mailbox — fixtures missing");
  } else if (mail[0].received_at === null) {
    failures.push("ordering: undated mail sorted FIRST — nullsFirst:false was ignored");
  } else {
    passed++;
    console.log("  ok  ordering: NULLS LAST respected on mailbox DESC");
  }

  const { data: latest, error: latestErr } = await db
    .from("contracts")
    .select("summary, signed_at")
    .eq("customer_id", partnerId)
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) {
    failures.push(`ordering: latest-contract query errored — ${latestErr.message}`);
  } else if (!latest) {
    vacuous.push("ordering: EMPTY contracts — fixtures missing");
  } else if (latest.signed_at === null) {
    failures.push("ordering: UNSIGNED contract returned as the latest — real data bug");
  } else {
    passed++;
    console.log("  ok  ordering: signed contract wins over unsigned");
  }

  // count/head, used by dashboard tiles.
  const { count, error: countErr } = await db
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("org_id", ORG);
  if (countErr) failures.push(`count: errored — ${countErr.message}`);
  else if (!count) vacuous.push("count: EMPTY customer count");
  else {
    passed++;
    console.log(`  ok  count/head returned ${count}`);
  }

  void childId;
}

main()
  .catch((err) => {
    failures.push(`HARNESS CRASHED — ${String(err)}`);
  })
  .finally(async () => {
    console.log("\nCleaning up fixtures…");
    try {
      await cleanup();
      console.log("  fixtures removed");
    } catch (err) {
      console.error(`  CLEANUP FAILED — remove org ${ORG} by hand: ${String(err)}`);
    }

    console.log("\n" + "=".repeat(64));
    console.log(`passed:  ${passed}`);
    console.log(`failed:  ${failures.length}`);
    console.log(`vacuous: ${vacuous.length}  (succeeded but returned nothing)`);
    if (vacuous.length) {
      console.log("\nVACUOUS — a green tick here would have been a lie:");
      for (const v of vacuous) console.log(`  ! ${v}`);
    }
    if (failures.length) {
      console.log("\nFAILURES:");
      for (const f of failures) console.log(`  x ${f}`);
    }
    console.log("=".repeat(64));

    const { getPool } = await import("@/lib/db/pool");
    await getPool().end();
    process.exit(failures.length + vacuous.length > 0 ? 1 : 0);
  });
