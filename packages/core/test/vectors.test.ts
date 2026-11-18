import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize, certificateIdFrom, certificateIdInput, GENESIS, roundPayload, signingInput } from "../src/canonical";
import { sha256Hex } from "../src/crypto";
import { deriveExchangeKeys } from "../src/key-derivation";
import { commitment } from "../src/vault";

/**
 * SPEC.md Appendix A test vectors. Independent implementations (Python, Go, Rust, …) must reproduce every value
 * byte for byte. If this test changes, the protocol changed: bump the version and update the spec.
 */
const V = {
  secret: "bcp-v0.1-test-vector-secret",
  seed: "15062cf58c0f23fb66a6ced537f7e86fe4df968e14410f48398ab58f7a0d8ade",
  publicX: "E1nxv_r2gElknFSUy4fX-XDQ7pwTYAIHdPmEghrwYPs",
  kid: "bxk-ec9ef1d17dc2ace6",
  canonical: '{"a":[3,"x",null,true],"b":2,"c":{"y":0,"z":1.5},"é":"ü"}',
  roundHash: "760938828bf49ff168aa8d1547c9935c1caf5240997eeb94f91beed45a6bd5ce",
  commitment: "7e761878ea8d05cefeddbc9720e0e4f9728543d5697be7efbf5aef1f33e5ec82",
  certIdHash: "dc4ab153cf8cb6492bc7409b3ad481303c14987cff6980ab0dc39448a3139306",
  certificateId: "BLOOM-XCH-VH5B-2MYF-HJV4-JAY7",
  digest: "3928ce786b2f56ae2e570fc3f76aae906c33d520181b13de97ab2f282454dd25",
  signature: "p5Py8nbNiYWfEYcwbpinLMg0ReJ5iqn8p53MRrp8TE0M4qGL9haRrGxQhR6ocgxgLqiTevnLTOeU_4qtXF6VDQ",
};

describe("BCP v0.1 test vectors (SPEC Appendix A)", () => {
  it("A.1 canonical JSON: sorted keys by UTF-16 code unit, no whitespace, undefined dropped, -0 as 0", () => {
    expect(canonicalize({ b: 2, a: [3, "x", null, true], é: "ü", c: { z: 1.5, y: -0 }, u: undefined })).toBe(V.canonical);
  });

  it("A.2 key derivation: seed = HMAC-SHA256(secret, 'bloom-exchange/ed25519/v1'), kid = 'bxk-' + SHA-256(x)[0:16]", () => {
    const k = deriveExchangeKeys(V.secret);
    expect((k.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).subarray(16).toString("hex")).toBe(V.seed);
    expect(k.publicX).toBe(V.publicX);
    expect(k.kid).toBe(V.kid);
  });

  it("A.3 round hash over the canonical round with prevHash = GENESIS", () => {
    const round = { n: 1, by: "initiator", terms: { priceUsd: 58900, netDays: 30, slaTier: "gold" }, message: "Opening at list.", at: "2026-01-01T00:00:00.000Z", prevHash: GENESIS };
    expect(sha256Hex(roundPayload(round))).toBe(V.roundHash);
  });

  it("A.4 mandate commitment = SHA-256(canonical({ mandate, salt }))", () => {
    expect(commitment(sha256Hex, { ceilingPriceUsd: 52500, maxBudgetUsd: 55000, requiredSlaTier: "gold", targetNetDays: 60 }, "00112233445566778899aabbccddeeff")).toBe(V.commitment);
  });

  it("A.5 certificate id from taskId, chain head and issuedAt", () => {
    const input = certificateIdInput("xch_vector000000001", V.roundHash, "2026-01-01T00:05:00.000Z");
    expect(sha256Hex(input)).toBe(V.certIdHash);
    expect(certificateIdFrom(V.certIdHash)).toBe(V.certificateId);
  });

  it("A.6 Ed25519 over 'BLOOM-XCH-SIG-v1\\n' + digest (UTF-8), base64url without padding", () => {
    expect(sha256Hex(canonicalize({ hello: "bloom" }))).toBe(V.digest);
    const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: V.publicX }, format: "jwk" });
    expect(verify(null, Buffer.from(signingInput(V.digest), "utf8"), pub, Buffer.from(V.signature, "base64url"))).toBe(true);
    expect(verify(null, Buffer.from(signingInput(V.digest.replace(/^3/, "4")), "utf8"), pub, Buffer.from(V.signature, "base64url"))).toBe(false);
  });
});
