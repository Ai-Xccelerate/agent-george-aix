/**
 * George's tool layer — an in-process SDK MCP server.
 *
 * Every tool is scoped to the calling user's org via closure; the model
 * cannot see or specify `orgId`. We use the Supabase admin client because the
 * agent backend acts on behalf of the org (RLS would otherwise block writes
 * issued before we lift the user JWT into the SDK transport).
 *
 * Names are prefixed `mcp__george__<tool>` from the model's perspective.
 */
import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { buildComposioTools } from "./composio-tools";
import { buildNylasEmailTools } from "./nylas-tools";
import { isNylasEnabled } from "@/lib/nylas/client";
import { mailDisabled, usingNylas } from "@/lib/agent/mail-selection";
import { embedText, hasEmbeddingProvider } from "@/lib/knowledge/embeddings";
import { resolveOrgIdentity } from "@/lib/agent/identity";
import { toKnowledgeHits } from "@/lib/parchment/client";
import { parchmentForOrg } from "@/lib/parchment/connection";
import Anthropic from "@anthropic-ai/sdk";

export type GeorgeToolCtx = {
  orgId: string;
  /**
   * Per-org integration on/off, resolved by the caller.
   *
   * The builder is synchronous and the toggle lookup is not, so the two async
   * call sites resolve it and pass the answer in. Absent means no opinion —
   * used by tests and by paths that do not register mail tools anyway.
   */
  enabled?: { nylas?: boolean };
  /**
   * The human running the agent, when there is one. Null on autonomous
   * standing-job runs — DB writes that reference a user (e.g.
   * `customers.owner_user_id`) become null in that case.
   */
  userId: string | null;
  /**
   * The agent_sessions.id this run is associated with, when one exists.
   * Forwarded into `audit_log.session_id` so the Inbox UI can link an
   * outbound draft/send back to the chat conversation it came from.
   */
  sessionId?: string | null;
  /**
   * Controls whether `send_email_draft` may actually send. "chat" (default):
   * a human confirmed, no guard. "internal_only": autonomous run — the send
   * tool refuses any draft whose recipients are not all internal to the org.
   */
  emailSendPolicy?: "chat" | "internal_only";
  /**
   * Whether this run may create work for a human.
   *
   * False on autonomous runs in assistant mode: `raise_decision` is withheld
   * from the grant and `record_observation` takes its place. Withheld rather
   * than instructed against — a tool the model cannot reach needs no
   * discipline. See operating-mode.ts.
   *
   * Defaults true so a chat run, where a person is present and asking, keeps
   * the full grant.
   */
  mayRaiseDecisions?: boolean;
  /** Optional override (tests). Defaults to the admin client. */
  db?: SupabaseClient;
};

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

const lifecycleEnum = z.enum([
  "prospect",
  "onboarding",
  "active",
  "at_risk",
  "churned",
]);
const customerKindEnum = z.enum(["partner", "end_customer"]);
const cadenceFrequencyEnum = z.enum([
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "ad_hoc",
]);
const cadenceChannelEnum = z.enum(["call", "in_person", "email", "async"]);
const stepStatusEnum = z.enum([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
]);
const objectiveKindEnum = z.enum(["standard", "from_meeting", "ad_hoc"]);
const objectiveStatusEnum = z.enum([
  "pending",
  "awaiting",
  "achieved",
  "blocked",
  "cancelled",
]);
const objectiveSideEnum = z.enum(["customer", "onyx"]);

