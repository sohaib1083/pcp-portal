import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The hosted demo (deploy/hf) ships a self-contained server; local runs keep the normal build.
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
