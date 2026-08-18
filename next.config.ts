import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the live development cache separate from production builds.
  // Running `next build` while the local preview is open must not replace
  // the CSS and route manifests currently used by the dev server.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default nextConfig;
