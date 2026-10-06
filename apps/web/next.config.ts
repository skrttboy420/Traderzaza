import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The @atc packages ship TypeScript source, so Next compiles them in place.
  transpilePackages: [
    "@atc/types",
    "@atc/engine",
    "@atc/market-data",
    "@atc/ai",
    "@atc/news",
  ],
  typedRoutes: false,
};

export default nextConfig;
