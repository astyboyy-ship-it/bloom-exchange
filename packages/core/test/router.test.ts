import { describe, expect, it } from "vitest";
import { handle } from "../src/http/router";

const at = (path: string, init?: RequestInit) => handle(new Request(`http://localhost:3000${path}`, init));

describe("framework-agnostic router", () => {
  it("serves the signed Agent Card and status at the same paths as a Next.js node", async () => {
    const card = await at("/.well-known/agent-card.json");
    expect(card.status).toBe(200);
    expect(((await card.json()) as { signatures: unknown[] }).signatures.length).toBeGreaterThan(0);
    const status = (await (await at("/api/exchange/status")).json()) as { environment: string };
    expect(status.environment).toBe("sandbox");
  });

  it("answers 405 with Allow for a wrong method and 404 for unknown paths", async () => {
    const wrong = await at("/api/exchange/a2a", { method: "GET" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("POST");
    expect((await at("/api/exchange/nope")).status).toBe(404);
  });
});
