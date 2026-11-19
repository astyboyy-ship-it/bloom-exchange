import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone for self-hosting (Docker); Vercel (VERCEL=1 at build time) packages Next.js itself.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  async headers() {
    // Verification runs entirely in the browser; the only network peer is the configured relay.
    const relay = process.env.NEXT_PUBLIC_BLOOM_RELAY_URL ?? "https://bloom-exchange-relay.vercel.app";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${relay}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default config;
