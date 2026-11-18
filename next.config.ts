import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK spawns the Claude Code binary, so it must be loaded by Node rather than bundled.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
