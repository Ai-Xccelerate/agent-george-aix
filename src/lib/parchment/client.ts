/**
 * Parchment REST client — the org knowledge base George reads from.
 *
 * AUTH: THE INTERNAL AGENT PATH, NOT A PASTED API KEY
 * Parchment has two integration models. The public one needs a human to log in,
 * create a workspace and mint a workspace-bound `pcm_...` key. The internal one
 * — documented in the Parchment repo as docs/agent-integration-internal.md —
 * exists precisely so AIX Core agent products don't have to do that: George
 * presents one shared secret plus the org's Clerk id, and Parchment resolves (or
 * lazily creates) that org's default workspace on the first call.
 *
 *   X-Internal-Key:  the shared secret, from PARCHMENT_INTERNAL_AGENT_KEY
 *   X-Clerk-Org-Id:  the org's Clerk organization id
 *   X-Agent-Id:      "george" — attribution, not permission
 *   X-Workspace-Id:  optional, only when not using the org's default
 *
 * That is why there is no connect form and no stored credential: there is
 * nothing for a user to paste. Access is default-allow for every org.
 *
 * ACCESS CEILING — READ AND PROPOSE ONLY
 * This path grants exactly the `agent` role. `/ingest` is refused with
 * "Requires editor role; credential has agent" (verified against staging), so
 * George cannot write sections directly. Corrections go through the proposal
 * tools, staged for human review.
 *
 * FAIL OPEN, ALWAYS
 * Nothing here throws. Every method resolves `{ ok: true, data }` or
 * `{ ok: false, error }`, because these calls sit behind agent tools on the SSE
 * chat path: an unreachable knowledge base must degrade George's answer, never
 * break the conversation. Parchment's own guide asks for exactly this.
 *
 * DIVISION OF KNOWLEDGE (see AGENTS.md)
 * Parchment holds ORGANISATIONAL knowledge. George's CORE playbooks stay as repo
 * markdown in knowledge/core/ and are served from Postgres by read_knowledge_doc,
 * because they are George's operating instructions: version-controlled, reviewed
 * in PRs, and required even when Parchment is down.
 */

/** This agent's attribution label, sent as X-Agent-Id. */
export const AGENT_ID = "george";

/** A section as Parchment returns it: full content plus its ancestor chain. */
export type ParchmentSection = {
  section_id: string;
  source_file: string;
  hierarchy_path: string;
  h_level: number;
  title: string;
  content: string;
  score?: number;
  similarity?: number;
  business_function?: string | null;
  business_objective?: string | null;
  ancestors?: Array<{
    section_id: string;
    title: string;
    hierarchy_path: string;
    content: string;
  }>;
};

export type ParchmentQueryResult = {
  query: string;
  count: number;
  iterations?: number;
  confidence?: number;
  reformulations?: string[];
  results: ParchmentSection[];
};

export type ParchmentDocument = {
  source_file: string;
  [key: string]: unknown;
};

export type ParchmentWorkspace = {
  id: string;
  name: string;
  visibility: string;
};

export type WorkspaceResolution = {
  org_id: string;
  default_workspace_id: string;
  workspaces: ParchmentWorkspace[];
};

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; status?: number };
export type ParchmentResult<T> = Ok<T> | Err;

/** Everything needed to talk to one org's knowledge base. */
export type ParchmentConfig = {
  base: string;
  internalKey: string;
  /** The org's Clerk organization id — how Parchment identifies the tenant. */
  clerkOrgId: string;
  /** Optional: a specific workspace instead of the org's default. */
  workspaceId?: string | null;
  agentId?: string;
};

/** The deployment-level half of the config: URL + shared secret. */
export type ParchmentDeployment = { base: string; internalKey: string };

/**
 * The deployment's Parchment settings, or null when this path is switched off.
 *
 * Both variables are required: a URL without the secret 401s on every call, and
 * a secret without a URL has nowhere to go. Treating half-configuration as "off"
 * is deliberate — the alternative is an integration that looks enabled and fails
 * on every request.
 *
 * PARCHMENT_API_BASE is accepted as an alias for PARCHMENT_API_URL so an
 * environment configured before the internal path existed keeps working.
 */
