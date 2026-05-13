import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
