// Reference sellers: continuous MOCK LIQUIDITY for the Bloom clearing relay, for demos and local testing.
//
//   npm run seed:sellers                                     against http://localhost:8787 (npm run relay)
//   BLOOM_RELAY_URL=https://relay.bloomexchange.ai npm run seed:sellers -- --live
//   ... -- --verticals compute.gpu,api.inference --interval 2000 --once
//
// Each run generates fresh, disposable Ed25519 keys (nothing is saved), registers the agents as "Reference
// seller (demo liquidity)", tags every intent "reference-liquidity", and answers rooms opened on its intents with
// a deterministic concession strategy clamped to a sealed floor. These agents deliver nothing: a deal with one is
// a demonstration, not a purchase. A non-local relay needs --live, so mock sellers never reach a public network
// by accident.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AgentKey, clampPrice, commitMandate, RelayTransport, signReceipt, type MandateOpening, type Room } from "../packages/sdk/src/index.ts";
import { priceOf, withPrice, type Terms, type Vertical } from "../packages/schemas/src/index.ts";

export type SellerProfile = { vertical: Vertical; tags: string[]; spec: Terms; floorAtomic: string; ttlSeconds: number };

export const PROFILES: Record<Vertical, SellerProfile> = {
  "api.inference": {
    vertical: "api.inference",
    tags: ["reference-liquidity", "llama", "low-latency"],
    spec: { vertical: "api.inference", model: "meta/llama-4-70b", maxInputTokens: 128_000, maxOutputTokens: 8_192, latencySlaMs: 900, unitPriceAtomic: "60", currency: "USD" },
    floorAtomic: "38",
    ttlSeconds: 3_600,
  },
  "data.retrieval": {
    vertical: "data.retrieval",
    tags: ["reference-liquidity", "openalex", "scholarly"],
    spec: { vertical: "data.retrieval", datasetId: "openalex/works", queryHashSha256: "0".repeat(64), maxAgeSeconds: 604_800, licenseTier: "research", totalPriceAtomic: "2500000", currency: "USDC" },
    floorAtomic: "1600000",
    ttlSeconds: 3_600,
  },
  "compute.gpu": {
    vertical: "compute.gpu",
    tags: ["reference-liquidity", "h100", "eu-west"],
    spec: { vertical: "compute.gpu", accelerator: "H100-SXM-80GB", acceleratorCount: 8, vramGb: 80, durationSeconds: 3_600, containerDigest: `sha256:${"0".repeat(64)}`, totalPriceAtomic: "2400000", currency: "USD" },
    floorAtomic: "1750000",
    ttlSeconds: 3_600,
  },
};

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
export function relayAllowed(url: string, live: boolean): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "BLOOM_RELAY_URL is not a URL." };
  }
  if (LOCAL.test(u.origin) || live) return { ok: true };
  return { ok: false, reason: `${u.origin} is not local. Reference sellers are mock liquidity: pass --live to publish them on a shared relay on purpose.` };
}

/** One reference seller: an intent, a sealed floor, and a deterministic reply to every room on that intent. */
export class ReferenceSeller {
  readonly relay: RelayTransport;
  readonly profile: SellerProfile;
  private intent: { id: string; expiresAt: string } | null = null;
  private readonly openings = new Map<string, { commitment: string; opening: MandateOpening }>();
  private readonly log: (line: string) => void;

  constructor(relay: RelayTransport, profile: SellerProfile, log: (line: string) => void = () => undefined) {
    this.relay = relay;
    this.profile = profile;
    this.log = log;
  }

  async start() {
    await this.relay.registerAgent({ displayName: `Reference seller (demo liquidity) · ${this.profile.vertical}`, org: "Bloom Exchange reference liquidity" });
    await this.publish();
  }

  private async publish() {
    const i = await this.relay.publishIntent({ vertical: this.profile.vertical, role: "seller", capabilityTags: this.profile.tags, spec: this.profile.spec as unknown as Record<string, unknown>, ttlSeconds: this.profile.ttlSeconds });
    this.intent = { id: i.id, expiresAt: i.expiresAt };
    this.log(`${this.profile.vertical}: published ${i.id} at ${priceOf(this.profile.spec)} ${this.profile.spec.currency} (atomic)`);
  }

  private async mandateFor(roomId: string) {
    let m = this.openings.get(roomId);
    if (!m) {
      m = await commitMandate({ vertical: this.profile.vertical, role: "seller", currency: this.profile.spec.currency, limitAtomic: this.profile.floorAtomic });
      this.openings.set(roomId, m);
    }
    return m;
  }

