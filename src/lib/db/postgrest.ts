/**
 * A PostgREST-compatible query builder over the `pg` driver.
 *
 * WHY THIS EXISTS
 * Every database call in George is written in supabase-js chain style —
 * `db.from("customers").select("*").eq("org_id", id).maybeSingle()` — across 372
 * call sites. That syntax is not SQL; it is an HTTP request to PostgREST, which
 * Supabase hosts and plain Postgres does not have. Rather than rewrite all 372
 * at once (weeks of churn touching every feature), this reimplements the slice
 * of that interface the codebase actually uses, backed by real SQL. Call sites
 * stay byte-identical, so the database move is provable in isolation.
 *
 * It is deliberately NOT a general PostgREST implementation. The supported
 * surface was derived by grepping every call site; anything outside it throws a
 * loud, specific error rather than silently returning wrong rows. That choice
 * matters more than completeness — a shim that quietly drops a filter is worse
 * than one that refuses to run.
 *
 * SUPPORTED (audited against the codebase)
 *   filters      eq neq gt gte lt lte ilike in is not or
 *   modifiers    order limit
 *   terminators  await, single, maybeSingle, {count:"exact", head:true}
 *   writes       insert update upsert(onConflict, ignoreDuplicates) delete
 *                each optionally followed by .select()
 *   embeds       single-level many-to-one, e.g. "customers(name)" (LEFT) and
 *                "customers!inner(org_id)" (INNER), including filters on the
 *                embedded table ("customers.org_id")
 *   rpc          named-argument function calls
 *
 * CONTRACT
 * supabase-js resolves rather than rejects: every call returns
 * `{ data, error }`, and `error.code` carries the Postgres SQLSTATE. Six call
 * sites branch on `"23505"` (unique violation) — notably the webhook dedupe and
 * the atomic event claim — so preserving that shape is load-bearing, not
 * cosmetic.
 */
import { query } from "./pool";

// ── types ───────────────────────────────────────────────────────────────────

export type PostgrestError = {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
};

export type PostgrestResult<T> = {
  data: T | null;
  error: PostgrestError | null;
  count?: number | null;
};

type Filter =
  | { kind: "cmp"; col: string; op: string; value: unknown }
  | { kind: "in"; col: string; values: unknown[] }
  | { kind: "null"; col: string; negated: boolean }
  | { kind: "or"; parts: Array<{ col: string; op: string; value: unknown }> };

type Embed = {
  table: string;
  alias: string;
  columns: string[];
  inner: boolean;
};

type Operation = "select" | "insert" | "update" | "upsert" | "delete";

