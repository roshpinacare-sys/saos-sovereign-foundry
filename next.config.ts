import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  // Next 16 dev-origin protection: the default allowlist covers "localhost"
  // only — the sandbox browser/preview hit the app via 127.0.0.1 and the
  // gateway, so /_next/hmr was blocked and the dev runtime silently stalled
  // before hydration (page froze on the SSR shell). Allowlist every host the
  // owner actually uses (dev-only flag, no production effect).
  allowedDevOrigins: ["localhost", "127.0.0.1", "0.0.0.0", "::1", "*.z.ai", "*.zai"]
  // Task 19: instrumentation (guardian supervisor) enabled by default in Next 16
};

export default nextConfig;
