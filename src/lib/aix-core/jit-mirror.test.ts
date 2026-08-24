/**
 * The org name written by the JIT mirror.
 *
 * Two bugs in sequence, and the second was mine:
 *
 *  1. It wrote the Clerk SLUG with ignoreDuplicates, pinning it at first login.
 *     A rename in Core never propagated, so George showed
 *     "amit-s-organization-1777976704412504541" where Core showed "AIX Staging".
 *     Not cosmetic — the org name feeds the email signature.
 *
 *  2. Dropping ignoreDuplicates so it could refresh meant every login rewrites
 *     the name, so ONE failed Clerk lookup falls back to the slug and downgrades
 *     a good name back to the machine string.
 *
 * The rule these tests hold: a rename propagates, a network hiccup renames
 * nothing.
 */
import { describe, expect, it } from "vitest";
import { ensureTenantRows } from "./jit-mirror";

const CLERK_ORG = "org_3DIjvbx3PNf8JBQURIjnDxxULrY";
const ORG_UUID = "b716e8dd-db8f-4f68-9ff2-f4babda9ddd2";

type Call = { op: string; payload: Record<string, unknown> };

/** Records what the mirror writes, and serves the row back. */
function fakeAdmin(existingName: string) {
  const calls: Call[] = [];
  let name = existingName;

  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        upsert: async (payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
          calls.push({ op: `${table}.upsert`, payload: { ...payload, ...opts } });
          // ignoreDuplicates: an existing row is left alone.
          if (table === "orgs" && !opts?.ignoreDuplicates) name = String(payload.name);
          return { error: null };
        },
        update: (payload: Record<string, unknown>) => {
          calls.push({ op: `${table}.update`, payload });
          const u: Record<string, unknown> = {
            eq: () => u,
            neq: async () => {
              if (table === "orgs") name = String(payload.name);
              return { error: null };
            },
          };
          return u;
        },
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { id: ORG_UUID, name }, error: null }),
        maybeSingle: async () => ({ data: { id: ORG_UUID, name }, error: null }),
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { admin, calls, nameNow: () => name };
}

const base = {
  clerkUserId: "user_1",
  clerkOrgId: CLERK_ORG,
  orgRole: "admin",
  orgSlug: "amit-s-organization-1777976704412504541",
  email: "vidhi@aixccelerate.com",
  fullName: "Vidhi Mishra",
};

describe("a rename in Core propagates", () => {
  it("updates the stored name when Clerk gives one", async () => {
    const { admin, nameNow } = fakeAdmin("amit-s-organization-1777976704412504541");
    await ensureTenantRows(admin, { ...base, clerkOrgName: "AIX Staging" });
    expect(nameNow()).toBe("AIX Staging");
  });

  it("issues the rename as an update, not as part of the upsert", async () => {
    // The upsert must stay ignoreDuplicates, or the fallback path overwrites.
    const { admin, calls } = fakeAdmin("Old Name");
    await ensureTenantRows(admin, { ...base, clerkOrgName: "AIX Staging" });

    const upsert = calls.find((c) => c.op === "orgs.upsert");
    expect(upsert?.payload.ignoreDuplicates).toBe(true);
    expect(calls.some((c) => c.op === "orgs.update")).toBe(true);
  });
});

describe("a failed Clerk lookup renames nothing", () => {
  it("leaves a good name alone when the org name could not be read", async () => {
    // The regression: clerkOrgName undefined -> falls back to the slug -> a
    // transient failure downgrades "AIX Staging" to the machine string.
    const { admin, nameNow, calls } = fakeAdmin("AIX Staging");
    await ensureTenantRows(admin, { ...base, clerkOrgName: null });

    expect(nameNow()).toBe("AIX Staging");
    expect(calls.some((c) => c.op === "orgs.update")).toBe(false);
  });

  it("still creates a row on first login, using the slug", async () => {
    // A new org with no Clerk name is better off with the slug than with nothing.
    const { admin, calls } = fakeAdmin("");
    await ensureTenantRows(admin, { ...base, clerkOrgName: null });

    const upsert = calls.find((c) => c.op === "orgs.upsert");
    expect(upsert?.payload.name).toBe(base.orgSlug);
  });

  it("falls back to the Clerk org id when there is no slug either", async () => {
    const { admin, calls } = fakeAdmin("");
    await ensureTenantRows(admin, { ...base, orgSlug: null, clerkOrgName: null });

    const upsert = calls.find((c) => c.op === "orgs.upsert");
    expect(upsert?.payload.name).toBe(CLERK_ORG);
  });
});
