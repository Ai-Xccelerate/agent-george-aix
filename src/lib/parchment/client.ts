/**
 * Parchment REST client — the org knowledge base George reads from.
 *
 * WHY REST AND NOT MCP
 * Parchment offers both, on the same key. MCP would mean George's agent runtime
 * connecting out to another MCP server mid-conversation, with its own session
 * lifecycle and failure modes inside the SSE chat path. REST is a plain HTTP
 * call we can time out, cache, and fail open on — and George already wraps its
 * own tools, so the MCP tool surface buys nothing here. The one thing MCP has
 * that REST does not is `browse_bundle`/`lookup_entity`; if those become
 * necessary they can be added as endpoints or a second path later.
 *
 * FAIL OPEN, ALWAYS
 * Nothing here throws. Every method resolves `{ ok: true, data }` or
 * `{ ok: false, error }`, because these calls sit behind agent tools on the chat
 * path: an unreachable knowledge base must degrade George's answer, never break
 * the conversation. Parchment's own integration guide asks for exactly this.
 *
 * DIVISION OF KNOWLEDGE (see AGENTS.md)
 * Parchment holds ORGANISATIONAL knowledge — policies, product, licensing,
 * customer specifics. George's CORE playbooks stay as repo markdown in
 * knowledge/core/ and are served from Postgres by read_knowledge_doc, because
 * they are George's operating instructions: version-controlled, reviewed in
 * PRs, and required even when Parchment is down.
 *
 * Enabled only when both PARCHMENT_API_BASE and PARCHMENT_API_KEY are set, so
 * this is reversible by deleting a variable — the same pattern as DATABASE_URL
 * and STORAGE_DRIVER.
 */

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

export type ParchmentJob = {
  job_id: string;
  status: "queued" | "processing" | "done" | "failed";
  sections_created?: number;
  error?: string | null;
};

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; status?: number };
export type ParchmentResult<T> = Ok<T> | Err;

export type ParchmentConfig = { base: string; apiKey: string };

/**
 * Both variables must be present. A base URL without a key would 401 on every
 * call; a key without a base has nowhere to go. Treating half-configuration as
 * "off" is deliberate — the alternative is an integration that looks enabled in
 * the UI and fails on every request.
 */
export function parchmentConfig(): ParchmentConfig | null {
  const base = process.env.PARCHMENT_API_BASE?.trim().replace(/\/+$/, "");
  const apiKey = process.env.PARCHMENT_API_KEY?.trim();
  if (!base || !apiKey) return null;
  return { base, apiKey };
}

export function isParchmentEnabled(): boolean {
  return parchmentConfig() !== null;
}

/**
 * Which variables are missing, for the Settings UI to explain itself. Returns an
 * empty array when fully configured.
 */
export function parchmentMissingVars(): string[] {
  const missing: string[] = [];
  if (!process.env.PARCHMENT_API_BASE?.trim()) missing.push("PARCHMENT_API_BASE");
  if (!process.env.PARCHMENT_API_KEY?.trim()) missing.push("PARCHMENT_API_KEY");
  return missing;
}

/** Read calls are on the chat path, so they get a short leash. */
const READ_TIMEOUT_MS = 12_000;
/** Ingestion returns a job id immediately, but the upload itself can be large. */
const WRITE_TIMEOUT_MS = 60_000;

