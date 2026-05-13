import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Agent SDK and its native binary package out of the server
  // bundle. The SDK uses `import.meta.url` + createRequire to find the
  // native `claude` binary at runtime — if Next inlines them, the
  // on-disk node_modules layout is gone and resolution fails with
  // "Native CLI binary for linux-x64 not found".
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/claude-agent-sdk-linux-x64",
  ],
  // The Claude Agent SDK spawns a native `claude` binary that lives in
  // @anthropic-ai/claude-agent-sdk-linux-x64/claude. Vercel's serverless
  // bundler can't follow that path (it's invoked via child_process at
  // runtime, not imported), so we tell Next to copy the binary into the
  // function output trace for every route that talks to the SDK.
  outputFileTracingIncludes: {
    "/api/chat": [
      "./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**",
    ],
    "/api/webhooks/agentmail": [
      "./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**",
    ],
    "/api/webhooks/composio": [
      "./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**",
    ],
    "/api/cron/run-jobs": [
      "./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**",
    ],
  },
};

export default nextConfig;
