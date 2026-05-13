/**
 * Returns an explicit path to the Claude Code binary for the Agent SDK,
 * or undefined to let the SDK auto-detect.
 *
 * On Railway / any container host with a real on-disk node_modules layout,
 * the SDK's own createRequire-based lookup of `@anthropic-ai/claude-agent-sdk-<platform>`
 * works fine — we don't need to override anything. We keep this helper as
 * a no-op shim so call sites at src/app/api/chat/route.ts and
 * src/lib/agent/run-autonomous.ts don't have to change.
 */
export function resolveClaudeCodeExecutable(): string | undefined {
  return undefined;
}
