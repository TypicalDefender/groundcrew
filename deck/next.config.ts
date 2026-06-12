import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The deck reads crew state through the groundcrew package at request
  // time; nothing here is statically exportable.
  reactStrictMode: true,
  // The crew package shells out and discovers config at runtime
  // (cosmiconfig, dynamic loaders, adapter discovery by directory listing) —
  // it must load from node_modules at request time, never be bundled.
  // serverExternalPackages alone doesn't survive the file:.. workspace
  // symlink, so the webpack external is forced with import semantics (the
  // package is ESM).
  serverExternalPackages: ["@clipboard-health/groundcrew"],
  webpack: (config: { externals: unknown[] }, context: { isServer: boolean }) => {
    if (context.isServer) {
      config.externals.push({
        "@clipboard-health/groundcrew": "import @clipboard-health/groundcrew",
      });
    }
    return config;
  },
};

export default nextConfig;
