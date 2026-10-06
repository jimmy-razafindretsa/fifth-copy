import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (docs/adr/0005-monorepo-workspaces.md).
  transpilePackages: ["@fifth-copy/engine", "@fifth-copy/protocol"],
  experimental: {
    serverActions: {
      // uploadAvatar accepts images up to 5 MB (ADR 0014); the default 1 MB would cut them off.
      // 6 MB leaves room for multipart overhead. Request rate is the shared limiter's job (#90).
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
