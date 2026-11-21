import { describe, expect, it } from "vitest";
import { priceOf, type Terms } from "@bloom-exchange/schemas";
import {
  AgentKey,
  authString,
  clampPrice,
  commitMandate,
  commitmentOf,
  EMPTY_BODY_SHA256,
  fromHex,
  inclusionProof,
  merkleLeaf,
  merkleRoot,
  offerPrice,
  receiptDraft,
  receiptHash,
  sha256HexOf,
  signableTarget,
  signReceipt,
  signRequest,
  toB64url,
  toHex,
  verifyEd25519,
  verifyInclusion,
  verifyRelayReceipt,
  withinMandate,
  type Room,
} from "../src/index.ts";

describe("agent keys (Ed25519 on Web Crypto)", () => {
  it("matches RFC 8032 test vector 1 (key derivation and signature)", async () => {
    const seed = toB64url(fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"));
    const key = await AgentKey.fromSeed(seed);
    expect(toHex(Uint8Array.from(atob(key.publicKey.replace(/-/g, "+").replace(/_/g, "/") + "="), (c) => c.charCodeAt(0)))).toBe("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    const sig = await key.sign(new Uint8Array(new ArrayBuffer(0)));
    expect(toHex(Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "=="), (c) => c.charCodeAt(0)))).toBe(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
  });

  it("round-trips a seed, signs deterministically, and verifies only under its own key", async () => {
    const a = await AgentKey.generate();
    const again = await AgentKey.fromSeed(a.exportSeed());
    expect(again.publicKey).toBe(a.publicKey);
    expect(await a.sign("hello")).toBe(await again.sign("hello"));
    const sig = await a.sign("hello");
    expect(await verifyEd25519(a.publicKey, sig, "hello")).toBe(true);
    expect(await verifyEd25519(a.publicKey, sig, "hellO")).toBe(false);
    expect(await verifyEd25519((await AgentKey.generate()).publicKey, sig, "hello")).toBe(false);
    expect(await verifyEd25519("not-a-key", sig, "hello")).toBe(false);
    await expect(AgentKey.fromSeed("dG9vLXNob3J0")).rejects.toThrow(/32 bytes/);
  });
});

describe("request authentication", () => {
  it("signs METHOD, target, timestamp, nonce and the body hash, exactly", async () => {
    expect(authString("post", "/v1/rooms?x=1", "1763560000000", "n", "h")).toBe("POST\n/v1/rooms?x=1\n1763560000000\nn\nh");
    expect(await sha256HexOf("")).toBe(EMPTY_BODY_SHA256);
    const key = await AgentKey.generate();
    const a = await signRequest(key, "POST", "/v1/intents", '{"a":1}', 1_763_560_000_000);
    expect(a).toMatchObject({ pubkey: key.publicKey, timestamp: "1763560000000" });
    expect(a.nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await verifyEd25519(key.publicKey, a.signature, authString("POST", "/v1/intents", a.timestamp, a.nonce, await sha256HexOf('{"a":1}')))).toBe(true);
    expect(await verifyEd25519(key.publicKey, a.signature, authString("POST", "/v1/intents", a.timestamp, a.nonce, await sha256HexOf('{"a":2}')))).toBe(false);
  });

  it("strips only the bloom_* auth parameters from a WebSocket target", () => {
    expect(signableTarget(new URL("ws://h/v1/rooms/r/stream?after=3&bloom_pubkey=p&bloom_ts=1&bloom_nonce=n&bloom_sig=s"))).toBe("/v1/rooms/r/stream?after=3");
    expect(signableTarget(new URL("ws://h/v1/x?bloom_sig=s"))).toBe("/v1/x");
  });
});

describe("Merkle ledger (RFC 6962)", () => {
  const hashes = (n: number) => Promise.all(Array.from({ length: n }, (_, i) => sha256HexOf(`receipt-${i}`)));

  it("uses the RFC 6962 empty and single-leaf roots", async () => {
    expect(await merkleRoot([])).toBe(EMPTY_BODY_SHA256);
    const [h] = await hashes(1);
    expect(await merkleRoot([h])).toBe(toHex(await merkleLeaf(h)));
  });

  it("proves and verifies every leaf of every tree from 1 to 20 leaves", async () => {
    for (let n = 1; n <= 20; n++) {
      const hs = await hashes(n);
      const root = await merkleRoot(hs);
      for (let i = 0; i < n; i++) expect(await verifyInclusion(hs[i], i, n, await inclusionProof(hs, i), root), `${i}/${n}`).toBe(true);
    }
  });

  it("rejects a proof for the wrong leaf, index, size or root, or with a hash flipped", async () => {
    const hs = await hashes(11);
    const root = await merkleRoot(hs);
    const proof = await inclusionProof(hs, 6);
    expect(await verifyInclusion(hs[5], 6, 11, proof, root)).toBe(false);
    expect(await verifyInclusion(hs[6], 7, 11, proof, root)).toBe(false);
    expect(await verifyInclusion(hs[6], 6, 8, proof, root)).toBe(false); // a size that changes the path's shape
    // An inclusion proof binds a leaf to a root, not to a size: leaf 6's audit path has the same shape in trees of
    // 11 and 12, so size 12 with the 11-leaf root still verifies. RFC 9162 pairs size and root in a signed tree head,
    // which this ledger does not publish yet (documented in the relay README).
    expect(await verifyInclusion(hs[6], 6, 12, proof, root)).toBe(true);
    expect(await verifyInclusion(hs[6], 6, 11, proof, "0".repeat(64))).toBe(false);
    expect(await verifyInclusion(hs[6], 6, 11, [proof[0].replace(/^./, (c) => (c === "0" ? "1" : "0")), ...proof.slice(1)], root)).toBe(false);
    expect(await verifyInclusion(hs[6], 11, 11, proof, root)).toBe(false);
  });
});

describe("sealed mandates", () => {
  const buyer = { vertical: "compute.gpu", role: "buyer" as const, currency: "USD", limitAtomic: "912345" };

  it("commits with a salt, opens only with the same mandate and salt", async () => {
    const { commitment, opening } = await commitMandate(buyer);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(await commitmentOf(opening)).toBe(commitment);
    expect(await commitmentOf({ ...opening, mandate: { ...buyer, limitAtomic: "912346" } })).not.toBe(commitment);
    expect((await commitMandate(buyer)).commitment).not.toBe(commitment); // fresh salt each time
  });

  it("clamps offers to the mandate on the edge and checks bounds by role and currency", () => {
    expect(clampPrice("999999", buyer)).toBe("912345");
    expect(clampPrice("100", buyer)).toBe("100");
    const seller = { ...buyer, role: "seller" as const, limitAtomic: "701234" };
    expect(clampPrice("640000", seller)).toBe("701234");
    expect(withinMandate("912345", "USD", buyer)).toBe(true);
    expect(withinMandate("912346", "USD", buyer)).toBe(false);
    expect(withinMandate("700000", "USD", seller)).toBe(false);
    expect(withinMandate("912345", "EUR", buyer)).toBe(false);
  });
});

describe("receipts", () => {
  it("reads the negotiated price exactly as @bloom-exchange/schemas does", () => {
    const samples: Terms[] = [
      { vertical: "api.inference", model: "m", maxInputTokens: 1, maxOutputTokens: 1, latencySlaMs: 1, unitPriceAtomic: "7", currency: "USD" },
      { vertical: "compute.gpu", accelerator: "H100", acceleratorCount: 1, vramGb: 80, durationSeconds: 60, containerDigest: `sha256:${"0".repeat(64)}`, totalPriceAtomic: "8", currency: "USD" },
      { vertical: "data.retrieval", datasetId: "d", queryHashSha256: "0".repeat(64), maxAgeSeconds: 0, licenseTier: "research", totalPriceAtomic: "9", currency: "USDC" },
    ];
    for (const t of samples) expect(offerPrice(t as unknown as Record<string, unknown>).priceAtomic).toBe(priceOf(t));
  });

  it("verifies a dual-signed receipt and pinpoints what fails", async () => {
    const [b, s] = await Promise.all([AgentKey.generate(), AgentKey.generate()]);
    const bm = await commitMandate({ vertical: "compute.gpu", role: "buyer", currency: "USD", limitAtomic: "900" });
    const room = {
      id: "rm_000000000000000000000000",
      relay: "https://relay.example",
      intentId: "in_000000000000000000000000",
      vertical: "compute.gpu",
      status: "ACCEPTED",
      buyer: { pubkey: b.publicKey, mandateCommitment: bm.commitment },
      seller: { pubkey: s.publicKey, mandateCommitment: "1".repeat(64) },
      accepted: { terms: { vertical: "compute.gpu", totalPriceAtomic: "850", currency: "USD" }, priceAtomic: "850", currency: "USD", at: "2026-11-19T12:00:00.000Z", eventHash: "2".repeat(64) },
      rounds: 1,
      openedAt: "2026-11-19T11:59:00.000Z",
    } as unknown as Room;
    const receipt = receiptDraft(room);
    const hash = await receiptHash(receipt);
    const signatures = { buyer: await signReceipt(b, hash), seller: await signReceipt(s, hash) };
    expect(await verifyRelayReceipt({ receipt, signatures, hash }, [bm.opening])).toMatchObject({ valid: true, checks: { mandateBounds: "pass", ledgerInclusion: "unavailable" } });
    expect((await verifyRelayReceipt({ receipt, signatures: { buyer: signatures.seller, seller: signatures.seller } })).checks.buyerSignature).toBe("fail");
    expect((await verifyRelayReceipt({ receipt, signatures, hash: "3".repeat(64) })).checks.canonicalHash).toBe("fail");
    expect((await verifyRelayReceipt({ receipt, signatures, revoked: true })).valid).toBe(false);
    expect(() => receiptDraft({ ...room, accepted: null })).toThrow(/not been accepted/);
  });
});
