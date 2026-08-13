/**
 * Credential encryption.
 *
 * These tests exist because the failure modes are silent: a scheme that "works"
 * but stores something recoverable, or one that returns garbage instead of
 * refusing when the key is wrong, would both look fine in the UI while leaking
 * or corrupting an API key that reads an org's whole knowledge base.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { canStoreSecrets, fingerprint, open, seal } from "./secret-box";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  if (saved === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = saved;
});

describe("seal / open", () => {
  it("round-trips a secret", () => {
    const secret = "pcm_live_abcdef1234567890";
    expect(open(seal(secret))).toBe(secret);
  });

  it("never stores the plaintext in the sealed payload", () => {
    const secret = "pcm_live_abcdef1234567890";
    const sealed = seal(secret);
    const serialised = JSON.stringify(sealed);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain("abcdef");
  });

  it("produces a different ciphertext each time, so repeats are not detectable", () => {
    const a = seal("same-secret");
    const b = seal("same-secret");
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    // Both still open to the same value.
    expect(open(a)).toBe(open(b));
  });

  it("refuses to open with a different key rather than returning garbage", () => {
    const sealed = seal("pcm_live_secret");
    process.env.APP_ENCRYPTION_KEY = KEY_B;
    // Returning null is what makes the UI say "reconnect", instead of George
    // sending a corrupted string to Parchment as a bearer token.
    expect(open(sealed)).toBeNull();
  });

  it("detects tampering (GCM auth tag)", () => {
    const sealed = seal("pcm_live_secret");
    const flipped = Buffer.from(sealed.ct, "base64");
    flipped[0] ^= 0xff;
    expect(open({ ...sealed, ct: flipped.toString("base64") })).toBeNull();
  });

  it("returns null for missing or malformed input instead of throwing", () => {
    expect(open(null)).toBeNull();
    expect(open(undefined)).toBeNull();
    expect(open({ ct: "", iv: "", tag: "", v: 1 })).toBeNull();
  });
});

describe("key configuration", () => {
  it("refuses to encrypt at all when no key is set", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(canStoreSecrets()).toBe(false);
    // Refusing is the point: the alternative is a plaintext credential in a row.
    expect(() => seal("x")).toThrow(/APP_ENCRYPTION_KEY is not set/);
  });

  it("rejects a key of the wrong length", () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(canStoreSecrets()).toBe(false);
    expect(() => seal("x")).toThrow(/32 bytes/);
  });
});

describe("fingerprint", () => {
  it("identifies a key without revealing it", () => {
    const fp = fingerprint("pcm_live_abcdef1234567890wxyz");
    expect(fp).toBe("pcm_li…wxyz");
    expect(fp).not.toContain("abcdef");
  });

  it("does not leak a short secret", () => {
    expect(fingerprint("short")).toBe("…");
  });
});