  /** One pass: keep the intent fresh, then answer every room that is waiting on this seller. */
  async step(now = Date.now()) {
    if (!this.intent || Date.parse(this.intent.expiresAt) - now < 5 * 60_000) await this.publish();
    const rooms = await this.relay.listRooms({ status: ["PROPOSED", "COUNTERED", "ACCEPTED"], limit: 50 });
    for (const room of rooms) {
      if (room.seller.pubkey !== this.relay.key.publicKey || room.vertical !== this.profile.vertical) continue;
      try {
        await this.answer(room);
      } catch (err) {
        this.log(`${this.profile.vertical}: ${room.id} skipped (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  private async answer(room: Room) {
    const me = this.relay.key.publicKey;
    if (room.status === "ACCEPTED") return this.settle(room);
    if (!room.lastOffer || room.lastOffer.by === me) return; // waiting on the buyer
    const m = await this.mandateFor(room.id);
    const commitment = room.seller.mandateCommitment ? undefined : m.commitment;
    const bid = BigInt(room.lastOffer.priceAtomic);
    const floor = BigInt(this.profile.floorAtomic);
    const { events } = await this.relay.getRoom(room.id);
    const myLast = [...events].reverse().find((e) => e.by === me && e.type === "COUNTER");
    const ask = BigInt(priceOf(myLast ? (myLast.body.terms as Terms) : this.profile.spec)); // its own standing ask
    const roundsLeft = room.rounds < room.maxRounds;
    if (bid >= floor && (bid >= ask || !roundsLeft || ask - bid <= ask / 50n)) {
      await this.relay.sendEvent(room.id, { type: "ACCEPT", ...(commitment && { mandateCommitment: commitment }) });
      this.log(`${this.profile.vertical}: ${room.id} accepted at ${bid}`);
    } else if (roundsLeft) {
      // Concede halfway toward the bid, never below the sealed floor (the clamp runs here, on the edge).
      const counter = clampPrice(((ask + bid) / 2n).toString(), m.opening.mandate);
      await this.relay.sendEvent(room.id, { type: "COUNTER", terms: withPrice(room.lastOffer.terms as unknown as Terms, counter) as unknown as Record<string, unknown>, ...(commitment && { mandateCommitment: commitment }) });
      this.log(`${this.profile.vertical}: ${room.id} countered ${counter} against ${bid}`);
    } else {
      await this.relay.sendEvent(room.id, { type: "REJECT" });
      this.log(`${this.profile.vertical}: ${room.id} rejected (below floor, no rounds left)`);
    }
  }

  /** Signs the receipt it derived from the transcript and clears once the buyer has signed too. */
  private async settle(room: Room) {
    const { receipt, hash, room: fresh } = await this.relay.prepareReceipt(room.id);
    const mine = fresh.signatures.seller ?? (await signReceipt(this.relay.key, hash));
    if (!fresh.signatures.seller) await this.relay.sendEvent(room.id, { type: "SIGN", signature: mine });
    if (!fresh.signatures.buyer) return; // the buyer has not signed yet
    const out = await this.relay.sendEvent(room.id, { type: "CLEAR", receipt: receipt as unknown as Record<string, unknown>, signatures: { buyer: fresh.signatures.buyer, seller: mine } });
    this.log(`${this.profile.vertical}: ${room.id} CLEARED ${out.room.receiptHash}`);
  }
}

async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean", default: false }, once: { type: "boolean", default: false }, interval: { type: "string", default: "2000" }, verticals: { type: "string", default: Object.keys(PROFILES).join(",") } } });
  const relayUrl = (process.env.BLOOM_RELAY_URL ?? "http://localhost:8787").replace(/\/+$/, "");
  const allowed = relayAllowed(relayUrl, values.live);
  if (!allowed.ok) {
    console.error(`  x ${allowed.reason}`);
    process.exit(2);
  }
  const verticals = values.verticals.split(",").map((v) => v.trim()) as Vertical[];
  const unknown = verticals.filter((v) => !(v in PROFILES));
  if (unknown.length) {
    console.error(`  x unknown vertical: ${unknown.join(", ")}`);
    process.exit(2);
  }
  console.log(`\n  REFERENCE SELLERS (mock liquidity) on ${relayUrl}`);
  console.log("  Disposable keys, generated now and never saved. These agents deliver nothing.\n");
  const log = (line: string) => console.log(`  ${new Date().toISOString().slice(11, 19)}  ${line}`);
  const sellers = await Promise.all(verticals.map(async (v) => new ReferenceSeller(new RelayTransport({ baseUrl: relayUrl, key: await AgentKey.generate() }), PROFILES[v], log)));
  for (const s of sellers) {
    await s.start();
    log(`${s.profile.vertical}: seller ${s.relay.key.publicKey}`);
  }
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  do {
    for (const s of sellers) await s.step().catch((err) => log(`${s.profile.vertical}: relay error (${err instanceof Error ? err.message : String(err)})`));
    if (values.once) break;
    await new Promise((r) => setTimeout(r, Math.max(250, Number(values.interval) || 2000)));
  } while (!stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`  x ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
