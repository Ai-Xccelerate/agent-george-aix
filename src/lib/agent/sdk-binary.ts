import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * Resolves the Linux-x64 `claude` binary that ships inside
 * `@anthropic-ai/claude-agent-sdk-linux-x64`. The SDK's autodetection breaks
 * on Vercel because the binary is invoked via child_process and its parent
 * directory isn't traced by the bundler. We pin it as a direct dependency
 * (see package.json), point next.config.ts at the path via
 * outputFileTracingIncludes so it's shipped, and then hand the SDK the
 * absolute path here.
 *
 * Returns undefined when we can't resolve it — let the SDK fall back to its
 * default lookup (useful for local dev on macOS where a different binary
 * package is used).
 */
export function resolveClaudeCodeExecutable(): string | undefined {
  if (process.platform !== "linux") return undefined;
  // In bundled server output (Next/Vercel), the global `require` may not
  // exist or may be a bundler shim that can't resolve external packages.
  // Build a real CommonJS require anchored at this module's URL so we hit
  // the on-disk node_modules layout we asked Next to preserve via
  // serverExternalPackages + outputFileTracingIncludes.
  const localRequire = createRequire(import.meta.url);
  try {
    const pkgJson = localRequire.resolve(
      "@anthropic-ai/claude-agent-sdk-linux-x64/package.json",
    );
    return path.join(path.dirname(pkgJson), "claude");
  } catch {
    // Last-ditch fallback for Vercel's traced layout: walk up from this
    // file looking for the binary copy that outputFileTracingIncludes
    // shipped with the function.
    try {
      let dir = path.dirname(fileURLToPath(import.meta.url));
      for (let i = 0; i < 10; i++) {
        const candidate = path.join(
          dir,
          "node_modules",
          "@anthropic-ai",
          "claude-agent-sdk-linux-x64",
          "claude",
        );
        try {
          // Synchronously test existence without pulling in fs at top.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          if (localRequire("node:fs").existsSync(candidate)) return candidate;
        } catch {}
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {}
    return undefined;
  }
}