export function parchmentDeployment(): ParchmentDeployment | null {
  const base = (process.env.PARCHMENT_API_URL ?? process.env.PARCHMENT_API_BASE)
    ?.trim()
    .replace(/\/+$/, "");
  const internalKey = process.env.PARCHMENT_INTERNAL_AGENT_KEY?.trim();
  if (!base || !internalKey) return null;
  return { base, internalKey };
}

/** True when this deployment can reach Parchment at all. */
export function isParchmentConfigured(): boolean {
  return parchmentDeployment() !== null;
}

/** Which variables are missing, for the Settings UI to explain itself. */
export function parchmentMissingVars(): string[] {
  const missing: string[] = [];
  if (!process.env.PARCHMENT_API_URL?.trim() && !process.env.PARCHMENT_API_BASE?.trim()) {
    missing.push("PARCHMENT_API_URL");
  }
  if (!process.env.PARCHMENT_INTERNAL_AGENT_KEY?.trim()) {
    missing.push("PARCHMENT_INTERNAL_AGENT_KEY");
  }
  return missing;
}

/** Read calls are on the chat path, so they get a short leash. */
const READ_TIMEOUT_MS = 12_000;
/** Provisioning on first touch can be slower than a plain read. */
const RESOLVE_TIMEOUT_MS = 20_000;

type RequestOpts = {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Omit the tenant headers — only the org-scoped calls need them. */
  tenantless?: boolean;
};

