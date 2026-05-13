import path from "node:path";
import { fileURLToPath } from "node:url";

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
  try {
    const pkgJson = require.resolve(
      "@anthropic-ai/claude-agent-sdk-linux-x64/package.json",
    );
    const dir =
      typeof pkgJson === "string"
        ? path.dirname(pkgJson)
        : path.dirname(fileURLToPath(pkgJson));
    return path.join(dir, "claude");
  } catch {
    return undefined;
  }
}
