import { describe, expect, it } from "vitest";
import { parseSelect, parseOr } from "./postgrest";

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
