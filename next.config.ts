import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: "./src/shims/canvas.ts",
    },
  },
  webpack: (config) => {
    config.resolve.alias.canvas = "./src/shims/canvas.ts";
    return config;
  },
};

export default nextConfig;
