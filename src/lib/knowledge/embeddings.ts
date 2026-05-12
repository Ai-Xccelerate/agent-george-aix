/**
 * OpenAI embeddings for the knowledge pipeline.
 *
 * Model: text-embedding-3-small (1536-dim) — matches the `vector(1536)`
 * column on `knowledge_chunks.embedding`. Used at sync time to embed each
 * chunk, and at search time to embed the query string.
 *
 * The OpenAI client is lazy-initialised so that code paths that never call
 * an embedding function (e.g. an ilike-fallback search) don't require the
 * key to be set. `hasEmbeddingProvider()` lets callers branch.
 */
import OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

let cached: OpenAI | null = null;

function getClient(): OpenAI {
  if (cached) return cached;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local to enable vector embeddings.",
    );
  }
  cached = new OpenAI({ apiKey: key });
  return cached;
}

export function hasEmbeddingProvider(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return res.data[0].embedding;
}

/**
 * Batch-embed up to ~2048 inputs per request (OpenAI's documented limit).
 * Splits larger batches automatically. Returns embeddings in input order.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const BATCH = 128;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: slice,
    });
    res.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach((d) => out.push(d.embedding));
  }
  return out;
}
