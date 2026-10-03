import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (docs/adr/0005-monorepo-workspaces.md).
  transpilePackages: ["@fifth-copy/engine", "@fifth-copy/protocol"],
};

export default nextConfig;
