import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is reached over Tailscale at `mill-dev:4000`, not localhost. Next refuses its
  // dev endpoints, the HMR socket included, for an origin not listed here, which breaks hot reload
  // and hydration. Dev only; the production build is unaffected.
  allowedDevOrigins: ["mill-dev"],
  // Lets the bundler resolve the core's NodeNext `.js` specifiers to their `.ts` sources, so the
  // app imports the core through @core/* with no compile step. This is a webpack feature, which is
  // why dev and build run with --webpack: Turbopack fails on `@core/money.js` (DEC-012).
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    },
  },
};

export default nextConfig;