type RequestOpts = {
  method?: "GET" | "POST";
  body?: unknown;
  formData?: FormData;
  timeoutMs?: number;
  /** Query-string parameters; undefined and null values are dropped. */
  params?: Record<string, string | number | boolean | null | undefined>;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<ParchmentResult<T>> {
  const cfg = parchmentConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        "Parchment is not configured — set PARCHMENT_API_BASE and PARCHMENT_API_KEY to connect an organisational knowledge base.",
    };
  }

  const url = new URL(`${cfg.base}${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}` };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.formData ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      signal: controller.signal,
      // Knowledge changes when someone ingests, not on a timer — and a stale
      // answer to a policy question is worse than a slow one.
      cache: "no-store",
    });

    if (!res.ok) {
      // Parchment's documented failure modes, translated into something a
      // reviewer reading George's logs can act on rather than a bare status.
      const detail = await res.text().catch(() => "");
      const known: Record<number, string> = {
        401: "Parchment rejected the API key (401). It may be revoked — reissue it from the console's Connect tab.",
        403: "Parchment key lacks the required role (403). Ingestion needs an 'editor' key; 'agent' is read-only.",
        404: "Not found in this Parchment workspace (404). Cross-workspace reads return 404 rather than 403, so check the key belongs to the right workspace.",
        413: "Content exceeds Parchment's size cap (413).",
        415: "File type not supported by Parchment ingestion (415).",
        429: "Rate limited by Parchment (429). /query allows 300/min, ingestion 120/hour.",
        503: "Parchment's ingestion queue is unavailable (503) — retry.",
      };
      return {
        ok: false,
        status: res.status,
        error: known[res.status] ?? `Parchment returned ${res.status}: ${detail.slice(0, 200)}`,
      };
    }

    // 202 from /ingest has a body; a 204 would not.
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

export const parchment = {
  /** Liveness — used by the Settings panel to show connection state. */
  health(): Promise<ParchmentResult<{ status: string; database?: string }>> {
    return request("/health", { timeoutMs: 6_000 });
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
    return request("/query", {
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
    return request(`/sections/${encodeURIComponent(sectionId)}`);
  },

  sections(args: { business_function?: string; limit?: number } = {}): Promise<
    ParchmentResult<ParchmentSection[]>
  > {
    return request("/sections", { params: { ...args } });
  },

  documents(): Promise<ParchmentResult<ParchmentDocument[]>> {
    return request("/documents");
  },

  documentStructure(sourceFile: string): Promise<ParchmentResult<unknown>> {
    return request("/documents/structure", { params: { source_file: sourceFile } });
  },

  taxonomy(): Promise<ParchmentResult<unknown>> {
    return request("/taxonomy");
  },

  objectives(): Promise<ParchmentResult<unknown>> {
    return request("/objectives");
  },

  overview(): Promise<ParchmentResult<unknown>> {
    return request("/knowledge/overview");
  },

  /**
   * Ingest markdown. Re-sending the same source_file MERGES — matching sections
   * update in place, omitted ones are kept rather than wiped. Needs an editor
   * key; an agent key gets 403.
   */
  ingest(args: { source_file: string; content: string }): Promise<ParchmentResult<ParchmentJob>> {
    return request("/ingest", { method: "POST", body: args, timeoutMs: WRITE_TIMEOUT_MS });
  },

  /** Upload a PDF/docx/xlsx/pptx/txt. Same async job flow as ingest(). */
  ingestFile(file: File | Blob, filename: string): Promise<ParchmentResult<ParchmentJob>> {
    const fd = new FormData();
    fd.append("file", file, filename);
    return request("/ingest/file", {
      method: "POST",
      formData: fd,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  /** Poll an ingestion job until status is done or failed. */
  status(jobId: string): Promise<ParchmentResult<ParchmentJob>> {
    return request(`/status/${encodeURIComponent(jobId)}`);
  },

  /** Endpoint + current tool list, per Parchment's discovery endpoint. */
  mcpInfo(): Promise<ParchmentResult<unknown>> {
    return request("/mcp-info");
  },
};

/**
 * Flatten a query result into the shape George's `search_knowledge` tool already
 * returns, so swapping the backend does not change the tool's contract with the
 * model. `hierarchy_path` is carried through deliberately: it is the provenance
 * that lets George cite where an answer came from, which chunk-based search
 * could never give it.
 */
export function toKnowledgeHits(result: ParchmentQueryResult) {
  return result.results.map((s) => ({
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
    // and it can call retrieve_section for the bodies.
    context: (s.ancestors ?? []).map((a) => a.title).join(" > ") || undefined,
  }));
}