export function buildGeorgeMcpServer(
  ctx: GeorgeToolCtx,
): { server: McpSdkServerConfigWithInstance; toolNames: string[] } {
  const db = ctx.db ?? createSupabaseAdmin();
  const { orgId } = ctx;

  // ---- find_customer -----------------------------------------------
  const findCustomer = tool(
    "find_customer",
    "Look up customers by name (case-insensitive substring match). Use this first when you only have a name, before calling create/update tools.",
    {
      query: z.string().min(1).describe("Name or partial name to search for."),
      limit: z.number().int().min(1).max(20).default(5).optional(),
    },
    async ({ query, limit }) => {
      const { data, error } = await db
        .from("customers")
        .select(
          "id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size",
        )
        .eq("org_id", orgId)
        // An archived customer must not come back from a name lookup, or
        // George resolves a name to a dead account and acts on it.
        .is("archived_at", null)
        .ilike("name", `%${query}%`)
        .limit(limit ?? 5);
      if (error) return fail(error.message);
      return ok({ matches: data ?? [] });
    },
  );

  // ---- list_customers ----------------------------------------------
  const listCustomers = tool(
    "list_customers",
    "List customers in the org. Filter by lifecycle, by customer_kind ('partner' = MSP we contract with, 'end_customer' = customer of one of our partners), or by parent_customer_id (a partner's UUID) to get that partner's end customers. Returns most-recently-updated first.",
    {
      lifecycle: lifecycleEnum.optional(),
      customer_kind: customerKindEnum.optional(),
      parent_customer_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).default(25).optional(),
    },
    async ({ lifecycle, customer_kind, parent_customer_id, limit }) => {
      let q = db
        .from("customers")
        .select(
          "id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, updated_at",
        )
        .eq("org_id", orgId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit ?? 25);
      if (lifecycle) q = q.eq("lifecycle", lifecycle);
      if (customer_kind) q = q.eq("customer_kind", customer_kind);
      if (parent_customer_id) q = q.eq("parent_customer_id", parent_customer_id);
      const { data, error } = await q;
      if (error) return fail(error.message);
      return ok({ customers: data ?? [] });
    },
  );

  // ---- get_customer ------------------------------------------------
  const getCustomer = tool(
    "get_customer",
    "Get the full record for a customer (contacts, contracts, active onboarding plan + steps, latest health). Pass the UUID returned from find_customer or list_customers.",
    {
      customer_id: z.string().uuid(),
    },
    async ({ customer_id }) => {
      const customerRes = await db
        .from("customers")
        .select("*")
        .eq("org_id", orgId)
        .eq("id", customer_id)
        .maybeSingle();
      if (customerRes.error) return fail(customerRes.error.message);
      if (!customerRes.data) return fail("Customer not found in this org.");

      const cust = customerRes.data as {
        id: string;
        customer_kind: "partner" | "end_customer";
        parent_customer_id: string | null;
        owner_user_id: string | null;
      };

      const [
        contacts,
        contracts,
        plan,
        health,
        parent,
        endCustomers,
        cadence,
        objectives,
        owner,
      ] = await Promise.all([
          db
            .from("contacts")
            .select("*")
            .eq("customer_id", customer_id)
            .order("is_primary", { ascending: false }),
          db
            .from("contracts")
            .select("*")
            .eq("customer_id", customer_id)
            .order("signed_at", { ascending: false, nullsFirst: false }),
          db
            .from("onboarding_plans")
            .select("*, onboarding_steps(*)")
            .eq("customer_id", customer_id)
            .in("status", ["planned", "in_progress", "blocked"])
            .maybeSingle(),
          db
            .from("customer_health")
            .select("*")
            .eq("customer_id", customer_id)
            .order("measured_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          cust.parent_customer_id
            ? db
                .from("customers")
                .select("id, name, domain, customer_kind")
                .eq("id", cust.parent_customer_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as const),
          cust.customer_kind === "partner"
            ? db
                .from("customers")
                .select("id, name, domain, lifecycle, updated_at")
                .eq("org_id", orgId)
                .eq("parent_customer_id", customer_id)
                .order("updated_at", { ascending: false })
            : Promise.resolve({ data: null, error: null } as const),
          db
            .from("cadences")
            .select("*")
            .eq("customer_id", customer_id)
            .eq("active", true)
            .maybeSingle(),
          db
            .from("objectives")
            .select("*")
            .eq("customer_id", customer_id)
            .neq("status", "cancelled")
            .order("created_at", { ascending: true }),
          cust.owner_user_id
            ? db
                .from("org_members")
                .select("user_id, full_name, email, role")
                .eq("org_id", orgId)
                .eq("user_id", cust.owner_user_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as const),
        ]);

      // Recent meeting transcripts (metadata only — read_transcript for full text).
      const transcripts = await db
        .from("meeting_transcripts")
        .select("id, title, ended_at, duration_min, summary, status")
        .eq("org_id", orgId)
        .eq("customer_id", customer_id)
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(5);

      return ok({
        customer: customerRes.data,
        owner: owner.data ?? null,
        parent: parent.data ?? null,
        end_customers: endCustomers.data ?? [],
        contacts: contacts.data ?? [],
        contracts: contracts.data ?? [],
        active_plan: plan.data ?? null,
        latest_health: health.data ?? null,
        cadence: cadence.data ?? null,
        objectives: objectives.data ?? [],
        recent_transcripts: transcripts.data ?? [],
      });
    },
  );

  // ---- create_customer --------------------------------------------
  const createCustomer = tool(
    "create_customer",
    "Create a new customer record (or return the existing one). `customer_kind` distinguishes partners (MSPs Onyx contracts with) from end_customers (customers of a partner). End customers REQUIRE parent_customer_id pointing to their partner. Defaults to 'partner'. IMPORTANT: customers are unique by domain — if one already exists for the given domain this returns it (deduped=true) instead of creating a second. Always pass `domain` when you have it so dedup works.",
    {
      name: z.string().min(1),
      domain: z.string().optional().describe("Primary website domain, e.g. acme.com"),
      lifecycle: lifecycleEnum.default("onboarding").optional(),
      customer_kind: customerKindEnum.default("partner").optional(),
      parent_customer_id: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Required when customer_kind='end_customer'. Must reference an existing partner in this org.",
        ),
      industry: z.string().optional(),
      size: z.string().optional().describe("Headcount band, e.g. '11-50'."),
      notes: z.string().optional(),
    },
    async ({
      name,
      domain,
      lifecycle,
      customer_kind,
      parent_customer_id,
      industry,
      size,
      notes,
    }) => {
      const kind = customer_kind ?? "partner";

      // Resolve-or-create by domain: one customer per domain per org. Avoids the
      // duplicate-record loop when two autonomous runs see the same signal.
      if (domain) {
        const existing = await db
          .from("customers")
          .select("*")
          .eq("org_id", orgId)
          .ilike("domain", domain)
          .maybeSingle();
        if (existing.data) {
          return ok({ customer: existing.data, deduped: true });
        }
      }

      if (kind === "end_customer") {
        if (!parent_customer_id) {
          return fail(
            "end_customer requires parent_customer_id (the partner UUID). Call find_customer or list_customers (customer_kind='partner') to resolve it first.",
          );
        }
        const parent = await db
          .from("customers")
          .select("id, customer_kind")
          .eq("org_id", orgId)
          .eq("id", parent_customer_id)
          .maybeSingle();
        if (parent.error) return fail(parent.error.message);
        if (!parent.data) return fail("Parent customer not found in this org.");
        if (parent.data.customer_kind !== "partner") {
          return fail("parent_customer_id must reference a customer with customer_kind='partner'.");
        }
      } else if (parent_customer_id) {
        return fail("Only end_customer rows can have a parent_customer_id.");
      }

      const { data, error } = await db
        .from("customers")
        .insert({
          org_id: orgId,
          name,
          domain: domain ?? null,
          lifecycle: lifecycle ?? "onboarding",
          customer_kind: kind,
          parent_customer_id: kind === "end_customer" ? parent_customer_id : null,
          industry: industry ?? null,
          size: size ?? null,
          notes: notes ?? null,
          owner_user_id: ctx.userId,
        })
        .select("*")
        .single();
      if (error) {
        // 23505 = a concurrent run inserted the same domain first. Return that
        // row so the caller converges on one customer instead of erroring.
        if (error.code === "23505" && domain) {
          const existing = await db
            .from("customers")
            .select("*")
            .eq("org_id", orgId)
            .ilike("domain", domain)
            .maybeSingle();
          if (existing.data) return ok({ customer: existing.data, deduped: true });
        }
        return fail(error.message);
      }
      return ok({ customer: data });
    },
  );

  // ---- add_contact -------------------------------------------------
  const addContact = tool(
    "add_contact",
    "Add a contact (named person) to a customer. Mark is_primary=true when this person is the day-to-day buyer or main point of contact.",
    {
      customer_id: z.string().uuid(),
      full_name: z.string().min(1),
      email: z.string().email().optional(),
      title: z.string().optional(),
      phone: z.string().optional(),
      timezone: z.string().optional(),
      is_primary: z.boolean().default(false).optional(),
      notes: z.string().optional(),
    },
    async ({ customer_id, is_primary, ...rest }) => {
      // Confirm the customer belongs to this org.
      const c = await db
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", customer_id)
        .maybeSingle();
      if (c.error) return fail(c.error.message);
      if (!c.data) return fail("Customer not found in this org.");

      // If is_primary, demote any existing primary contact.
      if (is_primary) {
        await db
          .from("contacts")
          .update({ is_primary: false })
          .eq("customer_id", customer_id)
          .eq("is_primary", true);
      }

      const { data, error } = await db
        .from("contacts")
        .insert({ customer_id, is_primary: is_primary ?? false, ...rest })
        .select("*")
        .single();
      if (error) return fail(error.message);
      return ok({ contact: data });
    },
  );

  // ---- record_contract --------------------------------------------
  const recordContract = tool(
    "record_contract",
    "Capture the metadata for a signed contract. Use after parsing the contract details with the user. Storage path is optional until file upload is wired.",
    {
      customer_id: z.string().uuid(),
      status: z.enum(["draft", "signed", "active", "expired", "terminated"]).default("signed").optional(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      arr_cents: z.number().int().nonnegative().optional(),
      currency: z.string().length(3).default("USD").optional(),
      signed_at: z.string().datetime().optional(),
      summary: z.string().optional(),
      storage_path: z.string().optional(),
    },
    async (input) => {
      const c = await db
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", input.customer_id)
        .maybeSingle();
      if (c.error) return fail(c.error.message);
      if (!c.data) return fail("Customer not found in this org.");

      const { data, error } = await db
        .from("contracts")
        .insert({
          ...input,
          status: input.status ?? "signed",
          currency: input.currency ?? "USD",
        })
        .select("*")
        .single();
      if (error) return fail(error.message);
      return ok({ contract: data });
    },
  );

  // ---- create_onboarding_plan -------------------------------------
  const createOnboardingPlan = tool(
    "create_onboarding_plan",
    "Create the onboarding plan for a customer. Provide ordered step titles; statuses default to 'planned'. Existing active plans on the same customer must be completed/cancelled first.",
    {
      customer_id: z.string().uuid(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      target_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      pace: z.string().optional(),
      notes: z.string().optional(),
      steps: z
        .array(
          z.object({
            title: z.string().min(1),
            description: z.string().optional(),
            due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            owner: z.string().optional(),
          }),
        )
        .min(1)
        .describe("Ordered list of steps. Caller decides the order."),
    },
    async ({ customer_id, steps, ...plan }) => {
      const c = await db
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", customer_id)
        .maybeSingle();
      if (c.error) return fail(c.error.message);
      if (!c.data) return fail("Customer not found in this org.");

      const planRow = await db
        .from("onboarding_plans")
        .insert({
          customer_id,
          status: "in_progress",
          start_date: plan.start_date ?? null,
          target_end_date: plan.target_end_date ?? null,
          pace: plan.pace ?? null,
          notes: plan.notes ?? null,
        })
        .select("*")
        .single();
      if (planRow.error) return fail(planRow.error.message);

      const stepRows = await db
        .from("onboarding_steps")
        .insert(
          steps.map((s, i) => ({
            plan_id: planRow.data.id,
            customer_id,
            ordinal: i + 1,
            title: s.title,
            description: s.description ?? null,
            due_date: s.due_date ?? null,
            owner: s.owner ?? null,
            status: "planned" as const,
          })),
        )
        .select("*");
      if (stepRows.error) return fail(stepRows.error.message);

      // Flip the customer to lifecycle='onboarding' if not already.
      await db
        .from("customers")
        .update({ lifecycle: "onboarding" })
        .eq("id", customer_id)
        .neq("lifecycle", "onboarding");

      return ok({ plan: planRow.data, steps: stepRows.data ?? [] });
    },
  );

  // ---- list_onboarding_steps --------------------------------------
  const listOnboardingSteps = tool(
    "list_onboarding_steps",
    "List the ordered steps for a customer's active onboarding plan.",
    {
      customer_id: z.string().uuid(),
    },
    async ({ customer_id }) => {
      const plan = await db
        .from("onboarding_plans")
        .select("id, status, start_date, target_end_date")
        .eq("customer_id", customer_id)
        .in("status", ["planned", "in_progress", "blocked"])
        .maybeSingle();
      if (plan.error) return fail(plan.error.message);
      if (!plan.data) return fail("No active onboarding plan for this customer.");

      const { data, error } = await db
        .from("onboarding_steps")
        .select("*")
        .eq("plan_id", plan.data.id)
        .order("ordinal", { ascending: true });
      if (error) return fail(error.message);
      return ok({ plan: plan.data, steps: data ?? [] });
    },
  );

  // ---- update_onboarding_step -------------------------------------
  const updateOnboardingStep = tool(
    "update_onboarding_step",
    "Update a single onboarding step. Use this to mark steps in_progress, blocked, or completed. Setting status='completed' auto-stamps completed_at.",
    {
      step_id: z.string().uuid(),
      status: stepStatusEnum.optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      owner: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
    },
    async ({ step_id, status, due_date, owner, title, description }) => {
      // Scope check: step must belong to a customer in this org.
      const step = await db
        .from("onboarding_steps")
        .select("id, customer_id, customers!inner(org_id)")
        .eq("id", step_id)
        .maybeSingle();
      if (step.error) return fail(step.error.message);
      const customerOrg = (step.data?.customers as { org_id?: string } | null)?.org_id;
      if (!step.data || customerOrg !== orgId) return fail("Step not found in this org.");

      const patch: Record<string, unknown> = {};
      if (status !== undefined) patch.status = status;
      if (due_date !== undefined) patch.due_date = due_date;
      if (owner !== undefined) patch.owner = owner;
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (status === "completed") patch.completed_at = new Date().toISOString();

      const { data, error } = await db
        .from("onboarding_steps")
        .update(patch)
        .eq("id", step_id)
        .select("*")
        .single();
      if (error) return fail(error.message);
      return ok({ step: data });
    },
  );

  // ---- record_health_check ----------------------------------------
  const recordHealthCheck = tool(
    "record_health_check",
    "Record a health check for a customer. Use 'green', 'yellow', or 'red'. Score is 0-100 if you have signal to back it up.",
    {
      customer_id: z.string().uuid(),
      band: z.enum(["green", "yellow", "red"]),
      score: z.number().int().min(0).max(100).optional(),
      reason: z.string().min(1).describe("Plain-English rationale: what drove this band."),
      signals: z.record(z.string(), z.unknown()).optional(),
    },
    async ({ customer_id, band, score, reason, signals }) => {
      const c = await db
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", customer_id)
        .maybeSingle();
      if (c.error) return fail(c.error.message);
      if (!c.data) return fail("Customer not found in this org.");

      const { data, error } = await db
        .from("customer_health")
        .insert({
          customer_id,
          band,
          score: score ?? null,
          reason,
          signals: signals ?? {},
        })
        .select("*")
        .single();
      if (error) return fail(error.message);

      // Mirror red onto the customer lifecycle.
      if (band === "red") {
        await db
          .from("customers")
          .update({ lifecycle: "at_risk" })
          .eq("id", customer_id);
      }

      return ok({ health: data });
    },
  );

  // ---- search_knowledge -------------------------------------------
  const searchKnowledge = tool(
    "search_knowledge",
    "Semantic search across the org's **supplemental** knowledge base only. Returns the most relevant ~800-char chunks with their source path. CORE PLAYBOOKS ARE INTENTIONALLY EXCLUDED — chunked snippets are lossy, and the core docs hold your role, scope, lifecycle, and process rules where accuracy must be exact. For anything touching role / scope / process / lifecycle / rules, do NOT use this tool — call `read_knowledge_doc(path)` against the relevant core doc listed in your system prompt's manifest. Use `search_knowledge` only for niche / reference / supplemental questions, or as a last resort when no core doc obviously applies.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).default(5).optional(),
    },
    async ({ query, limit }) => {
      const k = limit ?? 5;

      // Preferred path: the org's Parchment knowledge base. Resolved per org —
      // the tenant is identified by its Clerk org id, so reading ambient config
      // here could serve one organisation another organisation's knowledge.
      // Available by default for every org (no setup), unless an admin turned
      // grounding off in Settings → Knowledge.
      //
      // Parchment returns whole sections with their ancestor trail, not 800-char
      // chunks, so a hit carries the provenance needed to cite where an answer
      // came from. Supplemental-only policy is unchanged — core playbooks live in
      // the repo and are fetched with read_knowledge_doc, never searched here.
      const hub = await parchmentForOrg(db, orgId);
      if (hub) {
        const res = await hub.query({ query, limit: k });
        if (res.ok) {
          const hits = toKnowledgeHits(res.data);
          return ok({
            hits,
            mode: "parchment",
            note:
              hits.length === 0
                ? "No matches in the organisation's knowledge base. Core playbooks are not searched — if the question touches role / scope / process / lifecycle, fetch the relevant core doc from the manifest with `read_knowledge_doc(path)` instead."
                : undefined,
          });
        }
        // Fail open, exactly as the vector path falls through to ilike: a
        // knowledge hub being unreachable should degrade the answer, never break
        // the turn. Logged so an operator can see it happened at all, because a
        // silent downgrade to weaker local search is the kind of thing that goes
        // unnoticed for weeks. The Settings panel surfaces the same failure to
        // the admin who can fix it.
        console.warn(
          `[search_knowledge] Parchment unavailable for org ${orgId}, falling back to local:`,
          res.error,
        );
      }

      // Preferred path: pgvector cosine similarity via the
      // `match_knowledge_chunks` RPC. Requires OPENAI_API_KEY +
      // embedded chunks (sync-knowledge handles both).
      if (hasEmbeddingProvider()) {
        try {
          const queryEmbedding = await embedText(query);
          const { data, error } = await db.rpc("match_knowledge_chunks", {
            p_org_id: orgId,
            p_query: `[${queryEmbedding.join(",")}]`,
            p_limit: k,
          });
          if (error) return fail(error.message);
          const hits = (data ?? []).map(
            (r: {
              path: string | null;
              title: string | null;
              is_core: boolean | null;
              ordinal: number;
              content: string;
              similarity: number;
            }) => ({
              score: Number(r.similarity?.toFixed(4) ?? 0),
              path: r.path,
              title: r.title,
              is_core: r.is_core ?? false,
              ordinal: r.ordinal,
              snippet: r.content,
            }),
          );
          return ok({
            hits,
            mode: "vector",
            note:
              hits.length === 0
                ? "No matches in supplemental knowledge. Core playbooks are not searched — if the question touches role / scope / process / lifecycle, fetch the relevant core doc from the manifest with `read_knowledge_doc(path)` instead."
                : undefined,
          });
        } catch (err) {
          // Fall through to ilike if the embedding call fails — better
          // a degraded result than a tool error mid-conversation.
          console.warn("[search_knowledge] vector path failed, falling back to ilike:", err);
        }
      }

      // Fallback: multi-word ilike scoring. Active when OPENAI_API_KEY
      // is unset or the embedding call errored.
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      if (words.length === 0) {
        return ok({ hits: [], mode: "ilike" });
      }

      const orFilter = words.map((w) => `content.ilike.%${w}%`).join(",");

      // Policy parity with the vector path: core docs are excluded.
      // Inner join + `is_core.eq.false` on the joined table enforces it
      // server-side (so a returned row is guaranteed supplemental).
      const { data, error } = await db
        .from("knowledge_chunks")
        .select(
          "content, ordinal, metadata, knowledge_docs!inner(path, title, org_id, is_core)",
        )
        .eq("org_id", orgId)
        .eq("knowledge_docs.is_core", false)
        .or(orFilter)
        .limit(50);
      if (error) return fail(error.message);

      const scored = (data ?? [])
        .map((c) => {
          const text = (c.content ?? "").toLowerCase();
          const score = words.reduce(
            (s, w) => s + (text.split(w).length - 1),
            0,
          );
          const doc =
            (c.knowledge_docs as {
              path?: string;
              title?: string;
              is_core?: boolean;
            } | null) ?? {};
          return {
            score,
            path: doc.path ?? null,
            title: doc.title ?? null,
            is_core: doc.is_core ?? false,
            ordinal: c.ordinal,
            snippet: c.content,
          };
        })
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      return ok({
        hits: scored,
        mode: "ilike",
        note:
          scored.length === 0
            ? "No matches in supplemental knowledge. Core playbooks are not searched — if the question touches role / scope / process / lifecycle, fetch the relevant core doc from the manifest with `read_knowledge_doc(path)` instead."
            : undefined,
      });
    },
  );

  // ---- read_knowledge_doc -----------------------------------------
  const readKnowledgeDoc = tool(
    "read_knowledge_doc",
    "Fetch the full, verbatim markdown of one knowledge doc by its `path` (values shown in the knowledge manifest in your system prompt). This is the ONLY way to read core playbooks — they are intentionally excluded from `search_knowledge` because chunked snippets are lossy and core docs hold your role / scope / lifecycle / process rules. ALWAYS use this tool for any question about role, scope, rules, lifecycle, or process — read the relevant core doc whole, then quote it directly rather than paraphrasing. Returns content_md, title, version. Errors if the path doesn't exist for this org.",
    {
      path: z.string().min(1),
    },
    async ({ path }) => {
      const { data, error } = await db
        .from("knowledge_docs")
        .select("path, title, content_md, is_core, version, updated_at")
        .eq("org_id", orgId)
        .eq("path", path)
        .maybeSingle();
      if (error) return fail(error.message);
      if (!data) {
        return fail(
          `No knowledge doc at path "${path}". Check the manifest in your system prompt for valid paths, or call \`search_knowledge\` if you're unsure which doc has the answer.`,
        );
      }
      return ok({ doc: data });
    },
  );

  // ---- set_cadence ------------------------------------------------
  const setCadence = tool(
    "set_cadence",
    "Set or replace the active cadence for a customer (weekly / biweekly / etc.). Supersedes any previous active cadence — the old one is archived, not deleted. Use this when the user agrees on a recurring rhythm with a partner. For ad_hoc, omit day_of_week and time_of_day.",
    {
      customer_id: z.string().uuid(),
      frequency: cadenceFrequencyEnum,
      day_of_week: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe("0 = Sunday … 6 = Saturday. Omit for ad_hoc."),
      time_of_day: z
        .string()
        .regex(/^\d{2}:\d{2}(:\d{2})?$/)
        .optional()
        .describe("Local time in HH:MM (24h), e.g. 14:30. Interpreted in `timezone` if set, else the org default."),
      timezone: z.string().optional(),
      channel: cadenceChannelEnum.default("call").optional(),
      duration_min: z.number().int().min(5).max(480).optional(),
      next_meeting_at: z
        .string()
        .datetime()
        .optional()
        .describe("ISO timestamp of the next scheduled meeting. Set when you know the calendar invite has been sent."),
      notes: z.string().optional(),
    },
    async (input) => {
      const c = await db
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", input.customer_id)
        .maybeSingle();
      if (c.error) return fail(c.error.message);
      if (!c.data) return fail("Customer not found in this org.");

      // Archive the existing active cadence (the unique partial index would
      // otherwise reject the insert).
      const archive = await db
        .from("cadences")
        .update({ active: false })
        .eq("customer_id", input.customer_id)
        .eq("active", true);
      if (archive.error) return fail(archive.error.message);

      const { data, error } = await db
        .from("cadences")
        .insert({
          org_id: orgId,
          customer_id: input.customer_id,
          frequency: input.frequency,
          day_of_week: input.day_of_week ?? null,
          time_of_day: input.time_of_day ?? null,
          timezone: input.timezone ?? null,
          channel: input.channel ?? "call",
          duration_min: input.duration_min ?? null,
          next_meeting_at: input.next_meeting_at ?? null,
          notes: input.notes ?? null,
          owner_user_id: ctx.userId,
          created_by: ctx.userId,
          active: true,
        })
        .select("*")
        .single();
      if (error) return fail(error.message);
      return ok({ cadence: data });
    },
  );

  // ---- list_upcoming_cadences -------------------------------------
  const listUpcomingCadences = tool(
    "list_upcoming_cadences",
    "List active cadences across the org whose next_meeting_at falls within the next N days (default 7). Useful for cadence-prep standing jobs and 'what's on the calendar this week' questions.",
    {
      within_days: z.number().int().min(1).max(60).default(7).optional(),
      limit: z.number().int().min(1).max(200).default(50).optional(),
    },
    async ({ within_days, limit }) => {
      const days = within_days ?? 7;
      const cutoff = new Date(Date.now() + days * 86_400_000).toISOString();
      const { data, error } = await db
        .from("cadences")
        .select(
          "id, customer_id, frequency, channel, day_of_week, time_of_day, timezone, next_meeting_at, last_met_at, customers!inner(id, name, customer_kind)",
        )
        .eq("org_id", orgId)
        .eq("active", true)
        .not("next_meeting_at", "is", null)
        .lte("next_meeting_at", cutoff)
        .order("next_meeting_at", { ascending: true })
        .limit(limit ?? 50);
      if (error) return fail(error.message);
      return ok({ cadences: data ?? [], window_days: days });
    },
  );

  // ---- mark_cadence_met -------------------------------------------
  const markCadenceMet = tool(
    "mark_cadence_met",
    "Record that a cadence meeting happened. Updates last_met_at and (optionally) advances next_meeting_at when you know the next date.",
    {
      cadence_id: z.string().uuid(),
      met_at: z
        .string()
        .datetime()
        .optional()
        .describe("ISO timestamp of when the meeting occurred. Defaults to now."),
      next_meeting_at: z
        .string()
        .datetime()
        .optional(),
      notes: z.string().optional(),
    },
    async ({ cadence_id, met_at, next_meeting_at, notes }) => {
      // Confirm it's in-org.
      const existing = await db
        .from("cadences")
        .select("id, notes")
        .eq("org_id", orgId)
        .eq("id", cadence_id)
        .maybeSingle();
      if (existing.error) return fail(existing.error.message);
      if (!existing.data) return fail("Cadence not found in this org.");

      const update: Record<string, unknown> = {
        last_met_at: met_at ?? new Date().toISOString(),
      };
      if (next_meeting_at) update.next_meeting_at = next_meeting_at;
      if (notes) {
        const combined = existing.data.notes
          ? `${existing.data.notes}\n— ${notes}`
          : notes;
        update.notes = combined;
      }
      const { data, error } = await db
        .from("cadences")
        .update(update)
        .eq("id", cadence_id)
        .select("*")
        .single();
      if (error) return fail(error.message);
      return ok({ cadence: data });
    },
  );

  // ---- read_document ----------------------------------------------
  // When the user attaches a file in chat (uploadAttachmentAction stores
  // it in Supabase storage + drops a `[Attached file: name]` placeholder
  // into the conversation), George needs a way to actually read the
  // contents. This tool downloads the file from storage and turns it into
  // text George can reason about. PDFs and images are routed through
  // Claude's native document/image content blocks; plain text formats
  // are returned directly.
  const readDocument = tool(
    "read_document",
    "Read the contents of a file the user attached to this chat. Call this whenever the user message references an attachment ([Attached file: ...]) and you need to see what's inside it. Supports PDF, images, plain text (txt/csv/md), Word (docx), Excel (xlsx), and PowerPoint (pptx).",
    {
      document_id: z
        .string()
        .uuid()
        .describe(
          "The document_id from the [Attached file: ...] placeholder's metadata. Find it in the message's content_json.attachments[].document_id, or if multiple files were attached, pass them one at a time.",
        ),
    },
    async ({ document_id }) => {
      const docLookup = await db
        .from("documents")
        .select("id, storage_path, original_name, mime_type, file_size")
        .eq("id", document_id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (docLookup.error) return fail(docLookup.error.message);
      if (!docLookup.data) return fail("Document not found in this org.");
      const doc = docLookup.data as {
        id: string;
        storage_path: string;
        original_name: string;
        mime_type: string;
        file_size: number;
      };

      const dl = await db.storage
        .from("customer-docs")
        .download(doc.storage_path);
      if (dl.error || !dl.data) {
        return fail(`Could not fetch the file: ${dl.error?.message ?? "unknown"}`);
      }
      const buf = Buffer.from(await dl.data.arrayBuffer());

      // Plain text formats — no model round-trip needed.
      const PLAIN_TEXT = new Set([
        "text/plain",
        "text/csv",
        "text/markdown",
      ]);
      if (PLAIN_TEXT.has(doc.mime_type)) {
        return ok({
          document_id: doc.id,
          name: doc.original_name,
          mime_type: doc.mime_type,
          content: buf.toString("utf8"),
        });
      }

      // Office formats — extracted locally with format-specific libs so
      // George gets clean text without a model round-trip.
      const DOCX =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const XLSX =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const PPTX =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      if (doc.mime_type === DOCX) {
        const mammoth = await import("mammoth");
        try {
          const result = await mammoth.extractRawText({ buffer: buf });
          return ok({
            document_id: doc.id,
            name: doc.original_name,
            mime_type: doc.mime_type,
            file_size: doc.file_size,
            content: result.value || "(empty document)",
          });
        } catch (err) {
          return fail(`docx extraction failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (doc.mime_type === XLSX || doc.mime_type === "application/vnd.ms-excel") {
        const XLSXLib = await import("xlsx");
        try {
          const wb = XLSXLib.read(buf, { type: "buffer" });
          const parts: string[] = [];
          for (const sheetName of wb.SheetNames) {
            const sheet = wb.Sheets[sheetName];
            const csv = XLSXLib.utils.sheet_to_csv(sheet, { blankrows: false });
            parts.push(`# Sheet: ${sheetName}\n\n${csv}`);
          }
          return ok({
            document_id: doc.id,
            name: doc.original_name,
            mime_type: doc.mime_type,
            file_size: doc.file_size,
            content: parts.join("\n\n").slice(0, 200_000),
          });
        } catch (err) {
          return fail(`xlsx extraction failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (doc.mime_type === PPTX) {
        const { parseOffice } = await import("officeparser");
        try {
          // parseOffice accepts a Buffer; cast through unknown because the
          // exported overload list doesn't include the Buffer form on every
          // version of the type declarations.
          const ast = await (
            parseOffice as unknown as (
              file: Buffer,
            ) => Promise<{
              content: Array<{ text?: string; children?: unknown[] }>;
            }>
          )(buf);
          // Walk the content tree and concatenate each node's `text`. The
          // pptx parser sets `text` on every container node (slide,
          // paragraph) as the joined text of its descendants, so a single
          // top-level pass is enough for a usable extraction.
          const text = ast.content
            .map((n) => (typeof n.text === "string" ? n.text : ""))
            .filter(Boolean)
            .join("\n\n");
          return ok({
            document_id: doc.id,
            name: doc.original_name,
            mime_type: doc.mime_type,
            file_size: doc.file_size,
            content: text || "(no text extracted)",
          });
        } catch (err) {
          return fail(`pptx extraction failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // PDFs and images — use Claude's native document / image content
      // blocks to extract the text. We use Haiku for the extraction pass
      // to keep latency low; the calling Sonnet model then reasons over
      // the extracted text.
      const isPdf = doc.mime_type === "application/pdf";
      const isImage = doc.mime_type.startsWith("image/");
      if (!isPdf && !isImage) {
        return fail(
          `Reading "${doc.mime_type}" attachments isn't supported yet. Supported: PDF, images, txt/csv/md, docx, xlsx, pptx.`,
        );
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return fail("Document parsing requires ANTHROPIC_API_KEY.");
      }
      const anthropic = new Anthropic({ apiKey });
      const base64 = buf.toString("base64");
      try {
        const result = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 8192,
          messages: [
            {
              role: "user",
              content: [
                isPdf
                  ? {
                      type: "document",
                      source: {
                        type: "base64",
                        media_type: "application/pdf",
                        data: base64,
                      },
                    }
                  : {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: doc.mime_type as
                          | "image/png"
                          | "image/jpeg"
                          | "image/webp"
                          | "image/gif",
                        data: base64,
                      },
                    },
                {
                  type: "text",
                  text: isPdf
                    ? "Extract all text from this document. Preserve structure (headings, lists, tables, signatures). Do not summarize, do not omit anything — output the raw text content as it appears."
                    : "Describe what is shown in this image. If there is readable text, transcribe it verbatim. If it's a screenshot of a UI/form/document, transcribe all visible text and note the layout.",
                },
              ],
            },
          ],
        });
        const text = result.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join("\n\n");
        return ok({
          document_id: doc.id,
          name: doc.original_name,
          mime_type: doc.mime_type,
          file_size: doc.file_size,
          content: text || "(no text extracted)",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[read_document] extraction failed", {
          document_id,
          mime_type: doc.mime_type,
          message,
        });
        return fail(`Extraction failed: ${message}`);
      }
    },
  );

  // ---- set_customer_owner -----------------------------------------
  const setCustomerOwner = tool(
    "set_customer_owner",
    "Associate a customer with its Onyx relationship owner — the rep who brought/closed them. George reports to and escalates to this person. Pass the owner's work email; they must be an existing Onyx team member. Discover the owner per customer (from the deal or the kickoff); never assume.",
    {
      customer_id: z.string().uuid(),
      owner_email: z
        .string()
        .email()
        .describe("Work email of the Onyx team member who owns this customer relationship."),
    },
    async ({ customer_id, owner_email }) => {
      const c = await db
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", customer_id)
        .maybeSingle();
      if (c.error) return fail(c.error.message);
      if (!c.data) return fail("Customer not found in this org.");

      const member = await db
        .from("org_members")
        .select("user_id, full_name, email")
        .eq("org_id", orgId)
        .ilike("email", owner_email)
        .maybeSingle();
      if (member.error) return fail(member.error.message);
      if (!member.data) {
        return fail(
          `No Onyx team member with email ${owner_email} in this org. The owner must be an existing member.`,
        );
      }

      const { data, error } = await db
        .from("customers")
        .update({ owner_user_id: member.data.user_id })
        .eq("id", customer_id)
        .select("id, name, owner_user_id")
        .single();
      if (error) return fail(error.message);
      return ok({ customer: data, owner: member.data });
    },
  );

  // ---- create_objective -------------------------------------------
  const createObjective = tool(
    "create_objective",
    "Create an objective George chases to keep an onboarding moving — a concrete thing to obtain or get done (e.g. 'Obtain partner logo (PNG/JPG)', 'Receive list of 3 power users'). The clock advances until the objective is ACHIEVED (your judgment from the actual deliverable), not merely replied to. Use responsible_side='customer' for things the customer owes (you chase the contact) and 'onyx' for things an Onyx teammate owes (you nudge them, escalate to the owner). For the standard onboarding set, read the playbook (core/01, core/03) and create one objective per item — the standard set is NOT hardcoded here.",
    {
      customer_id: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      kind: objectiveKindEnum.default("ad_hoc").optional(),
      responsible_side: objectiveSideEnum.default("customer").optional(),
      responsible_contact_id: z
        .string()
        .uuid()
        .optional()
        .describe("Customer-side contact you chase (when responsible_side='customer')."),
      owner_side_email: z
        .string()
        .email()
        .optional()
        .describe("Onyx teammate who owes this (when responsible_side='onyx'); resolved to a team member."),
      cc_emails: z
        .array(z.string().email())
        .optional()
        .describe("Key people both sides to CC on outreach about this objective."),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Hard external deadline — compresses follow-up urgency."),
      followup_interval_hours: z.number().int().min(1).max(720).default(48).optional(),
      max_followups: z.number().int().min(0).max(10).default(2).optional(),
      thread_conversation_id: z
        .string()
        .optional()
        .describe("Outlook conversation id to watch for achievement."),
      start_clock: z
        .boolean()
        .default(false)
        .optional()
        .describe("If true, set status='awaiting' and start the clock (next follow-up = now + interval). Use once the first ask has gone out."),
    },
    async (input) => {
      const c = await db
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", input.customer_id)
        .maybeSingle();
      if (c.error) return fail(c.error.message);
      if (!c.data) return fail("Customer not found in this org.");

      let ownerSideUserId: string | null = null;
      if (input.owner_side_email) {
        const m = await db
          .from("org_members")
          .select("user_id")
          .eq("org_id", orgId)
          .ilike("email", input.owner_side_email)
          .maybeSingle();
        if (m.error) return fail(m.error.message);
        if (!m.data) return fail(`No Onyx team member with email ${input.owner_side_email}.`);
        ownerSideUserId = m.data.user_id as string;
      }

      const interval = input.followup_interval_hours ?? 48;
      const start = input.start_clock ?? false;
      const { data, error } = await db
        .from("objectives")
        .insert({
          org_id: orgId,
          customer_id: input.customer_id,
          title: input.title,
          description: input.description ?? null,
          kind: input.kind ?? "ad_hoc",
          status: start ? "awaiting" : "pending",
          responsible_side: input.responsible_side ?? "customer",
          responsible_contact_id: input.responsible_contact_id ?? null,
          owner_side_user_id: ownerSideUserId,
          cc_emails: input.cc_emails ?? [],
          due_date: input.due_date ?? null,
          followup_interval_hours: interval,
          next_followup_at: start
            ? new Date(Date.now() + interval * 3_600_000).toISOString()
            : null,
          max_followups: input.max_followups ?? 2,
          thread_conversation_id: input.thread_conversation_id ?? null,
          source_session_id: ctx.sessionId ?? null,
          created_by: ctx.userId,
        })
        .select("*")
        .single();
      if (error) return fail(error.message);
      return ok({ objective: data });
    },
  );

  // ---- list_objectives --------------------------------------------
  const listObjectives = tool(
    "list_objectives",
    "List a customer's objectives (the checklist), optionally filtered by status. Use to see what's still open for a customer.",
    {
      customer_id: z.string().uuid(),
      status: objectiveStatusEnum.optional(),
    },
    async ({ customer_id, status }) => {
      let q = db
        .from("objectives")
        .select("*")
        .eq("org_id", orgId)
        .eq("customer_id", customer_id)
        .order("created_at", { ascending: true });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return fail(error.message);
      return ok({ objectives: data ?? [] });
    },
  );

  // ---- list_due_objectives ----------------------------------------
  const listDueObjectives = tool(
    "list_due_objectives",
    "List objectives across the org due for a follow-up: status='awaiting' with next_followup_at in the past (or within the optional look-ahead window). This is the work queue for keeping things moving — for each, judge whether it's achieved, follow up, or escalate. Returns the customer + relationship owner so you know who to chase and who to escalate to.",
    {
      within_hours: z
        .number()
        .int()
        .min(0)
        .max(168)
        .default(0)
        .optional()
        .describe("Look-ahead window in hours. 0 = only already-due."),
      limit: z.number().int().min(1).max(200).default(50).optional(),
    },
    async ({ within_hours, limit }) => {
      const cutoff = new Date(
        Date.now() + (within_hours ?? 0) * 3_600_000,
      ).toISOString();
      const { data, error } = await db
        .from("objectives")
        .select("*, customers!inner(id, name, owner_user_id)")
        .eq("org_id", orgId)
        .eq("status", "awaiting")
        .not("next_followup_at", "is", null)
        .lte("next_followup_at", cutoff)
        .order("next_followup_at", { ascending: true })
        .limit(limit ?? 50);
      if (error) return fail(error.message);
      return ok({ objectives: data ?? [], as_of: cutoff });
    },
  );

  // ---- update_objective -------------------------------------------
  const updateObjective = tool(
    "update_objective",
    "Update an objective. Mark status='achieved' ONLY once the actual deliverable has arrived (your judgment — a reply or out-of-office is NOT achievement); that stamps achieved_at and stops the clock. Set status='blocked' when you escalate to the owner. After you send a follow-up, pass bump_followup=true to advance the clock (increments followup_count and sets next_followup_at to now + interval).",
    {
      objective_id: z.string().uuid(),
      status: objectiveStatusEnum.optional(),
      bump_followup: z
        .boolean()
        .default(false)
        .optional()
        .describe("After sending a nudge: increments followup_count and advances next_followup_at by the interval."),
      next_followup_at: z
        .string()
        .datetime()
        .optional()
        .describe("Explicitly set the next follow-up time (overrides bump_followup's computed time)."),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      responsible_contact_id: z.string().uuid().nullable().optional(),
      cc_emails: z.array(z.string().email()).optional(),
      thread_conversation_id: z.string().optional(),
      description: z.string().optional(),
    },
    async ({
      objective_id,
      status,
      bump_followup,
      next_followup_at,
      due_date,
      responsible_contact_id,
      cc_emails,
      thread_conversation_id,
      description,
    }) => {
      const existing = await db
        .from("objectives")
        .select("id, followup_interval_hours, followup_count")
        .eq("org_id", orgId)
        .eq("id", objective_id)
        .maybeSingle();
      if (existing.error) return fail(existing.error.message);
      if (!existing.data) return fail("Objective not found in this org.");

      const patch: Record<string, unknown> = {};
      if (status !== undefined) {
        patch.status = status;
        if (status === "achieved") patch.achieved_at = new Date().toISOString();
      }
      if (bump_followup) {
        patch.followup_count = (existing.data.followup_count ?? 0) + 1;
        patch.next_followup_at = new Date(
          Date.now() + (existing.data.followup_interval_hours ?? 48) * 3_600_000,
        ).toISOString();
        if (status === undefined) patch.status = "awaiting";
      }
      if (next_followup_at !== undefined) patch.next_followup_at = next_followup_at;
      if (due_date !== undefined) patch.due_date = due_date;
      if (responsible_contact_id !== undefined)
        patch.responsible_contact_id = responsible_contact_id;
      if (cc_emails !== undefined) patch.cc_emails = cc_emails;
      if (thread_conversation_id !== undefined)
        patch.thread_conversation_id = thread_conversation_id;
      if (description !== undefined) patch.description = description;
      if (Object.keys(patch).length === 0) return fail("Nothing to update.");

      const { data, error } = await db
        .from("objectives")
        .update(patch)
        .eq("id", objective_id)
        .select("*")
        .single();
      if (error) return fail(error.message);
      return ok({ objective: data });
    },
  );

  // ---- propose_knowledge ------------------------------------------
  const proposeKnowledge = tool(
    "propose_knowledge",
    "Propose a durable knowledge concept for the org's knowledge base, learned from a conversation, email, meeting, or instruction. This does NOT publish — it stages the concept for human review (like drafting an email instead of sending). Use it when you learn something reusable that isn't already captured: a process, a partner fact, a product detail, a decision, a recurring answer. Do NOT propose ephemeral or customer-record data (that goes through the customer tools), and don't duplicate what's already in the knowledge manifest — search first. Keep one concept per proposal.",
    {
      path: z
        .string()
        .min(3)
        .describe(
          "Concept path, e.g. 'supplemental/zoho-renewal-quirks.md'. Use 'supplemental/...' for new learnings; never overwrite a 'core/...' path unless explicitly told to.",
        ),
      type: z
        .string()
        .min(1)
        .describe("OKF concept type: e.g. 'process', 'reference', 'playbook', 'faq', 'decision'."),
      title: z.string().min(1),
      description: z.string().min(1).describe("One-sentence summary."),
      content_md: z
        .string()
        .min(1)
        .describe("The concept body in markdown (no frontmatter — just the content)."),
      tags: z.array(z.string()).optional(),
      links: z
        .array(z.string())
        .optional()
        .describe("Paths of related concepts, e.g. ['/core/02-agent-george-role.md']."),
      source: z
        .enum(["chat", "email", "meeting", "instruction", "manual"])
        .describe("Where this knowledge came from."),
      rationale: z
        .string()
        .min(1)
        .describe("Why this is worth keeping and reviewing — what gap it fills."),
    },
    async ({ path, type, title, description, content_md, tags, links, source, rationale }) => {
      const existing = await db
        .from("knowledge_docs")
        .select("id")
        .eq("org_id", orgId)
        .eq("path", path)
        .maybeSingle();
      const kind = existing.data ? "update" : "create";

      const { data, error } = await db
        .from("knowledge_proposals")
        .insert({
          org_id: orgId,
          path,
          kind,
          concept_type: type,
          title,
          description,
          tags: tags ?? [],
          links: links ?? [],
          content_md,
          source,
          source_ref: ctx.sessionId ?? null,
          rationale,
          proposed_by: ctx.userId,
          status: "pending",
        })
        .select("id, path, kind, status")
        .single();
      if (error) return fail(error.message);
      return ok({
        proposal: data,
        note: "Staged for human review. It will NOT enter George's knowledge until a reviewer approves it in Settings → Agent George → Knowledge.",
      });
    },
  );

  // ---- list_pending_knowledge -------------------------------------
  const listPendingKnowledge = tool(
    "list_pending_knowledge",
    "List knowledge proposals awaiting human review for this org. Use this for the weekly knowledge-review digest — to compile what you've proposed since the last review so a human can approve or reject it. Read-only.",
    {},
    async () => {
      const { data, error } = await db
        .from("knowledge_proposals")
        .select("id, path, kind, concept_type, title, description, source, rationale, created_at")
        .eq("org_id", orgId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) return fail(error.message);
      return ok({ pending: data ?? [], count: (data ?? []).length });
    },
  );

  // ---- search_mailbox ----------------------------------------------
  const searchMailbox = tool(
    "search_mailbox",
    "Search George's OWN mirrored mailbox — inbox, sent, and all folders — by text, sender, direction, and date. This reads the local mirror, so it is fast and works across full history; prefer it over the live Outlook tools for 'what did we say / what came in' questions. Returns concise message rows (subject, sender, preview, dates, conversation_id). Use get_email_thread(conversation_id) to read a full exchange.",
    {
      query: z
        .string()
        .optional()
        .describe("Text to match in subject, preview, or sender. Omit to filter by sender/date only."),
      from: z.string().optional().describe("Filter to a sender email (substring match)."),
      direction: z
        .enum(["inbound", "outbound"])
        .optional()
        .describe("inbound = received, outbound = sent/drafted by George."),
      since: z
        .string()
        .optional()
        .describe("ISO date/time; only messages received on or after this."),
      limit: z.number().int().min(1).max(50).default(20).optional(),
    },
    async ({ query, from, direction, since, limit }) => {
      let q = db
        .from("email_messages")
        .select(
          "external_id, conversation_id, direction, subject, body_preview, from_address, from_name, to_recipients, received_at, sent_at, is_read, has_attachments",
        )
        .eq("org_id", orgId);
      if (query) {
        // Strip PostgREST filter-syntax chars so user text can't break the .or().
        const safe = query.replace(/[,()%*]/g, " ").trim();
        if (safe) {
          q = q.or(
            `subject.ilike.%${safe}%,body_preview.ilike.%${safe}%,from_address.ilike.%${safe}%,from_name.ilike.%${safe}%`,
          );
        }
      }
      if (from) q = q.ilike("from_address", `%${from}%`);
      if (direction) q = q.eq("direction", direction);
      if (since) q = q.gte("received_at", since);
      const { data, error } = await q
        .order("received_at", { ascending: false })
        .limit(limit ?? 20);
      if (error) return fail(error.message);
      return ok({ messages: data ?? [], count: (data ?? []).length });
    },
  );

  // ---- get_email_thread --------------------------------------------
  const getEmailThread = tool(
    "get_email_thread",
    "Return every mirrored message in one conversation (thread), oldest first, with full bodies. Get the conversation_id from search_mailbox results.",
    {
      conversation_id: z.string().min(1),
    },
    async ({ conversation_id }) => {
      const { data, error } = await db
        .from("email_messages")
        .select(
          "external_id, direction, subject, from_address, from_name, to_recipients, cc_recipients, received_at, sent_at, is_read, has_attachments, body_preview, body_html",
        )
        .eq("org_id", orgId)
        .eq("conversation_id", conversation_id)
        .order("received_at", { ascending: true });
      if (error) return fail(error.message);
      if (!data || data.length === 0)
        return fail("No mirrored messages for that conversation_id.");
      return ok({ conversation_id, messages: data, count: data.length });
    },
  );

  // ---- list_calendar -----------------------------------------------
  const listCalendar = tool(
    "list_calendar",
    "List events from George's mirrored M365 calendar in a time window. Reads the local mirror (fast, no API call). Defaults to the next 14 days.",
    {
      from: z.string().optional().describe("ISO start of window. Defaults to now."),
      to: z.string().optional().describe("ISO end of window. Defaults to 14 days out."),
      limit: z.number().int().min(1).max(100).default(50).optional(),
    },
    async ({ from, to, limit }) => {
      const start = from ?? new Date().toISOString();
      const end = to ?? new Date(Date.now() + 14 * 86400000).toISOString();
      const { data, error } = await db
        .from("calendar_events")
        .select(
          "external_id, subject, start_at, end_at, location, organizer_name, organizer_address, attendees, online_meeting_url, is_all_day, is_cancelled, web_link",
        )
        .eq("org_id", orgId)
        .gte("start_at", start)
        .lte("start_at", end)
        .order("start_at", { ascending: true })
        .limit(limit ?? 50);
      if (error) return fail(error.message);
      return ok({ events: data ?? [], count: (data ?? []).length });
    },
  );

  const listTranscripts = tool(
    "list_transcripts",
    "List meeting transcripts from George's note-taker (Scribe), mirrored locally. Newest first. Filter by customer_id to get a partner's meetings. Returns metadata + summary, not the full transcript — call read_transcript for that.",
    {
      customer_id: z.string().uuid().optional().describe("Limit to one customer's meetings."),
      limit: z.number().int().min(1).max(50).default(20).optional(),
    },
    async ({ customer_id, limit }) => {
      let q = db
        .from("meeting_transcripts")
        .select(
          "id, title, status, started_at, ended_at, duration_min, attendees, summary, customer_id",
        )
        .eq("org_id", orgId)
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(limit ?? 20);
      if (customer_id) q = q.eq("customer_id", customer_id);
      const { data, error } = await q;
      if (error) return fail(error.message);
      return ok({ transcripts: data ?? [], count: (data ?? []).length });
    },
  );

  const readTranscript = tool(
    "read_transcript",
    "Read the full transcript + insights for one meeting. Pass the id from list_transcripts. Use it to update what you know about the account — decisions, commitments and owners, blockers, sentiment, feature requests, progress against the onboarding plan — and to record a health signal. Not for writing a summary to send anyone — Scribe already does that for the attendees.",
    {
      transcript_id: z.string().uuid(),
    },
    async ({ transcript_id }) => {
      const { data, error } = await db
        .from("meeting_transcripts")
        .select(
          "id, title, status, started_at, ended_at, duration_min, attendees, transcript_text, insights, summary, customer_id, meeting_url",
        )
        .eq("org_id", orgId)
        .eq("id", transcript_id)
        .maybeSingle();
      if (error) return fail(error.message);
      if (!data) return fail("Transcript not found in this org.");
      return ok({ transcript: data });
    },
  );

  const raiseDecision = tool(
    "raise_decision",
    "Escalate to your human manager: record a decision you can't make on your own (pricing/commercial calls, contract/legal, an external email that shouldn't go without review, or anything above your remit). This puts it on the team's 'Needs you' queue so it can't be missed. Also send the manager a one-line internal email pointing here. Don't use this for routine work you can just do.",
    {
      title: z.string().min(1).describe("Short headline, e.g. 'Acme wants a 20% discount — approve?'"),
      detail: z.string().min(1).describe("What's going on and exactly what you need decided."),
      recommendation: z.string().optional().describe("Your proposed answer, if you have one."),
      suggested_actions: z
        .array(
          z.object({
            label: z
              .string()
              .min(1)
              .describe("The concrete action, phrased as an imperative the reviewer could hand back to you, e.g. 'Add Fraser Maclean as a platform user and assign him as RKON's owner'."),
            kind: z
              .enum(["create", "assign", "update", "email", "confirm", "other"])
              .default("other")
              .optional()
              .describe("Category, for the button's icon/badge."),
          }),
        )
        .max(4)
        .optional()
        .describe(
          "1–4 concrete next actions the reviewer could take. Each renders as a one-click button that hands the instruction back to you to execute. Make them mutually-exclusive options when the decision is a fork (e.g. 'Assign Fraser' vs 'Assign John').",
        ),
      urgency: z.enum(["low", "normal", "high"]).default("normal").optional(),
      customer_id: z.string().uuid().optional().describe("The customer this concerns, if any."),
      kind: z
        .enum(["account", "system"])
        .default("account")
        .optional()
        .describe(
          "'account' (default) = a judgement about a customer, for whoever owns the relationship. 'system' = something is broken and needs fixing, not deciding — a disconnected mailbox, a failing sync, an integration returning 401. If nobody could resolve this by choosing between options, it is 'system'.",
        ),
      dedupe_key: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "A stable name for the CONDITION you are reporting, not for this occurrence — e.g. 'nylas_auth_failed' or 'transcript_sync_blocked'. If an open decision already carries this key, yours is dropped and the existing one is returned instead of adding a duplicate. Always set it for anything that will recur while it stays unfixed; a 401 that reports itself twenty times is twenty rows and one problem.",
        ),
    },
    async ({ title, detail, recommendation, suggested_actions, urgency, customer_id, kind, dedupe_key }) => {
      // A recurring condition finds the open row instead of adding another.
      //
      // The 401 that ran all week is the case this exists for: the mailbox was
      // disconnected, every tick noticed, and each notice became its own
      // "decision" — a queue full of identical rows asking a person to decide
      // something that was not a decision.
      //
      // Only OPEN rows are matched. Once somebody resolves it, the condition
      // recurring is genuinely new information and should be raised again.
      if (dedupe_key) {
        const { data: dupe } = await db
          .from("escalations")
          .select("id")
          .eq("org_id", orgId)
          .eq("dedupe_key", dedupe_key)
          .eq("status", "open")
          .limit(1);
        const existing = (dupe ?? [])[0] as { id: string } | undefined;
        if (existing) {
          return ok({
            escalation_id: existing.id,
            status: "open",
            deduped: true,
            note:
              `This condition is already on the queue as ${existing.id} and has not been ` +
              "resolved yet. Nothing new was raised. Do not email the manager about it again.",
          });
        }
      }

      const { data, error } = await db
        .from("escalations")
        .insert({
          org_id: orgId,
          customer_id: customer_id ?? null,
          session_id: ctx.sessionId ?? null,
          title,
          detail,
          recommendation: recommendation ?? null,
          suggested_actions: suggested_actions ?? [],
          urgency: urgency ?? "normal",
          status: "open",
          kind: kind ?? "account",
          dedupe_key: dedupe_key ?? null,
        })
        .select("id")
        .single();
      // The unique index on (org_id, dedupe_key) for open rows is the real
      // guard — the read above races with a concurrent tick, and the database
      // is the only place that can settle it. A rejected duplicate is the
      // system working, not an error worth reporting up.
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message)) {
          return ok({
            status: "open",
            deduped: true,
            note: "Another run raised this same condition first. Nothing new was raised.",
          });
        }
        return fail(error.message);
      }
      return ok({
        escalation_id: data.id,
        status: "open",
        note: "Logged to the Needs-you queue. Send the manager a short internal email pointing at this decision.",
      });
    },
  );

  const listOpenDecisions = tool(
    "list_open_decisions",
    "List escalations still awaiting a human decision (status='open'), newest first. Use during a proactive scan to re-ping the manager on anything stale.",
    {
      limit: z.number().int().min(1).max(50).default(20).optional(),
    },
    async ({ limit }) => {
      const { data, error } = await db
        .from("escalations")
        .select("id, title, urgency, customer_id, created_at")
        .eq("org_id", orgId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(limit ?? 20);
      if (error) return fail(error.message);
      return ok({ open_decisions: data ?? [], count: (data ?? []).length });
    },
  );

  // ---- request_domain_approval --------------------------------------
  const requestDomainApproval = tool(
    "request_domain_approval",
    "Ask a human to approve an external email domain so you can draft-and-send to it directly, instead of every message to that domain needing manual review. Use this when a customer/partner domain keeps coming up (e.g. you keep having to tell the user to send it themselves). This does NOT grant access — it stages a request; an owner, admin, or CSM approves it in Settings → Agent George → Email domains. Until approved, send_email_draft still refuses that domain.",
    {
      domain: z
        .string()
        .min(3)
        .describe("Domain only, no scheme or path, e.g. 'acmecorp.com'."),
      reason: z.string().min(1).describe("Why George needs to email this domain directly."),
      customer_id: z.string().uuid().optional().describe("The customer this domain belongs to, if known."),
    },
    async ({ domain, reason, customer_id }) => {
      const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      // "Already internal" is a property of THIS org, not a hardcoded pair of
      // company names. Those were two different tenants' domains sitting in live
      // code: a third org could not have approved either of them, and one tenant's
      // domain was being treated as internal while judging another's request.
      const identity = await resolveOrgIdentity(db, orgId);
      if (identity.internalDomains.has(clean)) {
        return ok({ note: "That domain is already internal — no approval needed." });
      }
      const { data, error } = await db
        .from("domain_allowlist")
        .insert({
          org_id: orgId,
          domain: clean,
          reason,
          customer_id: customer_id ?? null,
          requested_by: null, // George proposed it, not a human
        })
        .select("id, domain, status")
        .single();
      if (error) {
        if (error.message.includes("domain_allowlist_org_domain_idx")) {
          const existing = await db
            .from("domain_allowlist")
            .select("domain, status")
            .eq("org_id", orgId)
            .ilike("domain", clean)
            .maybeSingle();
          return ok({
            note: `${clean} is already on the list with status '${existing.data?.status ?? "unknown"}'.`,
          });
        }
        return fail(error.message);
      }
      return ok({
        request: data,
        note: "Staged for approval. Tell the user it's waiting in Settings → Agent George → Email domains — you still can't send there until it's approved.",
      });
    },
  );

  // ---- list_domain_allowlist ------------------------------------------
  const listDomainAllowlist = tool(
    "list_domain_allowlist",
    "List this org's email domain allowlist — pending requests and decided (approved/rejected) domains. Read-only. Use this before telling a user a domain needs approval, in case it's already pending or already approved.",
    {
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    },
    async ({ status }) => {
      let query = db
        .from("domain_allowlist")
        .select("id, domain, status, reason, decision_note, created_at, decided_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return fail(error.message);
      return ok({ domains: data ?? [], count: (data ?? []).length });
    },
  );

  // ---- record_observation ------------------------------------------
  const recordObservation = tool(
    "record_observation",
    "Record something you noticed about an account. Use this for anything worth knowing that nobody has to act on: a risk, a commitment the customer made, a change in tone, a milestone that slipped, a new stakeholder appearing, something they said about their own priorities. This is how you build up an understanding of a customer over time. It does NOT ask anyone to do anything — a person reads the account and decides. Prefer this over raise_decision unless a human genuinely has to make a call today.",
    {
      customer_id: z.string().uuid().describe("The customer this is about."),
      summary: z
        .string()
        .min(1)
        .max(200)
        .describe("One line somebody can scan in a list, e.g. 'Krishna is leaving in October and has not named a replacement'. Not a category — the actual thing."),
      detail: z
        .string()
        .optional()
        .describe("The evidence. Quote the customer where there is a quote to give — a quotation and an inference are different kinds of claim and the reader needs to tell them apart."),
      source: z
        .enum(["email", "transcript", "meeting", "reply", "scan", "chat", "other"])
        .describe("Where you learned it. 'scan' means you worked it out from the account record rather than being told."),
      category: z
        .enum(["risk", "progress", "relationship", "commercial", "product", "other"])
        .default("other")
        .optional(),
      observed_at: z
        .string()
        .optional()
        .describe("When the thing happened, ISO date, if it was not now. A transcript synced today may describe last week's call — use the call's date, or the feed tells the story in the wrong order."),
      source_ref: z
        .string()
        .optional()
        .describe("Identifier for what you read: a thread id, a transcript id, a meeting title."),
      dedupe_key: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Stable name for the thing observed, e.g. 'champion_leaving:krishna'. You re-read the same threads on every sync; without this you re-record the same sentence every time. Set it whenever the observation is about a durable fact rather than a one-off event."),
    },
    async ({ customer_id, summary, detail, source, category, observed_at, source_ref, dedupe_key }) => {
      // Scoped through the org, so a customer id from another tenant cannot be
      // written against — the same check every other customer-scoped tool does.
      const owner = await db
        .from("customers")
        .select("id")
        .eq("id", customer_id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!owner.data) return fail("No such customer in this organisation.");

      const { data, error } = await db
        .from("customer_observations")
        .insert({
          org_id: orgId,
          customer_id,
          summary,
          detail: detail ?? null,
          source,
          category: category ?? "other",
          observed_at: observed_at ?? new Date().toISOString(),
          session_id: ctx.sessionId ?? null,
          source_ref: source_ref ?? null,
          dedupe_key: dedupe_key ?? null,
        })
        .select("id")
        .single();

      if (error) {
        // The unique index doing its job. Re-reading a thread and reaching the
        // same conclusion is correct behaviour, not an error to report up.
        if (/duplicate key|unique constraint/i.test(error.message)) {
          return ok({
            recorded: false,
            deduped: true,
            note: "Already recorded against this account under that key. Nothing added.",
          });
        }
        return fail(error.message);
      }
      return ok({ observation_id: data.id, recorded: true });
    },
  );

  // `raise_decision` is in the grant only when this run may create work for a
  // human. On an autonomous run in assistant mode it is absent, and
  // `record_observation` is what George has instead.
  //
  // Absent, not discouraged. An instruction not to use an available tool is the
  // failure mode this codebase keeps finding; there is nothing to talk itself
  // out of if the tool is not there.
  const mayRaise = ctx.mayRaiseDecisions !== false;

  const supabaseTools = [
    findCustomer,
    listCustomers,
    getCustomer,
    recordObservation,
    ...(mayRaise ? [raiseDecision] : []),
    listOpenDecisions,
    requestDomainApproval,
    listDomainAllowlist,
    createCustomer,
    addContact,
    recordContract,
    createOnboardingPlan,
    listOnboardingSteps,
    updateOnboardingStep,
    recordHealthCheck,
    setCadence,
    listUpcomingCadences,
    markCadenceMet,
    setCustomerOwner,
    createObjective,
    listObjectives,
    listDueObjectives,
    updateObjective,
    searchKnowledge,
    readKnowledgeDoc,
    readDocument,
    proposeKnowledge,
    listPendingKnowledge,
    searchMailbox,
    getEmailThread,
    listCalendar,
    listTranscripts,
    readTranscript,
  ];

  const mailCtx = {
    orgId,
    userId: ctx.userId,
    sessionId: ctx.sessionId ?? null,
    emailSendPolicy: ctx.emailSendPolicy ?? "chat",
    db,
  };
  const composioTools = buildComposioTools(mailCtx);

  // George is an employee: it owns its mailbox AND its calendar, and never
  // reaches into a person's account. So when a Nylas mailbox is configured it
  // supplies email and calendar both, and NO Composio tool is registered.
  //
  // Composio deliberately stays in the codebase rather than being deleted: it
  // is the fallback until the Nylas approach is proven in real use. Removing
  // one env var reverts George to it — same switch discipline as DATABASE_URL
  // and STORAGE_DRIVER.
  // Three gates, all of which must pass before George can touch mail:
  //   1. a provider is chosen and its credentials exist  (mail-selection.ts)
  //   2. a human enabled it FOR THIS ORG                 (integration-toggle.ts)
  //   3. the tools then register — absent otherwise, never present-and-refusing
  const mailOff = mailDisabled() || ctx.enabled?.nylas === false;
  const mailTools = mailOff
    ? []
    : usingNylas()
      ? buildNylasEmailTools(mailCtx)
      : composioTools;

  const tools = [...supabaseTools, ...mailTools];

  const server = createSdkMcpServer({
    name: "george",
    version: "0.1.0",
    tools,
    alwaysLoad: true,
  });

  const toolNames = tools.map((t) => `mcp__george__${t.name}`);
  return { server, toolNames };
}

