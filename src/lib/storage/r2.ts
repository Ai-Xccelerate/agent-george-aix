/**
 * Cloudflare R2 storage, shaped exactly like Supabase Storage.
 *
 * WHY IT MIMICS THE SUPABASE SURFACE
 * There are 17 storage call sites across uploads, logo management and George's
 * read_document tool, all written as `admin.storage.from(bucket).upload(...)`.
 * Rather than rewrite them, this implements the five operations they actually
 * use — upload, remove, createSignedUrl, getPublicUrl, download — against R2's
 * S3-compatible API, keeping every call site byte-identical. Same approach as
 * src/lib/db/postgrest.ts, for the same reason: the swap is provable on its own
 * and reverting is a config change, not a code change.
 *
 * THE ONE REAL DIFFERENCE FROM SUPABASE
 * Supabase has "public buckets" that serve files at a predictable URL. R2 has
 * no such concept — every bucket is private, and public reads happen only
 * through a custom domain bound to the bucket. So `getPublicUrl` is built from
 * R2_PUBLIC_BASE_URL (e.g. https://assets-staging.aiworkforce.md) rather than
 * derived from the bucket, and it is only meaningful for the assets bucket.
 * Private files use presigned URLs instead of Supabase's signed URLs.
 *
 * BUCKET NAMES ARE LOGICAL
 * Call sites say "org-assets" and "customer-docs". The real buckets are named
 * per environment (george-org-assets-staging, …-prod) so staging cannot write
 * into production's files — something the Supabase setup got wrong, because
 * both environments shared one project. The mapping lives in the env vars.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** The logical bucket names the application uses. */
export type LogicalBucket = "org-assets" | "customer-docs";

type StorageError = { message: string };
type Result<T> = { data: T | null; error: StorageError | null };

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Record<LogicalBucket, string>;
  publicBaseUrl: string;
};

const REQUIRED = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_ORG_ASSETS",
  "R2_BUCKET_CUSTOMER_DOCS",
  "R2_PUBLIC_BASE_URL",
] as const;

/**
 * Resolve the R2 configuration, or throw naming exactly what is missing.
 *
 * This throwing is the point. A storage driver that silently falls back to
 * Supabase when half-configured would write files to one backend while the
 * database recorded them as being in another — the failure would surface weeks
 * later as a missing document. Better to refuse to start. `assertStorageConfig`
 * calls this at boot so a bad deploy fails its healthcheck instead of failing
 * on somebody's first upload.
 */
export function r2Config(): R2Config {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `STORAGE_DRIVER=r2 but these variables are missing or empty: ${missing.join(", ")}. ` +
        `Refusing to start rather than writing files to the wrong backend. ` +
        `Set them on this environment, or unset STORAGE_DRIVER to keep using Supabase Storage.`,
    );
  }

  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL!.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(publicBaseUrl)) {
    throw new Error(
      `R2_PUBLIC_BASE_URL must be an https:// URL (got "${publicBaseUrl}"). ` +
        `This is the custom domain bound to the public bucket — R2 buckets have no ` +
        `public URL of their own, so a wrong value here means every logo 404s.`,
    );
  }

  return {
    accountId: process.env.R2_ACCOUNT_ID!.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    buckets: {
      "org-assets": process.env.R2_BUCKET_ORG_ASSETS!.trim(),
      "customer-docs": process.env.R2_BUCKET_CUSTOMER_DOCS!.trim(),
    },
    publicBaseUrl,
  };
}

declare global {
  var __georgeR2Client: S3Client | undefined;
}

/**
 * One S3 client per process, stashed on globalThis so Next's dev-server module
 * reloading doesn't leak a new client (and its socket pool) on every edit —
 * the same reasoning as the pg pool in src/lib/db/pool.ts.
 */
