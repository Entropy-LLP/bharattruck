import type { NextConfig } from "next";

const proxyTarget = process.env.API_PROXY_TARGET;

const nextConfig: NextConfig = {
  output: "standalone",
  // Local dev only: same-origin proxy to the deployed gateway so the prod CORS
  // allowlist (which only knows the *.run.app origins) never applies. Inert in
  // the Docker/prod build, where API_PROXY_TARGET is unset.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    if (!proxyTarget) return [];
    return [{ source: "/api/:path(.*)", destination: `${proxyTarget}/api/:path` }];
  },
};

export default nextConfig;
