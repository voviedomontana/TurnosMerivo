import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  // Local links use 127.0.0.1; Next dev defaults to trusting localhost.
  allowedDevOrigins: ["127.0.0.1"],
};
export default nextConfig;
