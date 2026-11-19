import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Repository scripts (scripts/launch-demo.ts, scripts/demo-two-node.ts) import the SDK's TypeScript sources and
 * run them with Node's built-in type stripping, which rejects syntax that needs a transform: parameter
 * properties, enums, namespaces. Vitest transpiles everything, so without this check such syntax passes
 * `npm test` and only breaks `npm run verify:launch`.
 */
describe("SDK sources", () => {
  it("run under Node's type stripping (scripts import them directly)", async () => {
    const { stripTypeScriptTypes } = (await import("node:module")) as { stripTypeScriptTypes?: (code: string) => string };
    if (!stripTypeScriptTypes) return; // Node < 22.13: nothing to check against
    const dir = new URL("../src/", import.meta.url);
    const files = readdirSync(dir).filter((n) => n.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(() => stripTypeScriptTypes(readFileSync(new URL(f, dir), "utf8")), f).not.toThrow();
  });
});
