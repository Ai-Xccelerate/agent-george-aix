/**
 * Paragraph-aware chunking shared by the sync-knowledge script and the
 * Settings → Knowledge editor.
 *
 * - `extractTitle` reads the first H1 from markdown.
 * - `chunkMarkdown` accumulates blocks separated by blank lines until the
 *   current chunk hits the target size, then carries the trailing `overlap`
 *   characters into the next chunk for context continuity.
 */
export const CHUNK_TARGET = 800;
export const CHUNK_OVERLAP = 120;

export function extractTitle(md: string): string | null {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m?.[1] ?? null;
}

export function chunkMarkdown(
  content: string,
  target = CHUNK_TARGET,
  overlap = CHUNK_OVERLAP,
): string[] {
  const blocks = content
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const block of blocks) {
    if (buf.length + block.length + 2 <= target || buf.length === 0) {
      buf = buf ? `${buf}\n\n${block}` : block;
    } else {
      out.push(buf);
      const tail = buf.slice(Math.max(0, buf.length - overlap));
      buf = `${tail}\n\n${block}`;
    }
  }
  if (buf) out.push(buf);
  return out;
}
