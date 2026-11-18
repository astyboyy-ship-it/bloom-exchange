#!/usr/bin/env node
/**
 * bloom-verify: offline verification of a BLOOM-XCH settlement certificate.
 *
 *   npx @bloom-exchange/sdk verify receipt.json       the same, without installing (bloom-verify once installed)
 *   npx bloom-verify receipt.json                     keys from the issuer's published Agent Card
 *   npx bloom-verify receipt.json --card card.json    air-gapped: keys from a saved Agent Card
 *   cat receipt.json | npx bloom-verify -             read the receipt from stdin
 *   npx bloom-verify receipt.json --json              machine-readable result
 *
 * Accepts a bare certificate or any JSON that contains one under "certificate" (an enclave export).
 * Checks: canonical digest, certificate id, round hash chain, Ed25519 signature, both AP2 credential proofs,
 * and that the Agent Card supplying the keys verifies against its own published key.
 * Exit codes: 0 valid · 1 invalid · 2 usage or input error.
 */
import { readFile } from "node:fs/promises";
import { cardKeys, verifyAgentCard, verifyCertificate } from "./verify.ts";
import type { AgentCard, SettlementCertificate } from "./types.ts";

const USAGE = "usage: bloom-verify <receipt.json | -> [--card <agent-card.json | url>] [--json]\n       npx @bloom-exchange/sdk verify <receipt.json> [--card …] [--json]";

type Outcome = { valid: boolean; certificateId: string | null; issuer: string | null; keySource: string | null; cardValid: boolean | null; checks: Record<string, boolean>; reason?: string };

async function readSource(src: string): Promise<string> {
  if (src === "-") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${src} answered ${r.status}`);
    return r.text();
  }
  return readFile(src, "utf8");
}

function extractCertificate(doc: unknown): SettlementCertificate | null {
  if (!doc || typeof doc !== "object") return null;
  const o = doc as Record<string, unknown>;
  if (typeof o.certificateId === "string" && o.signature && o.rounds) return o as unknown as SettlementCertificate;
  if (o.certificate && typeof o.certificate === "object") return extractCertificate(o.certificate);
  return null;
}

export async function run(rawArgv: string[]): Promise<{ code: number; out: Outcome | null; message?: string }> {
  // `npx @bloom-exchange/sdk verify receipt.json` and `bloom-verify receipt.json` are the same command.
  const argv = rawArgv[0] === "verify" ? rawArgv.slice(1) : rawArgv;
  const cardAt = argv.indexOf("--card");
  const cardSrc = cardAt >= 0 ? argv[cardAt + 1] : undefined;
  const cardValueAt = cardAt >= 0 ? cardAt + 1 : -1;
  const receiptSrc = argv.find((a, i) => !a.startsWith("--") && i !== cardValueAt);
  if (!receiptSrc || (cardAt >= 0 && !cardSrc)) return { code: 2, out: null, message: USAGE };

  let cert: SettlementCertificate | null;
  try {
    cert = extractCertificate(JSON.parse(await readSource(receiptSrc)));
  } catch (err) {
    return { code: 2, out: null, message: `cannot read receipt: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!cert) return { code: 2, out: null, message: "no BLOOM-XCH certificate found in the input" };

  const source = cardSrc ?? cert.issuer?.agentCard;
  if (!source) return { code: 2, out: null, message: "the certificate names no issuer Agent Card; pass --card" };
  let card: AgentCard;
  try {
    card = JSON.parse(await readSource(source)) as AgentCard;
  } catch (err) {
    return { code: 2, out: null, message: `cannot load Agent Card from ${source}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const cardCheck = await verifyAgentCard(card);
  const result = await verifyCertificate(cert, cardKeys(card));
  const valid = result.valid && cardCheck.valid;
  const out: Outcome = {
    valid,
    certificateId: cert.certificateId ?? null,
    issuer: cert.issuer?.name ?? null,
    keySource: source,
    cardValid: cardCheck.valid,
    checks: { ...result.checks, agentCard: cardCheck.valid },
    ...(!valid && { reason: !cardCheck.valid ? "the Agent Card supplying the keys does not verify" : result.reason }),
  };
  return { code: valid ? 0 : 1, out };
}

function render(o: Outcome): string {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  const rows = Object.entries(o.checks).map(([k, ok]) => `  ${mark(ok)} ${k}`);
  return [`${o.valid ? "VALID" : "INVALID"}  ${o.certificateId ?? "(no id)"}`, `  issuer  ${o.issuer ?? "?"}`, `  keys    ${o.keySource}`, ...rows, ...(o.reason ? [`  reason  ${o.reason}`] : [])].join("\n");
}

// Run only when executed directly (the module is also imported by tests).
const direct = process.argv[1] && /cli\.(t|j)s$/.test(process.argv[1]);
if (direct) {
  const argv = process.argv.slice(2);
  void run(argv).then(({ code, out, message }) => {
    if (message) console.error(message);
    if (out) console.log(argv.includes("--json") ? JSON.stringify(out, null, 2) : render(out));
    process.exit(code);
  });
}
