import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  // Task 19: instrumentation (guardian supervisor) enabled by default in Next 16
};

export default nextConfig;
