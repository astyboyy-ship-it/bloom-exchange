// Post-deploy smoke test for the Bloom relay (and, optionally, the verifier).
//
//   npm run smoke:phase2                                                    against http://localhost:8787
//   BLOOM_RELAY_URL=https://bloom-exchange-relay.vercel.app BLOOM_VERIFIER_URL=https://bloom-exchange-verify.vercel.app \
//     npm run smoke:phase2 -- --live
//
// Two disposable agents (fresh keys, labeled "smoke test") register, publish, discover, negotiate PROPOSE ->
// COUNTER -> ACCEPT over a live WebSocket subscription, dual-sign, CLEAR, and verify the receipt offline with its
// Merkle proof and both mandate openings, then check reputation and the verifier page.
//
// The ledger is append-only and public: every run against a shared relay leaves one permanent smoke-test receipt
// and two agents. That is why a non-local relay needs --live.
import { parseArgs } from "node:util";
import { AgentKey, commitMandate, RelayTransport, signReceipt, type RoomEvent } from "../packages/sdk/src/index.ts";
import { withPrice, type ApiInferenceTerms } from "../packages/schemas/src/index.ts";
import { relayAllowed } from "./seed-sellers.ts";

const { values } = parseArgs({ options: { live: { type: "boolean", default: false } } });
const relayUrl = (process.env.BLOOM_RELAY_URL ?? "http://localhost:8787").replace(/\/+$/, "");
const verifierUrl = process.env.BLOOM_VERIFIER_URL?.replace(/\/+$/, "");
let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
  return ok;
};

async function main() {
  const allowed = relayAllowed(relayUrl, values.live);
  if (!allowed.ok) {
    console.error(`  x ${allowed.reason.replace("Reference sellers are mock liquidity", "A smoke run leaves a permanent public receipt")}`);
    process.exit(2);
  }
  const t0 = Date.now();
  console.log(`\n  SMOKE TEST · relay ${relayUrl}${verifierUrl ? ` · verifier ${verifierUrl}` : ""}\n`);

  const health = (await (await fetch(`${relayUrl}/health`)).json()) as { ok: boolean; store: string; nonces: string; transports?: string[] };
  const transports = health.transports ?? ["ws", "sse", "poll"];
  check(health.ok, `health: store ${health.store}, nonces ${health.nonces}, transports ${transports.join("/")}`);
  if (relayUrl.startsWith("https://")) check(health.store === "postgres" && health.nonces === "redis", "production backends (postgres + redis), not the memory fallbacks");

  const [sk, bk] = await Promise.all([AgentKey.generate(), AgentKey.generate()]);
  const seller = new RelayTransport({ baseUrl: relayUrl, key: sk });
  const buyer = new RelayTransport({ baseUrl: relayUrl, key: bk });
  await seller.registerAgent({ displayName: "Smoke test seller (disposable)", org: "Bloom Exchange smoke test" });
  await buyer.registerAgent({ displayName: "Smoke test buyer (disposable)", org: "Bloom Exchange smoke test" });
  check(true, "registered two disposable agents");

  const spec: ApiInferenceTerms = { vertical: "api.inference", model: "smoke-test/echo", maxInputTokens: 1_000, maxOutputTokens: 100, latencySlaMs: 1_000, unitPriceAtomic: "100", currency: "USD" };
  const intent = await seller.publishIntent({ vertical: "api.inference", role: "seller", capabilityTags: ["smoke-test"], spec, ttlSeconds: 300 });
  check(intent.status === "OPEN", `published intent ${intent.id}`);
  const found = await buyer.discoverIntents({ vertical: "api.inference", tag: "smoke-test", limit: 100 });
  check(found.some((i) => i.id === intent.id), "discovered it by vertical and tag");

  const bm = await commitMandate({ vertical: "api.inference", role: "buyer", currency: "USD", limitAtomic: "90" });
  const sm = await commitMandate({ vertical: "api.inference", role: "seller", currency: "USD", limitAtomic: "70" });
  const { room } = await buyer.openRoom({ intentId: intent.id, terms: withPrice(spec, "60"), mandateCommitment: bm.commitment, maxRounds: 3, ttlSeconds: 300 });
  const seen: RoomEvent[] = [];
  // The live stream the relay offers: WebSocket on a long-running server, SSE on serverless (Vercel).
  const streamMode = transports.includes("ws") ? "ws" : "sse";
  const sub = seller.subscribeRoom(room.id, (e) => seen.push(e), { mode: streamMode });
  await seller.sendEvent(room.id, { type: "COUNTER", terms: withPrice(spec, "80"), mandateCommitment: sm.commitment });
  await buyer.sendEvent(room.id, { type: "ACCEPT" });
  check(true, "negotiated PROPOSE 60 -> COUNTER 80 -> ACCEPT");

  const b = await buyer.prepareReceipt(room.id);
  const s = await seller.prepareReceipt(room.id);
  check(b.hash === s.hash, "both edges derived the same receipt from the signed transcript");
  const signatures = { buyer: await signReceipt(buyer.key, b.hash), seller: await signReceipt(seller.key, s.hash) };
  const cleared = (await seller.sendEvent(room.id, { type: "CLEAR", receipt: b.receipt as unknown as Record<string, unknown>, signatures })) as Awaited<ReturnType<RelayTransport["sendEvent"]>> & { receipt?: { verifyUrl: string } };
  check(cleared.room.status === "CLEARED", `cleared ${b.hash}`);

  // SSE on serverless picks up moves from the shared store about once a second, so allow a little longer.
  const until = Date.now() + 10_000;
  while (seen.length < 4 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  sub.close();
  check(seen.length >= 4 && sub.mode === streamMode, `live ${streamMode.toUpperCase()} stream delivered ${seen.length} events (mode ${sub.mode})`);

  const v = await buyer.verifyReceipt(b.hash, [bm.opening, sm.opening]);
  check(v.valid, `receipt verifies offline: ${Object.entries(v.checks).map(([k, x]) => `${k} ${x}`).join(", ")}`);
  const rep = await buyer.getReputation(seller.key.publicKey);
  check(rep.completedDeals === 1, `seller reputation: ${rep.completedDeals} completed deal`);

  if (verifierUrl) {
    const page = await fetch(`${verifierUrl}/r/${b.hash}`);
    const html = await page.text();
    check(page.ok && html.includes("Bloom Verify"), `verifier page ${verifierUrl}/r/${b.hash.slice(0, 12)}… answers ${page.status}`);
    const csp = page.headers.get("content-security-policy") ?? "";
    check(csp.includes(relayUrl), "verifier CSP allows this relay (NEXT_PUBLIC_BLOOM_RELAY_URL was set at build time)");
    console.log(`\n  Open it in a browser to see the badges: ${verifierUrl}/r/${b.hash}`);
  }

  console.log(failures === 0 ? `\n  SMOKE TEST PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s\n` : `\n  ✗ ${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n  ✗ ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  process.exit(1);
});
