/**
 * Authenticated encryption for secrets George stores on an org's behalf.
 *
 * WHY THIS EXISTS
 * The `integrations` table has a `vault_secret_id` column that assumed Supabase
 * Vault. The database is now plain Railway Postgres, so Vault is gone and there
 * is no managed place to put a credential. Storing an API key in plaintext was
 * not acceptable — a Parchment key reads an org's entire knowledge base, and
 * with an editor role writes to it — so the application encrypts it before it
 * ever reaches a row.
 *
 * AES-256-GCM, because it authenticates as well as encrypts: a tampered
 * ciphertext fails to decrypt rather than silently yielding garbage that would
 * then be sent to a third party as a bearer token.
 *
 * The key lives in APP_ENCRYPTION_KEY (32 bytes, base64). It is deliberately NOT
 * derived from anything in the database: an attacker with a database dump alone
 * cannot read the secrets, which is the entire point.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the GCM standard
const KEY_BYTES = 32;

export type SealedSecret = {
  /** base64 ciphertext */
  ct: string;
  /** base64 initialisation vector — unique per encryption, stored alongside */
  iv: string;
  /** base64 GCM auth tag */
  tag: string;
  /** Version marker, so the scheme can change without orphaning existing rows. */
  v: 1;
};

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "APP_ENCRYPTION_KEY is not set, so credentials cannot be stored securely. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" " +
        "and set it on this environment. Refusing to store a secret in plaintext.",
    );
    this.name = "MissingEncryptionKeyError";
  }
}

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) throw new MissingEncryptionKeyError();
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). ` +
        `It should be base64 of 32 random bytes.`,
    );
  }
  return buf;
}

/** True when this deployment can store secrets — checked before showing a form. */
export function canStoreSecrets(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ct: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    v: 1,
  };
}

/**
 * Returns null rather than throwing when a secret cannot be opened — a rotated
 * or mistyped APP_ENCRYPTION_KEY should surface as "reconnect this integration",
 * not as a crashed settings page.
 */
export function open(sealed: SealedSecret | null | undefined): string | null {
  if (!sealed?.ct || !sealed.iv || !sealed.tag) return null;
  try {
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * A display form that proves which key is stored without revealing it — shown in
 * the UI so an admin can tell one key from another after rotation.
 */
export function fingerprint(secret: string): string {
  if (secret.length <= 8) return "…";
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}
