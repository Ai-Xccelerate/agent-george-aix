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

export type GeorgeToolCtx = {
  orgId: string;
  /**
   * The human running the agent, when there is one. Null on autonomous
   * standing-job runs — DB writes that reference a user (e.g.
   * `customers.owner_user_id`) become null in that case.
   */
  userId: string | null;
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
      };

      const [contacts, contracts, plan, health, parent, endCustomers, cadence] =
        await Promise.all([
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
        ]);

      return ok({
        customer: customerRes.data,
        parent: parent.data ?? null,
        end_customers: endCustomers.data ?? [],
        contacts: contacts.data ?? [],
        contracts: contracts.data ?? [],
        active_plan: plan.data ?? null,
        latest_health: health.data ?? null,
        cadence: cadence.data ?? null,
      });
    },
  );

  // ---- create_customer --------------------------------------------
  const createCustomer = tool(
    "create_customer",
    "Create a new customer record. `customer_kind` distinguishes partners (MSPs Onyx contracts with) from end_customers (customers of a partner). End customers REQUIRE parent_customer_id pointing to their partner. Defaults to 'partner' to preserve existing behavior. Confirm the kind with the user when ambiguous.",
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
      if (error) return fail(error.message);
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
    "Semantic search across the org's full knowledge base (core + supplemental). Returns the most relevant ~800-char chunks with their source path. Use when you don't know which doc has the answer. If a hit is from a core playbook and you need the surrounding context, follow up with `read_knowledge_doc(path)` to fetch the full doc.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).default(5).optional(),
    },
    async ({ query, limit }) => {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      if (words.length === 0) {
        return ok({ hits: [] });
      }

      const orFilter = words.map((w) => `content.ilike.%${w}%`).join(",");

      const { data, error } = await db
        .from("knowledge_chunks")
        .select(
          "content, ordinal, metadata, knowledge_docs!inner(path, title, org_id, is_core)",
        )
        .eq("org_id", orgId)
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
        .slice(0, limit ?? 5);

      return ok({
        hits: scored,
        note:
          scored.length === 0
            ? "No matches. Check the knowledge manifest in your system prompt — you can fetch any listed doc in full with `read_knowledge_doc(path)`."
            : undefined,
      });
    },
  );

  // ---- read_knowledge_doc -----------------------------------------
  const readKnowledgeDoc = tool(
    "read_knowledge_doc",
    "Fetch the full markdown of one knowledge doc by its `path` (the values shown in the knowledge manifest in your system prompt). Use when you know which doc has the answer — e.g. process / role / lifecycle questions point at the core playbooks. Returns content_md, title, version. Errors if the path doesn't exist for this org.",
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

  const supabaseTools = [
    findCustomer,
    listCustomers,
    getCustomer,
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
    searchKnowledge,
    readKnowledgeDoc,
  ];

  const composioTools = buildComposioTools({
    orgId,
    userId: ctx.userId,
    db,
  });

  const tools = [...supabaseTools, ...composioTools];

  const server = createSdkMcpServer({
    name: "george",
    version: "0.1.0",
    tools,
    alwaysLoad: true,
  });

  const toolNames = tools.map((t) => `mcp__george__${t.name}`);
  return { server, toolNames };
}

