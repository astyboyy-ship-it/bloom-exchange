import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  // A self-contained server for Docker and Kubernetes (deploy/).
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  images: { qualities: [75] },
  poweredByHeader: false,
};

export default config;