// ── identifier + error helpers ──────────────────────────────────────────────

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`unsafe SQL identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

function toPostgrestError(err: unknown): PostgrestError {
  const e = err as { message?: string; code?: string; detail?: string; hint?: string };
  return {
    message: e?.message ?? String(err),
    code: e?.code ?? null,
    details: e?.detail ?? null,
    hint: e?.hint ?? null,
  };
}

/**
 * Which column joins a base table to an embedded one. PostgREST infers this
 * from the foreign key; we read the same catalog, once per process.
 *
 * Only many-to-one is supported (base table holds the FK), which is every embed
 * in this codebase. One-to-many would need json_agg and would change the shape
 * of the returned value from object to array, so it throws instead of guessing.
 */
let fkCache: Map<string, { localCol: string; foreignCol: string }> | null = null;

async function loadForeignKeys() {
  if (fkCache) return fkCache;
  const { rows } = await query<{
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }>(`
    select
      tc.table_name,
      kcu.column_name,
      ccu.table_name  as foreign_table_name,
      ccu.column_name as foreign_column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema    = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema    = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema    = 'public'
  `);
  const map = new Map<string, { localCol: string; foreignCol: string }>();
  for (const r of rows) {
    map.set(`${r.table_name}->${r.foreign_table_name}`, {
      localCol: r.column_name,
      foreignCol: r.foreign_column_name,
    });
  }
  fkCache = map;
  return map;
}

// ── select-string parsing ───────────────────────────────────────────────────

/**
 * Splits a PostgREST select string into plain columns and embedded resources.
 * Commas inside parentheses belong to the embed, not the outer list.
 */
export function parseSelect(spec: string): { columns: string[]; embeds: Embed[] } {
  const columns: string[] = [];
  const embeds: Embed[] = [];

  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of spec) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);

  let embedIndex = 0;
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    // [\s\S] rather than . with the /s flag — tsconfig targets below ES2018,
    // where dotAll is a compile error.
    const m = part.match(/^([A-Za-z_][A-Za-z0-9_]*)(!inner)?\s*\(([\s\S]*)\)$/);
    if (m) {
      embeds.push({
        table: m[1],
        alias: `emb${embedIndex++}`,
        inner: Boolean(m[2]),
        columns: m[3].split(",").map((c) => c.trim()).filter(Boolean),
      });
    } else {
      columns.push(part);
    }
  }
  return { columns, embeds };
}

/**
 * Parses `.or("a.ilike.%x%,b.eq.1")` — PostgREST's inline filter grammar.
 * Values may contain dots (a domain, a decimal), so only the first two dots
 * are separators.
 */
export function parseOr(expr: string): Array<{ col: string; op: string; value: unknown }> {
  const out: Array<{ col: string; op: string; value: unknown }> = [];
  let depth = 0;
  let buf = "";
  const flush = () => {
    const s = buf.trim();
    buf = "";
    if (!s) return;
    const first = s.indexOf(".");
    const second = s.indexOf(".", first + 1);
    if (first < 0 || second < 0) {
      throw new Error(`unsupported .or() term: ${JSON.stringify(s)}`);
    }
    out.push({
      col: s.slice(0, first),
      op: s.slice(first + 1, second),
      value: s.slice(second + 1),
    });
  };
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

const OPS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  ilike: "ILIKE",
};

// ── the builder ─────────────────────────────────────────────────────────────

class QueryBuilder<T = Record<string, unknown>> implements PromiseLike<PostgrestResult<T>> {
  private op: Operation = "select";
  private selectSpec: string | null = null;
  private filters: Filter[] = [];
  private orders: Array<{ col: string; asc: boolean; nullsFirst?: boolean }> = [];
  private limitN: number | null = null;
  private payload: Record<string, unknown>[] = [];
  private conflictTarget: string | null = null;
  private ignoreDuplicates = false;
  private rowMode: "many" | "single" | "maybe" = "many";
  private wantCount = false;
  private headOnly = false;
  /**
   * supabase-js resolves rather than rejects — always. A builder method that
   * threw synchronously would escape that contract and surface as an unhandled
   * rejection in a request handler instead of the `{ data, error }` every call
   * site already checks. So validation failures are recorded here and returned
   * at execution time.
   */
  private deferredError: PostgrestError | null = null;

  constructor(private table: string) {}

  select(spec = "*", opts?: { count?: string; head?: boolean }) {
    this.selectSpec = spec;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(values: Record<string, unknown>) {
    this.op = "update";
    this.payload = [values];
    return this;
  }

  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflictTarget = opts?.onConflict ?? null;
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(col: string, value: unknown) { return this.cmp(col, "eq", value); }
  neq(col: string, value: unknown) { return this.cmp(col, "neq", value); }
  gt(col: string, value: unknown) { return this.cmp(col, "gt", value); }
  gte(col: string, value: unknown) { return this.cmp(col, "gte", value); }
  lt(col: string, value: unknown) { return this.cmp(col, "lt", value); }
  lte(col: string, value: unknown) { return this.cmp(col, "lte", value); }
  like(col: string, value: unknown) { return this.cmp(col, "like", value); }
  ilike(col: string, value: unknown) { return this.cmp(col, "ilike", value); }

  in(col: string, values: unknown[]) {
    this.filters.push({ kind: "in", col, values });
    return this;
  }

  is(col: string, value: null | boolean) {
    if (value === null) {
      this.filters.push({ kind: "null", col, negated: false });
      return this;
    }
    return this.cmp(col, "eq", value);
  }

  /** Only `.not(col, "is", null)` appears in this codebase. */
  not(col: string, op: string, value: unknown) {
    if (op === "is" && value === null) {
      this.filters.push({ kind: "null", col, negated: true });
      return this;
    }
    return this.defer(
      `shim: unsupported .not("${col}", "${op}", ...) — only .not(col, "is", null) is implemented`,
    );
  }

  or(expr: string) {
    try {
      this.filters.push({ kind: "or", parts: parseOr(expr) });
    } catch (err) {
      return this.defer((err as Error).message);
    }
    return this;
  }

  private defer(message: string) {
    this.deferredError ??= {
      message,
      code: "SHIM_UNSUPPORTED",
      details: null,
      hint: "Rewrite this call site as SQL, or extend src/lib/db/postgrest.ts.",
    };
    return this;
  }

  /**
   * `nullsFirst` is not cosmetic here. Postgres defaults DESC to NULLS FIRST,
   * so `.order("signed_at", { ascending: false, nullsFirst: false })` — used for
   * latest-contract, latest-email and latest-transcript lookups — would
   * otherwise surface an unsigned/undated row as the newest one.
   */
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({
      col,
      asc: opts?.ascending !== false,
      nullsFirst: opts?.nullsFirst,
    });
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  single() {
    this.rowMode = "single";
    return this;
  }

  maybeSingle() {
    this.rowMode = "maybe";
    return this;
  }

  private cmp(col: string, op: string, value: unknown) {
    this.filters.push({ kind: "cmp", col, op, value });
    return this;
  }

  // ── SQL construction ──────────────────────────────────────────────────────

  /** Resolves "customers.org_id" against embed aliases, else the base table. */
  private qualify(col: string, embeds: Embed[]): string {
    if (col.includes(".")) {
      const [tbl, c] = col.split(".", 2);
      const emb = embeds.find((e) => e.table === tbl);
      if (!emb) {
        throw new Error(
          `shim: filter on "${col}" but "${tbl}" is not embedded in this select`,
        );
      }
      return `${ident(emb.alias)}.${ident(c)}`;
    }
    return `${ident("base")}.${ident(col)}`;
  }

  private buildWhere(embeds: Embed[], params: unknown[]): string {
    const clauses: string[] = [];
    for (const f of this.filters) {
      if (f.kind === "cmp") {
        const sqlOp = OPS[f.op];
        if (!sqlOp) throw new Error(`shim: unsupported operator "${f.op}"`);
        params.push(f.value);
        clauses.push(`${this.qualify(f.col, embeds)} ${sqlOp} $${params.length}`);
      } else if (f.kind === "in") {
        params.push(f.values);
        clauses.push(`${this.qualify(f.col, embeds)} = ANY($${params.length})`);
      } else if (f.kind === "null") {
        clauses.push(
          `${this.qualify(f.col, embeds)} IS ${f.negated ? "NOT " : ""}NULL`,
        );
      } else {
        const ors = f.parts.map((p) => {
          const sqlOp = OPS[p.op];
          if (!sqlOp) throw new Error(`shim: unsupported .or() operator "${p.op}"`);
          params.push(p.value);
          return `${this.qualify(p.col, embeds)} ${sqlOp} $${params.length}`;
        });
        clauses.push(`(${ors.join(" OR ")})`);
      }
    }
    return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  }

  private async buildSelectSql(): Promise<{ text: string; values: unknown[] }> {
    const spec = this.selectSpec ?? "*";
    const { columns, embeds } = parseSelect(spec);
    const params: unknown[] = [];

    // Embeds resolve through the foreign key, and its DIRECTION decides both the
    // SQL and the shape PostgREST returns:
    //   base holds the FK  -> many-to-one -> JOIN, value is an object
    //   child holds the FK -> one-to-many -> aggregated subquery, value is an array
    // Getting this wrong is not a crash, it is wrong data: joining a one-to-many
    // would multiply the base rows and hand back an object where callers index
    // an array (onboarding_plans -> onboarding_steps does exactly this).
    let joins = "";
    const toManyProjections: string[] = [];
    if (embeds.length) {
      const fks = await loadForeignKeys();
      for (const e of embeds) {
        const toOne = fks.get(`${this.table}->${e.table}`);
        if (toOne) {
          joins +=
            ` ${e.inner ? "INNER" : "LEFT"} JOIN ${ident(e.table)} ${ident(e.alias)}` +
            ` ON ${ident(e.alias)}.${ident(toOne.foreignCol)} = ${ident("base")}.${ident(toOne.localCol)}`;
          continue;
        }

        const toMany = fks.get(`${e.table}->${this.table}`);
        if (!toMany) {
          throw new Error(
            `shim: cannot embed "${e.table}" in "${this.table}" — no foreign key ` +
              `between them in either direction`,
          );
        }

        // coalesce so an empty child set yields [] like PostgREST, not null.
        const inner =
          e.columns.length === 1 && e.columns[0] === "*"
            ? `to_jsonb(${ident(e.alias)})`
            : `json_build_object(${e.columns
                .map((c) => `'${c}', ${ident(e.alias)}.${ident(c)}`)
                .join(", ")})`;
        toManyProjections.push(
          `(SELECT coalesce(json_agg(${inner}), '[]'::json) FROM ${ident(e.table)} ${ident(e.alias)}` +
            ` WHERE ${ident(e.alias)}.${ident(toMany.localCol)} = ${ident("base")}.${ident(toMany.foreignCol)})` +
            ` AS ${ident(e.table)}`,
        );
      }
    }

    const projection: string[] = [];
    if (this.headOnly) {
      projection.push("1");
    } else {
      for (const c of columns) {
        projection.push(c === "*" ? `${ident("base")}.*` : `${ident("base")}.${ident(c)}`);
      }
      // Only many-to-one embeds project from the join; one-to-many ones were
      // already built as aggregated subqueries above.
      for (const e of embeds) {
        if (!joins.includes(`${ident(e.alias)}`)) continue;
        const pairs = e.columns
          .map((c) => `'${c}', ${ident(e.alias)}.${ident(c)}`)
          .join(", ");
        projection.push(`json_build_object(${pairs}) AS ${ident(e.table)}`);
      }
      projection.push(...toManyProjections);
      if (!projection.length) projection.push(`${ident("base")}.*`);
    }

    const where = this.buildWhere(embeds, params);

    if (this.wantCount && this.headOnly) {
      return {
        text: `SELECT count(*)::int AS "__count" FROM ${ident(this.table)} ${ident("base")}${joins}${where}`,
        values: params,
      };
    }

    const orderBy = this.orders.length
      ? ` ORDER BY ${this.orders
          .map((o) => {
            const dir = o.asc ? "ASC" : "DESC";
            const nulls =
              o.nullsFirst === undefined
                ? ""
                : o.nullsFirst
                  ? " NULLS FIRST"
                  : " NULLS LAST";
            return `${this.qualify(o.col, embeds)} ${dir}${nulls}`;
          })
          .join(", ")}`
      : "";
    const limit = this.limitN !== null ? ` LIMIT ${Number(this.limitN)}` : "";

    return {
      text: `SELECT ${projection.join(", ")} FROM ${ident(this.table)} ${ident("base")}${joins}${where}${orderBy}${limit}`,
      values: params,
    };
  }

  private buildWriteSql(): { text: string; values: unknown[] } {
    const params: unknown[] = [];
    const returning = this.selectSpec
      ? ` RETURNING ${
          this.selectSpec === "*"
            ? "*"
            : parseSelect(this.selectSpec).columns.map((c) => ident(c)).join(", ")
        }`
      : "";

    if (this.op === "insert" || this.op === "upsert") {
      const cols = Array.from(
        this.payload.reduce<Set<string>>((set, row) => {
          Object.keys(row).forEach((k) => set.add(k));
          return set;
        }, new Set()),
      );
      const tuples = this.payload.map(
        (row) =>
          `(${cols
            .map((c) => {
              params.push(row[c] ?? null);
              return `$${params.length}`;
            })
            .join(", ")})`,
      );

      let conflict = "";
      if (this.op === "upsert") {
        const target = this.conflictTarget
          ? `(${this.conflictTarget.split(",").map((c) => ident(c.trim())).join(", ")})`
          : "";
        if (this.ignoreDuplicates) {
          conflict = ` ON CONFLICT ${target} DO NOTHING`;
        } else {
          const updates = cols
            .filter((c) => !(this.conflictTarget ?? "").split(",").map((x) => x.trim()).includes(c))
            .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`)
            .join(", ");
          conflict = updates
            ? ` ON CONFLICT ${target} DO UPDATE SET ${updates}`
            : ` ON CONFLICT ${target} DO NOTHING`;
        }
      }

      return {
        text:
          `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(", ")}) ` +
          `VALUES ${tuples.join(", ")}${conflict}${returning}`,
        values: params,
      };
    }

    if (this.op === "update") {
      const values = this.payload[0] ?? {};
      const sets = Object.keys(values)
        .map((c) => {
          params.push(values[c] ?? null);
          return `${ident(c)} = $${params.length}`;
        })
        .join(", ");
      // Writes never carry embeds, so filters resolve against the base table.
      const where = this.buildWhereFlat(params);
      return {
        text: `UPDATE ${ident(this.table)} SET ${sets}${where}${returning}`,
        values: params,
      };
    }

    const where = this.buildWhereFlat(params);
    return {
      text: `DELETE FROM ${ident(this.table)}${where}${returning}`,
      values: params,
    };
  }

  /** WHERE for write statements — no aliases, so columns are bare. */
  private buildWhereFlat(params: unknown[]): string {
    const clauses: string[] = [];
    for (const f of this.filters) {
      if (f.kind === "cmp") {
        const sqlOp = OPS[f.op];
        if (!sqlOp) throw new Error(`shim: unsupported operator "${f.op}"`);
        params.push(f.value);
        clauses.push(`${ident(f.col)} ${sqlOp} $${params.length}`);
      } else if (f.kind === "in") {
        params.push(f.values);
        clauses.push(`${ident(f.col)} = ANY($${params.length})`);
      } else if (f.kind === "null") {
        clauses.push(`${ident(f.col)} IS ${f.negated ? "NOT " : ""}NULL`);
      } else {
        const ors = f.parts.map((p) => {
          const sqlOp = OPS[p.op];
          if (!sqlOp) throw new Error(`shim: unsupported .or() operator "${p.op}"`);
          params.push(p.value);
          return `${ident(p.col)} ${sqlOp} $${params.length}`;
        });
        clauses.push(`(${ors.join(" OR ")})`);
      }
    }
    return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  }

  // ── execution ─────────────────────────────────────────────────────────────

  private async run(): Promise<PostgrestResult<T>> {
    if (this.deferredError) return { data: null, error: this.deferredError };
    try {
      const { text, values } =
        this.op === "select" ? await this.buildSelectSql() : this.buildWriteSql();
      const { rows } = await query<Record<string, unknown>>(text, values);

      if (this.wantCount && this.headOnly) {
        return { data: [] as unknown as T, error: null, count: Number(rows[0]?.__count ?? 0) };
      }

      // A write with no .select() resolves to null data, matching supabase-js.
      if (this.op !== "select" && !this.selectSpec) {
        return { data: null, error: null };
      }

      if (this.rowMode === "single") {
        if (rows.length !== 1) {
          return {
            data: null,
            error: {
              message:
                rows.length === 0
                  ? "JSON object requested, multiple (or no) rows returned"
                  : `expected exactly 1 row, got ${rows.length}`,
              code: "PGRST116",
              details: null,
              hint: null,
            },
          };
        }
        return { data: rows[0] as T, error: null };
      }

      if (this.rowMode === "maybe") {
        if (rows.length > 1) {
          return {
            data: null,
            error: {
              message: `expected at most 1 row, got ${rows.length}`,
              code: "PGRST116",
              details: null,
              hint: null,
            },
          };
        }
        return { data: (rows[0] ?? null) as T, error: null };
      }

      return { data: rows as unknown as T, error: null };
    } catch (err) {
      return { data: null, error: toPostgrestError(err) };
    }
  }

  then<R1 = PostgrestResult<T>, R2 = never>(
    onfulfilled?: ((v: PostgrestResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

// ── client ──────────────────────────────────────────────────────────────────

export function createPostgrestClient() {
  return {
    from<T = Record<string, unknown>>(table: string) {
      return new QueryBuilder<T>(table);
    },

    /**
     * Named-argument function call, matching PostgREST's rpc semantics.
     * `match_knowledge_chunks` passes its embedding as a "[1,2,3]" string and
     * relies on Postgres inferring the vector type from the parameter position —
     * node-postgres sends untyped parameters, so that inference still happens.
     */
    async rpc<T = Record<string, unknown>>(
      fn: string,
      args: Record<string, unknown> = {},
    ): Promise<PostgrestResult<T[]>> {
      try {
        const keys = Object.keys(args);
        const values = keys.map((k) => args[k]);
        const named = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ");
        const { rows } = await query<Record<string, unknown>>(
          `SELECT * FROM ${ident(fn)}(${named})`,
          values,
        );
        return { data: rows as T[], error: null };
      } catch (err) {
        return { data: null, error: toPostgrestError(err) };
      }
    },
  };
}

export type PostgrestClient = ReturnType<typeof createPostgrestClient>;