async function request<T>(
  cfg: ParchmentConfig,
  path: string,
  opts: RequestOpts = {},
): Promise<ParchmentResult<T>> {
  const url = new URL(`${cfg.base}${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { "X-Internal-Key": cfg.internalKey };
  if (!opts.tenantless) {
    headers["X-Clerk-Org-Id"] = cfg.clerkOrgId;
    headers["X-Agent-Id"] = cfg.agentId ?? AGENT_ID;
    // Only send a workspace when one was chosen; absent means "the org's
    // default", which is what almost every org wants.
    if (cfg.workspaceId) headers["X-Workspace-Id"] = cfg.workspaceId;
  }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      // Knowledge changes when someone ingests, not on a timer — and a stale
      // answer to a policy question is worse than a slow one.
      cache: "no-store",
    });

    if (!res.ok) {
      // Translated into something an operator reading George's logs can act on.
      // The meanings differ from the public API-key path: here a 401 is about
      // the shared secret or the org header, and a 403 means either the path is
      // switched off in Parchment or the endpoint needs a role above `agent`.
      const detail = await res.text().catch(() => "");
      const known: Record<number, string> = {
        401: "Parchment rejected the internal credential (401). Either PARCHMENT_INTERNAL_AGENT_KEY is wrong, or this org has no Clerk organization id, or the selected workspace does not belong to it.",
        403: "Parchment refused this call (403). Either the internal agent path is not enabled on that Parchment instance, or the endpoint needs a role above 'agent' — George's credential is read-and-propose only, so it cannot ingest or edit sections.",
        404: "Not found in this Parchment workspace (404).",
        413: "Content exceeds Parchment's size cap (413).",
        429: "Rate limited by Parchment (429). /query allows 300/min.",
        503: "Parchment is temporarily unavailable (503) — retry.",
      };
      return {
        ok: false,
        status: res.status,
        error: known[res.status] ?? `Parchment returned ${res.status}: ${detail.slice(0, 200)}`,
      };
    }

    if (res.status === 204) return { ok: true, data: undefined as T };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? `Parchment did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach Parchment: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a client bound to one org's knowledge base.
 *
 * Config is a parameter rather than ambient state because the tenant header
 * changes per org: reading a process-wide default here could serve one
 * organisation another organisation's knowledge.
 */
export function createParchmentClient(cfg: ParchmentConfig) {
  return {
    /** Liveness. Needs no tenant headers, so it also works before an org exists. */
    health(): Promise<ParchmentResult<{ status: string; database?: string }>> {
      return request(cfg, "/health", { timeoutMs: 6_000, tenantless: true });
    },

    /**
     * Discover the org's workspaces, provisioning its default one on first
     * touch. Idempotent — every later call returns the same list.
     *
     * The org id goes in the PATH here (not the header), per the internal doc.
     */
    resolveWorkspaces(): Promise<ParchmentResult<WorkspaceResolution>> {
      return request(
        cfg,
        `/internal/orgs/${encodeURIComponent(cfg.clerkOrgId)}/workspaces/resolve`,
        {
          method: "POST",
          body: { agent_id: cfg.agentId ?? AGENT_ID },
          timeoutMs: RESOLVE_TIMEOUT_MS,
          tenantless: true,
        },
      );
    },

    /**
     * The primary endpoint. `iterative` runs Parchment's ReAct refine loop, which
     * recovers recall a plain AND-match misses at the cost of latency — off by
     * default because this runs inside a chat turn.
     */
    query(args: {
      query: string;
      limit?: number;
      business_function?: string | null;
      business_objective?: string | null;
      iterative?: boolean;
    }): Promise<ParchmentResult<ParchmentQueryResult>> {
      return request(cfg, "/query", {
        method: "POST",
        body: {
          query: args.query,
          limit: Math.min(Math.max(args.limit ?? 5, 1), 50),
          business_function: args.business_function ?? null,
          business_objective: args.business_objective ?? null,
          iterative: args.iterative ?? false,
        },
      });
    },

    /** One section plus its ancestors — the follow-up to a search hit. */
    section(sectionId: string): Promise<ParchmentResult<ParchmentSection>> {
      return request(cfg, `/sections/${encodeURIComponent(sectionId)}`);
    },

    sections(
      args: { business_function?: string; limit?: number } = {},
    ): Promise<ParchmentResult<{ sections?: ParchmentSection[] } | ParchmentSection[]>> {
      return request(cfg, "/sections", { params: { ...args } });
    },

    /**
     * Ingested documents. Verified against staging: the response is
     * `{"documents": [...]}`, not a bare array — hence `documentCount()` below
     * rather than callers guessing.
     */
    documents(): Promise<
      ParchmentResult<{ documents?: ParchmentDocument[] } | ParchmentDocument[]>
    > {
      return request(cfg, "/documents");
    },

    taxonomy(): Promise<ParchmentResult<unknown>> {
      return request(cfg, "/taxonomy");
    },

    objectives(): Promise<ParchmentResult<unknown>> {
      return request(cfg, "/objectives");
    },

    overview(): Promise<ParchmentResult<unknown>> {
      return request(cfg, "/knowledge/overview");
    },
  };
}

export type ParchmentClient = ReturnType<typeof createParchmentClient>;

/**
 * Count documents from whatever shape the endpoint returned.
 *
 * Staging returns `{documents: [...]}`; the public REST doc reads like a bare
 * array. Tolerating both is cheaper than being wrong in the UI, where the
 * difference is a silent "—" instead of a real number.
 */
export function documentCount(
  data: { documents?: ParchmentDocument[] } | ParchmentDocument[] | null | undefined,
): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.documents)) return data.documents.length;
  return null;
}

/**
 * Flatten a query result into the shape George's `search_knowledge` tool already
 * returns, so swapping the backend does not change the tool's contract with the
 * model. `hierarchy_path` is carried through deliberately: it is the provenance
 * that lets George cite where an answer came from, which chunk-based search
 * could never give it.
 */
export function toKnowledgeHits(result: ParchmentQueryResult) {
  return (result.results ?? []).map((s) => ({
    score: typeof s.score === "number" ? Number(s.score.toFixed(4)) : undefined,
    path: s.source_file,
    title: s.title,
    hierarchy_path: s.hierarchy_path,
    section_id: s.section_id,
    business_function: s.business_function ?? undefined,
    is_core: false,
    snippet: s.content,
    // Ancestors are the difference between a chunk and a grounded section, but
    // the full chain would flood the context — titles give the model the frame
    // and it can fetch the section for the bodies.
    context: (s.ancestors ?? []).map((a) => a.title).join(" > ") || undefined,
  }));
}