function client(cfg: R2Config): S3Client {
  if (!globalThis.__georgeR2Client) {
    globalThis.__georgeR2Client = new S3Client({
      // R2 ignores the region but the SDK requires one; "auto" is Cloudflare's
      // documented value.
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return globalThis.__georgeR2Client;
}

function resolveBucket(cfg: R2Config, logical: string): string {
  const real = cfg.buckets[logical as LogicalBucket];
  if (!real) {
    // A typo'd bucket name would otherwise create a brand-new empty bucket's
    // worth of confusion, so name the mistake instead.
    throw new Error(
      `Unknown storage bucket "${logical}". Known buckets: ${Object.keys(cfg.buckets).join(", ")}.`,
    );
  }
  return real;
}

function message(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Body types the existing call sites pass: a Node Buffer, or a web File. */
type UploadBody = Buffer | Uint8Array | File | Blob;

async function toBytes(body: UploadBody): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await (body as Blob).arrayBuffer());
}

function bucketApi(cfg: R2Config, logical: string) {
  const Bucket = resolveBucket(cfg, logical);
  const s3 = client(cfg);

  return {
    /**
     * Supabase rejects an upload to an existing key unless `upsert` is true, and
     * two call sites rely on that to avoid clobbering. S3 has no such flag, so
     * the check is explicit: HEAD first, then PUT. One extra round trip on a
     * path that already contains a uuid, which is a fair price for matching the
     * contract the callers were written against.
     */
    async upload(
      path: string,
      body: UploadBody,
      opts?: { contentType?: string; upsert?: boolean },
    ): Promise<Result<{ path: string }>> {
      try {
        if (!opts?.upsert) {
          const exists = await s3
            .send(new HeadObjectCommand({ Bucket, Key: path }))
            .then(() => true)
            .catch(() => false);
          if (exists) {
            return { data: null, error: { message: "The resource already exists" } };
          }
        }

        await s3.send(
          new PutObjectCommand({
            Bucket,
            Key: path,
            Body: await toBytes(body),
            ContentType: opts?.contentType,
          }),
        );
        return { data: { path }, error: null };
      } catch (err) {
        return { data: null, error: { message: message(err) } };
      }
    },

    /** Callers pass an array of paths and ignore the returned data. */
    async remove(paths: string[]): Promise<Result<Array<{ name: string }>>> {
      if (paths.length === 0) return { data: [], error: null };
      try {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: paths.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        return { data: paths.map((name) => ({ name })), error: null };
      } catch (err) {
        return { data: null, error: { message: message(err) } };
      }
    },

    /**
     * Presigned GET, R2's equivalent of a Supabase signed URL. Both call sites
     * pass 300 seconds; the link is what a browser is handed to download a
     * contract, so it must expire.
     */
    async createSignedUrl(
      path: string,
      expiresIn: number,
    ): Promise<Result<{ signedUrl: string }>> {
      try {
        const signedUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket, Key: path }),
          { expiresIn },
        );
        return { data: { signedUrl }, error: null };
      } catch (err) {
        return { data: null, error: { message: message(err) } };
      }
    },

    /**
     * Synchronous and errorless, matching Supabase. Only the assets bucket has a
     * public hostname, so asking for a public URL to a customer document is a
     * programming mistake rather than a runtime condition — and returning a
     * plausible-looking URL that leaks a contract path would be worse than
     * throwing.
     */
    getPublicUrl(path: string): { data: { publicUrl: string } } {
      if (logical !== "org-assets") {
        throw new Error(
          `getPublicUrl is only valid for "org-assets" (asked for "${logical}"). ` +
            `The customer-docs bucket is private by design — use createSignedUrl.`,
        );
      }
      const clean = path.replace(/^\/+/, "");
      return { data: { publicUrl: `${cfg.publicBaseUrl}/${clean}` } };
    },

    /**
     * George's read_document tool calls `.arrayBuffer()` on whatever comes back,
     * so a Blob keeps that call site unchanged.
     */
    async download(path: string): Promise<Result<Blob>> {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket, Key: path }));
        if (!res.Body) {
          return { data: null, error: { message: "Object not found" } };
        }
        const bytes = await res.Body.transformToByteArray();
        return {
          data: new Blob([bytes as Uint8Array<ArrayBuffer>], {
            type: res.ContentType ?? "application/octet-stream",
          }),
          error: null,
        };
      } catch (err) {
        // Normalise a missing key to the wording Supabase used, because
        // read_document surfaces this string straight to the agent and the
        // phrasing is what an operator will search the logs for. S3 puts the
        // discriminator in the error NAME ("NoSuchKey"), not the message
        // ("The specified key does not exist."), so check both.
        const name = err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
        const m = message(err);
        const isMissing = /NoSuchKey|NotFound/i.test(name) || /NoSuchKey|NotFound/i.test(m);
        return { data: null, error: { message: isMissing ? "Object not found" : m } };
      }
    },
  };
}

export function createR2Storage() {
  const cfg = r2Config();
  return { from: (bucket: string) => bucketApi(cfg, bucket) };
}

/** True when this deployment is configured to serve files from R2. */
export function isR2Enabled(): boolean {
  return process.env.STORAGE_DRIVER?.trim().toLowerCase() === "r2";
}

/**
 * Boot-time guard. Called from instrumentation.ts so a half-configured deploy
 * dies at startup — visible in the Railway deploy log and caught by the
 * healthcheck — instead of appearing healthy and failing on the first upload.
 */
export function assertStorageConfig(): void {
  if (!isR2Enabled()) {
    console.log("[storage] driver=supabase (set STORAGE_DRIVER=r2 to serve files from R2)");
    return;
  }
  const cfg = r2Config();
  console.log(
    `[storage] driver=r2 assets=${cfg.buckets["org-assets"]} ` +
      `docs=${cfg.buckets["customer-docs"]} public=${cfg.publicBaseUrl}`,
  );
}
