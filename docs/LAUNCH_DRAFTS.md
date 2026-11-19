# Phase 2 launch drafts

Drafts for announcing the clearing relay. Each claim maps to code or a test in this repository; the "Claims you must not make" list in [LAUNCH_KIT.md](LAUNCH_KIT.md) still applies.

**Before posting:**
- **Deploy first.** `relay.bloomexchange.ai` and `verify.bloomexchange.ai` must be live and `./scripts/phase2-launch.sh smoke` must pass. A Show HN needs something people can try.
- **Space it out.** Bloom Exchange already had a Show HN on 2026-11-19. HN allows a repost for substantial new work, but posting soon after reads as a duplicate. Give it a few weeks and lead with what's new: agents on different machines, the non-custodial relay, and dual-signed receipts.

## Show HN

**Title.** HN titles are limited to 80 characters.

* As requested (**85 characters, over the limit**): `Show HN: Bloom Exchange – Non-custodial negotiation and signed receipts for AI agents`
* `Show HN: Bloom Exchange – non-custodial negotiation and receipts for AI agents` (78)
* `Show HN: A relay where AI agents negotiate and both sign the receipt` (68)
* `Show HN: Agents negotiate over a relay that holds no keys; both sign the receipt` (80)

**URL:** `https://github.com/astyboyy-ship-it/bloom-exchange`

**First comment** (post it right after submitting, as the author):

> Hi HN. A while back I posted Bloom Exchange, a library that keeps an agent's budget out of its prompt while it negotiates. This is the part that lets agents on different machines actually trade: a relay they meet on, plus a receipt both sides sign.
>
> The question I kept getting was: "x402 and AP2 already handle agent payments, why negotiate?" They handle a different step.
>
> - **Payment rails settle a price; they don't arrive at one.** An x402 server answers 402 with the amount it chose, and the agent pays or doesn't. An AP2 mandate authorizes a purchase that was already decided. For commodity calls that's enough. For a week of 8×H100, a data license or an inference SLA, the price and terms get negotiated first. Today that happens in a prompt, where one injected sentence can pull the budget out.
> - **So the limit has to live in code, on the agent's side.** Each agent seals its ceiling or floor as a salted SHA-256 commitment and clamps every offer to it before the offer leaves the machine. The relay and the counterparty only ever see the commitment. Opening it later proves the cleared price sat inside it, without the number having been revealed.
> - **A payment receipt proves money moved, not what was agreed.** Here both agents sign one canonical receipt with Ed25519. It covers the terms (for GPUs, down to the container image digest), the price, both mandate commitments and the hash of the negotiation transcript. Anyone can verify it offline, and the relay logs it in an RFC 6962 Merkle ledger with an inclusion proof.
>
> The relay is deliberately dumb. It holds no keys, sees only commitments and signs nothing. Every move in a room carries its author's own request signature, so the relay can refuse a move but can't forge one. Before signing, each agent rebuilds the receipt from that signed transcript and refuses if the relay's draft differs by a byte.
>
> To try it locally: `npm install && npm run relay`, then `npm run seed:sellers` for three labeled demo sellers, and `npm run smoke:phase2` for a full publish → negotiate → dual-sign → clear → verify loop. `tests/phase2-e2e.test.ts` walks through the same flow with the adversarial cases: replays, clock drift, one-cent receipt edits, swapped signatures. The browser verifier runs every check client-side. There are also MCP tools (`bloom_publish_intent`, `bloom_discover_counterparties`, `bloom_verify_receipt`). The wire format is in docs/RELAY_PROTOCOL.md.
>
> What it doesn't do yet:
>
> 1. **One relay instance**, no rate limiting, and no revocation endpoint.
> 2. **No signed tree heads**, so a relay that showed different readers different ledgers wouldn't be caught yet.
> 3. **Domains are claimed, not verified.**
> 4. **Cleared receipts are public, price included.** Rooms and offers are private.
> 5. **It isn't a payment rail.** The receipt is the agreement; money still moves on whatever rail you use.
>
> I'd most like feedback on the protocol doc and on whether dual-signed receipts are the right primitive. Apache-2.0.

**Prepared answers:**

* **"Why not put the negotiation on-chain?"** Nothing here needs consensus. Agreement is two signatures, and verification is offline. Ordering across receipts is a transparency-log problem; the missing piece is signed tree heads, not a chain.
* **"Can the relay cheat?"** It can refuse to relay, or go down. It can't forge a move, a receipt or a signature, because every move and receipt is signed by the agents and checked on both edges. It can show different ledgers to different readers until signed tree heads exist; that's limitation 2 above.
* **"What stops a buyer from lying about its mandate?"** Nothing stops a party from committing to a number other than its real limit. The commitment makes that number binding and provable later, and the clamp in the edge's own code keeps that edge's offers inside it.
* **"Is the demo liquidity real?"** No. `seed:sellers` runs labeled reference sellers with throwaway keys that deliver nothing. They refuse to run against a non-local relay without `--live`.
