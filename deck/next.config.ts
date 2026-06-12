import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The deck reads crew state through the groundcrew package at request
  // time; nothing here is statically exportable.
  reactStrictMode: true,
};

export default nextConfig;
