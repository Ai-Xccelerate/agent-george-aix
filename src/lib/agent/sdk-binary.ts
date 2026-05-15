import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolves the Claude Code native binary path for the Agent SDK.
 *
 * Why this is non-trivial:
 *   The SDK tries platform variants in order — on Linux that's
 *   `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl` first, then the
 *   glibc variant. pnpm installs every optionalDependency the published
 *   package declares; on a glibc host (node:24-slim, Debian) both
 *   packages exist on disk, and the SDK's `require.resolve(`<pkg>/claude`)`
 *   succeeds for the musl one. It then spawns that binary, which dies
 *   because the host's libc is glibc — and reports "native binary not
 *   found" with the wrong path.
 *
 *   We sidestep the SDK's resolution loop on Linux by picking the right
 *   variant ourselves: musl when /lib/ld-musl-* exists, glibc otherwise.
 *   On macOS / Windows we let the SDK auto-detect (single variant per
 *   platform, no ambiguity).
 */
export function resolveClaudeCodeExecutable(): string | undefined {
  if (process.platform !== "linux") return undefined;

  const arch = process.arch;
  const isMusl =
    existsSync(`/lib/ld-musl-${arch}.so.1`) ||
    existsSync("/lib/libc.musl-x86_64.so.1") ||
    existsSync("/lib/libc.musl-aarch64.so.1");

  const pkg = isMusl
    ? `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`
    : `@anthropic-ai/claude-agent-sdk-linux-${arch}`;

  // Resolve from the project root (cwd at runtime), NOT from import.meta.url.
  // After `next build`, route handlers are bundled into `.next/server/...` and
  // `createRequire(import.meta.url)` can't see top-level node_modules from
  // there. Anchoring on cwd/package.json finds /app/node_modules in prod.
  try {
    const req = createRequire(join(process.cwd(), "package.json"));
    return req.resolve(`${pkg}/claude`);
  } catch {
    // Last-ditch: probe the conventional pnpm path directly.
    const direct = join(
      process.cwd(),
      "node_modules",
      pkg,
      "claude",
    );
    if (existsSync(direct)) return direct;
    return undefined;
  }
}
