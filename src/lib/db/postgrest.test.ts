import { describe, expect, it } from "vitest";
import { parseSelect, parseOr, coerceForColumn } from "./postgrest";

/**
 * Parsing is where a shim silently returns wrong rows rather than failing, so
 * every case here is taken from a real call site in this codebase rather than
 * invented. If one of these regresses, a query quietly loses a join or a filter.
 */
describe("parseSelect", () => {
  it("splits a plain column list", () => {
    expect(parseSelect("id, name, created_at")).toEqual({
      columns: ["id", "name", "created_at"],
      embeds: [],
    });
  });

  it("keeps * as a column", () => {
    expect(parseSelect("*").columns).toEqual(["*"]);
  });

  it("does not split on commas inside an embed", () => {
    // The naive `split(",")` bug: "customers(id" / "name)" instead of one embed.
    const r = parseSelect("id, title, customers(id, name, owner_user_id)");
    expect(r.columns).toEqual(["id", "title"]);
    expect(r.embeds).toHaveLength(1);
    expect(r.embeds[0].columns).toEqual(["id", "name", "owner_user_id"]);
  });

  it("distinguishes LEFT from INNER embeds", () => {
    expect(parseSelect("id, customers(name)").embeds[0].inner).toBe(false);
    expect(parseSelect("id, customers!inner(name)").embeds[0].inner).toBe(true);
  });

  it("gives each embed a distinct alias", () => {
    const r = parseSelect("id, customers(name), knowledge_docs!inner(path)");
    expect(r.embeds.map((e) => e.alias)).toEqual(["emb0", "emb1"]);
    expect(r.embeds.map((e) => e.table)).toEqual(["customers", "knowledge_docs"]);
  });

  it("handles * alongside an embed (objectives call site)", () => {
    const r = parseSelect("*, customers!inner(id, name, owner_user_id)");
    expect(r.columns).toEqual(["*"]);
    expect(r.embeds[0].table).toBe("customers");
    expect(r.embeds[0].inner).toBe(true);
  });

  it("parses the knowledge_chunks search select verbatim", () => {
    const r = parseSelect(
      "content, ordinal, metadata, knowledge_docs!inner(path, title, org_id, is_core)",
    );
    expect(r.columns).toEqual(["content", "ordinal", "metadata"]);
    expect(r.embeds[0].columns).toEqual(["path", "title", "org_id", "is_core"]);
  });
});

describe("parseOr", () => {
  it("parses the find_customer name/domain filter", () => {
    expect(parseOr("name.ilike.acme%,domain.ilike.acme%")).toEqual([
      { col: "name", op: "ilike", value: "acme%" },
      { col: "domain", op: "ilike", value: "acme%" },
    ]);
  });

  it("keeps dots inside the value (domains, decimals)", () => {
    // Only the first two dots separate; the rest belong to the value.
    expect(parseOr("domain.eq.acme.co.uk")).toEqual([
      { col: "domain", op: "eq", value: "acme.co.uk" },
    ]);
  });

  it("parses the keyword-search terms built by search_knowledge", () => {
    const terms = ["onboarding", "kickoff"]
      .map((w) => `content.ilike.%${w}%`)
      .join(",");
    expect(parseOr(terms)).toEqual([
      { col: "content", op: "ilike", value: "%onboarding%" },
      { col: "content", op: "ilike", value: "%kickoff%" },
    ]);
  });

  it("rejects a malformed term instead of guessing", () => {
    expect(() => parseOr("justacolumn")).toThrow(/unsupported \.or\(\) term/);
  });
});

describe("coerceForColumn — json/jsonb binding", () => {
  // Regression guard for a bug that shipped silently with the shim: PostgREST
  // lets the column type decide how to parse JSON, so callers pass a JS array
  // for both `tags text[]` and `to_recipients jsonb`. node-postgres serialises a
  // JS array as a Postgres ARRAY literal, which jsonb rejects with "invalid
  // input syntax for type json". Nothing wrote an array into a jsonb column
  // until the mailbox mirror did, so it went unnoticed for weeks.
  const json = new Set(["to_recipients", "raw", "metadata"]);

  it("stringifies an array bound for a jsonb column", () => {
    expect(coerceForColumn("to_recipients", [{ email: "a@b.com" }], json)).toBe(
      '[{"email":"a@b.com"}]',
    );
  });

  it("stringifies an object bound for a jsonb column", () => {
    expect(coerceForColumn("metadata", { a: 1 }, json)).toBe('{"a":1}');
  });

  it("stringifies an EMPTY array — the exact case that broke the mirror", () => {
    expect(coerceForColumn("to_recipients", [], json)).toBe("[]");
  });

  it("leaves arrays for non-json columns alone, so text[] still works", () => {
    // `tags text[]` must keep receiving a real array or pg can't build the
    // array literal.
    const tags = ["a", "b"];
    expect(coerceForColumn("tags", tags, json)).toBe(tags);
  });

  it("does not double-encode a value the caller already stringified", () => {
    expect(coerceForColumn("raw", '{"already":"json"}', json)).toBe('{"already":"json"}');
  });

  it("maps null and undefined to null", () => {
    expect(coerceForColumn("to_recipients", null, json)).toBeNull();
    expect(coerceForColumn("to_recipients", undefined, json)).toBeNull();
  });

  it("passes scalars through untouched", () => {
    expect(coerceForColumn("subject", "hello", json)).toBe("hello");
    expect(coerceForColumn("count", 7, json)).toBe(7);
    expect(coerceForColumn("is_read", true, json)).toBe(true);
  });
});
