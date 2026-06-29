import type { NextConfig } from "next";

const deployTarget = process.env.DEPLOY_TARGET;
const isGithubPages = deployTarget === "github-pages";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath: isGithubPages ? "/careeros-ai" : "",
  assetPrefix: isGithubPages ? "/careeros-ai/" : undefined,
};

export default nextConfig;
