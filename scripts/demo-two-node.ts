// Two Bloom nodes discover each other and settle a cross-node deal in each direction.
//
//   npm run demo:two-node            against running nodes (default: docker compose on :3001 and :3002)
//   npm run demo:two-node:local      starts both nodes locally from the production build (npm run build first)
//   ... -- --alpha http://host:3001 --beta http://host:3002
//
// Each node has its own Ed25519 root key. The demo (1) asks each node which peers it has verified, (2) has an
// agent from node-alpha negotiate on node-beta and vice versa, presenting its home node's signed Agent Card (whose
// screened name is how the receipt identifies the counterparty), and
// (3) verifies every receipt against its issuer's card, and checks that the other node's key does NOT verify it.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BloomExchangeClient, cardKeys, verifyAgentCard, verifyCertificate } from "../packages/sdk/src/index.ts";
import type { AgentCard, SettlementCertificate } from "../packages/sdk/src/types.ts";

const { values } = parseArgs({ options: { alpha: { type: "string" }, beta: { type: "string" }, spawn: { type: "boolean", default: false } } });
const ROOT = join(import.meta.dirname, "..");
const children: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (b: boolean) => (b ? "✓" : "✗");

async function startNode(name: string, port: number, peer: string): Promise<string> {
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd: join(ROOT, "apps", "node"),
    env: { ...process.env, BLOOM_NODE_ORG: name, BLOOM_EXCHANGE_SECRET: randomBytes(32).toString("hex"), LICENSE_SIGNING_SECRET: randomBytes(32).toString("hex"), BLOOM_PEERS: peer, KV_REST_API_URL: "", KV_REST_API_TOKEN: "", COMMAND_PROVIDER: "simulation" },
    stdio: "ignore",
  });
  children.push(child);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${url}/api/exchange/status`)).ok) return url;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`${name} did not start on :${port} (run npm run build first)`);
}

async function main() {
  let alpha = values.alpha ?? "http://127.0.0.1:3001";
  let beta = values.beta ?? "http://127.0.0.1:3002";
  if (values.spawn) {
    console.log("  starting node-alpha (:3101) and node-beta (:3102) with fresh, separate root keys…");
    [alpha, beta] = await Promise.all([startNode("Alpha", 3101, "http://127.0.0.1:3102"), startNode("Beta", 3102, "http://127.0.0.1:3101")]);
  }
  const nodes = { alpha, beta } as const;

  // 1. Identity and discovery
  console.log("\n  1 · DISCOVERY");
  const cards: Record<string, AgentCard> = {};
  for (const [name, url] of Object.entries(nodes)) {
    cards[name] = (await (await fetch(`${url}/.well-known/agent-card.json`)).json()) as AgentCard;
    const self = await verifyAgentCard(cards[name]);
    const peers = (await (await fetch(`${url}/api/exchange/peers`)).json()) as { self: { organization: string; kid: string }; peers: { url: string; verified: boolean; kid: string | null }[] };
    const seen = peers.peers.map((p) => `${p.url} ${ok(p.verified)} ${p.kid ?? p.verified}`).join(", ") || "none configured";
    console.log(`    node-${name.padEnd(5)} ${peers.self.organization.padEnd(8)} key ${peers.self.kid} card ${ok(self.valid)}   peers: ${seen}`);
  }
  if (cardKeys(cards.alpha)[0]?.kid === cardKeys(cards.beta)[0]?.kid) throw new Error("both nodes share a root key; give them separate BLOOM_EXCHANGE_SECRET values");

  // 2 and 3. A cross-node deal each way
  let allOk = true;
  for (const [buyer, seller] of [["alpha", "beta"], ["beta", "alpha"]] as const) {
    console.log(`\n  ${buyer === "alpha" ? 2 : 3} · node-${buyer}'s agent buys on node-${seller}`);
    const client = new BloomExchangeClient({ baseUrl: nodes[seller], agent: { name: `node-${buyer}/procurement`, framework: "bloom-sdk", card: cards[buyer] as unknown as Record<string, unknown> } });
    const { state, certificate } = await client.negotiate({
      mandate: { ceilingPriceUsd: 52_500, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 60 },
      item: { description: "Managed observability platform, 12-month enterprise license", quantity: 1 },
      message: `Procurement agent from node-${buyer}. Gold SLA required; net 60 preferred.`,
    }).result;
    if (state !== "completed" || !certificate) {
      console.log(`    ✗ no settlement (state ${state})`);
      allOk = false;
      continue;
    }
    const cert = certificate as SettlementCertificate;
    const byIssuer = await verifyCertificate(cert, cardKeys(cards[seller]));
    const byOther = await verifyCertificate(cert, cardKeys(cards[buyer]));
    console.log(`    settled ${cert.certificateId} at $${cert.terms.priceUsd.toLocaleString("en-US")} · net ${cert.terms.netDays} · ${cert.terms.slaTier} · ${cert.rounds.count} rounds`);
    console.log(`    receipt: issued by ${cert.issuer.name} (${cert.signature.kid}) · counterparty ${cert.parties.counterparty.agent}`);
    console.log(`    ${ok(byIssuer.valid)} verifies against node-${seller}'s card   ${ok(!byOther.valid)} does not verify against node-${buyer}'s key`);
    allOk &&= byIssuer.valid && !byOther.valid && cert.parties.counterparty.agent === cards[buyer].name;
  }

  console.log(allOk ? "\n  Two independent nodes, two signed cross-node settlements, each verifiable only against its issuer.\n" : "\n  ✗ The demo did not complete.\n");
  return allOk;
}

main()
  .then((good) => {
    children.forEach((c) => c.kill());
    process.exit(good ? 0 : 1);
  })
  .catch((err) => {
    console.error(`\n  ✗ ${err instanceof Error ? err.message : String(err)}\n`);
    children.forEach((c) => c.kill());
    process.exit(1);
  });
