import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the live development cache separate from production builds.
  // Running `next build` while the local preview is open must not replace
  // the CSS and route manifests currently used by the dev server.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Runtime project data is local state, not part of a deployable server bundle.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./outputs/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/projects/**/*": [
      "./prompts/**/*",
      "./resources/voice-script-cases/**/*",
      "./scripts/render/**/*",
    ],
  },
};

export default nextConfig;
