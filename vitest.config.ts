import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Workspace packages resolve to source, so tests never depend on a prior build.
      { find: /^@bloom-exchange\/sdk$/, replacement: at("./packages/sdk/src/index.ts") },
      { find: /^@bloom-exchange\/schemas$/, replacement: at("./packages/schemas/src/index.ts") },
      { find: /^@bloom-exchange\/core$/, replacement: at("./packages/core/src/index.ts") },
      { find: /^@bloom-exchange\/core\/events$/, replacement: at("./packages/core/src/events/index.ts") },
      { find: /^@bloom-exchange\/core\/(.*)$/, replacement: `${at("./packages/core/src")}/$1.ts` },
      // The desk's own "@/..." imports.
      { find: /^@\//, replacement: `${at("./apps/node/src")}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    // Fully offline: memory store, deterministic simulation, no webhooks or model keys.
    setupFiles: ["./packages/core/test/setup.ts"],
    testTimeout: 20_000,
  },
});
