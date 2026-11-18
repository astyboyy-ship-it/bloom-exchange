import { GENESIS, roundPayload } from "./canonical";
import { sha256Hex } from "./crypto";
import { aetherTerms, concessionBeta, cortexRead, deterministicApex, maxStepFraction, priceHold, usd, type ApexContext, type Posture, type Proposer } from "./bloom-bridge";
import { enforceInitiatorMandate } from "./settlement";
import { counterpartyPolicy, initiatorBrief, privateFigures, scrubLeaks, sellerReserve, type SealedVault } from "./vault";
import { slaRank, type AetherProof, type Clamp, type CortexSignal, type Engine, type OperatorRoundDetail, type PublicRound, type Side, type Terms } from "./types";

/**
 * Alternating-offers negotiation inside one enclave. The provider (initiator) is driven by the parliament; the
 * client (counterparty) by a neutral proxy that concedes linearly toward its own reserve. Acceptance is
 * deterministic on both sides (accept when the other side's offer beats your own next planned offer), so a model
 * only ever shapes the provider's counter-offers, and every one of those passes Sovereign before it is sent.
 */

export type NegotiationHooks = {
  onRound: (round: PublicRound, detail: OperatorRoundDetail | null) => Promise<void>;
  onSignal: (engine: Engine, text: string) => Promise<void>;
  onClamp: (round: number, clamps: Clamp[]) => Promise<void>;
  isCanceled: () => Promise<boolean>;
  pace: () => Promise<void>;
  now: () => Date;
};

export type NegotiationInput = {
  vault: SealedVault;
  trust: number;
  posture: Posture;
  counterpartyMessage: string;
  apex: Proposer;
  maxTurns?: number;
  /** Rounds from an earlier session of the same enclave (a resumed negotiation continues the chain). */
  prior?: PublicRound[];
};

export type NegotiationResult = {
  outcome: "agreement" | "no_agreement" | "canceled";
  terms: Terms | null;
  lastCounter: Terms | null;
  rounds: PublicRound[];
  operatorRounds: OperatorRoundDetail[];
  signals: CortexSignal[];
  restructures: AetherProof["restructures"];
  usage: { input: number; output: number; liveTurns: number };
  model: string;
};

/** The next round on a chain: numbered, timestamped and hashed over its public fields plus the previous hash. */
export function chainRound(prior: PublicRound[], by: Side, terms: Terms, message: string, at: Date): PublicRound {
  const last = prior[prior.length - 1];
  const base = { n: (last?.n ?? 0) + 1, by, terms, message, at: at.toISOString(), prevHash: last?.hash ?? GENESIS };
  return { ...base, hash: sha256Hex(roundPayload(base)) };
}

export async function negotiate(input: NegotiationInput, hooks: NegotiationHooks): Promise<NegotiationResult> {
  const { vault } = input;
  const K = Math.max(1, Math.min(12, input.maxTurns ?? 6));
  const brief = initiatorBrief(vault);
  const policy = counterpartyPolicy(vault);
  const reserve = sellerReserve(vault);
  const forbidden = privateFigures(vault, "initiator");
  const rounds: PublicRound[] = [...(input.prior ?? [])];
  const operatorRounds: OperatorRoundDetail[] = [];
  const restructures: AetherProof["restructures"] = [];
  const usage = { input: 0, output: 0, liveTurns: 0 };
  const seenSignals = new Set<string>();
  let signals: CortexSignal[] = [];
  let model = "apex/deterministic-v1";

  const lastBy = (side: Side) => [...rounds].reverse().find((r) => r.by === side);
  const sellerStart = lastBy("initiator")?.terms.priceUsd ?? brief.anchorPriceUsd;
  const buyerStart = Math.max(policy.openingPriceUsd, Math.min(lastBy("counterparty")?.terms.priceUsd ?? 0, policy.reservePriceUsd));
  let ownLast: Terms | null = lastBy("initiator")?.terms ?? null;
  let theirLast: Terms | null = lastBy("counterparty")?.terms ?? null;

  const append = async (by: Side, terms: Terms, message: string, detail: OperatorRoundDetail | null) => {
    const round = chainRound(rounds, by, terms, message, hooks.now());
    rounds.push(round);
    if (detail) operatorRounds.push({ ...detail, n: round.n });
    await hooks.onRound(round, detail ? { ...detail, n: round.n } : null);
    return round;
  };

  const curve = (start: number, limit: number, k: number, beta: number) => {
    const t = K === 1 ? 1 : k / (K - 1);
    return start - (start - limit) * Math.pow(t, 1 / beta);
  };
  const buyerPrice = (k: number) => Math.min(policy.reservePriceUsd, Math.floor((buyerStart + (policy.reservePriceUsd - buyerStart) * (K === 1 ? 1 : k / (K - 1))) / 10) * 10);
  // The plan already respects Sovereign's per-turn step, so a clamp always means a model overreached.
  const maxStep = Math.max(10, (brief.anchorPriceUsd - reserve) * maxStepFraction(input.trust));
  const sellerPlanPrice = (k: number, beta: number, hold: number) => {
    const c = curve(sellerStart, reserve, k, beta);
    const p = ownLast ? Math.max(ownLast.priceUsd - (ownLast.priceUsd - c) * hold, ownLast.priceUsd - maxStep) : c;
    return Math.max(reserve, Math.min(ownLast?.priceUsd ?? Infinity, Math.ceil(p / 10) * 10));
  };

  for (let k = 0; k < K; k++) {
    if (await hooks.isCanceled()) return done("canceled", null);

    // ---- Provider turn: Cortex reads, Aether structures, Apex proposes, Sovereign enforces.
    signals = cortexRead(rounds, brief);
    for (const s of signals) {
      const key = `${s.kind}:${s.round}`;
      if (seenSignals.has(key)) continue;
      seenSignals.add(key);
      await hooks.onSignal("cortex", s.detail);
    }
    const beta = concessionBeta(signals, input.trust);
    const aeth = aetherTerms(ownLast?.netDays ?? null, theirLast?.netDays ?? null, brief.maxNetDays);
    if (aeth.restructured && ownLast) {
      restructures.push({ round: (rounds[rounds.length - 1]?.n ?? 0) + 1, fromNetDays: ownLast.netDays, toNetDays: aeth.netDays });
      await hooks.onSignal("aether", `Extended payment terms net ${ownLast.netDays} → net ${aeth.netDays} as the concession this turn; price movement halved to protect margin.`);
    }
    const sla = theirLast && slaRank(theirLast.slaTier) <= slaRank(brief.maxSlaTier) ? theirLast.slaTier : brief.maxSlaTier;
    const plan: Terms = { priceUsd: sellerPlanPrice(k, beta, priceHold(aeth.restructured)), netDays: aeth.netDays, slaTier: sla };
    const ctx: ApexContext = { turn: k, maxTurns: K, brief, plan, history: rounds, counterpartyMessage: lastBy("counterparty")?.message ?? input.counterpartyMessage, signals, posture: input.posture };

    let proposal: Awaited<ReturnType<Proposer>>;
    try {
      proposal = await input.apex(ctx);
    } catch (err) {
      await hooks.onSignal("apex", `Live proposal unavailable (${err instanceof Error ? err.message.slice(0, 80) : "error"}); deterministic synthesis used.`);
      proposal = await deterministicApex(ctx);
    }
    if (proposal.usage) {
      usage.input += proposal.usage.input;
      usage.output += proposal.usage.output;
      usage.liveTurns++;
    }
    if (proposal.model !== "apex/deterministic-v1") model = proposal.model;

    const clampCtx = { reservePriceUsd: reserve, previousPriceUsd: ownLast?.priceUsd ?? null, maxStepUsd: maxStep };
    let enforced = enforceInitiatorMandate(proposal.terms, vault.initiator, clampCtx);
    let clamps: Clamp[] = [];
    if ("rejected" in enforced) {
      clamps = [{ rule: "invalid", from: enforced.rejected, to: "plan" }];
      enforced = enforceInitiatorMandate(plan, vault.initiator, clampCtx);
      if ("rejected" in enforced) throw new Error("Deterministic plan failed mandate enforcement.");
    }
    clamps = [...clamps, ...enforced.clamps];
    let terms = enforced.terms;
    // Never offer less than the client has already put on the table (it was only held back by other terms).
    const theirBest = Math.max(0, ...rounds.filter((r) => r.by === "counterparty").map((r) => r.terms.priceUsd));
    const dominated = Math.min(theirBest, ownLast?.priceUsd ?? brief.anchorPriceUsd);
    if (terms.priceUsd < dominated) {
      clamps.push({ rule: "dominated", from: terms.priceUsd, to: dominated });
      terms = { ...terms, priceUsd: dominated };
    }
    // A clamped price makes the model's wording wrong; restate it deterministically instead.
    const priceClamped = clamps.some((c) => c.rule !== "net_terms" && c.rule !== "sla_tier");
    if (clamps.some((c) => c.rule === "dominated")) await hooks.onSignal("apex", `Held at the client's own standing offer ${usd(terms.priceUsd)}; only the payment terms remain open.`);
    const raw = priceClamped || !proposal.message.trim() ? (await deterministicApex({ ...ctx, plan: terms })).message : proposal.message;
    const scrubbed = scrubLeaks(raw, forbidden, [terms.priceUsd]);
    if (scrubbed.redactions) await hooks.onSignal("sovereign", `Redacted ${scrubbed.redactions} private figure${scrubbed.redactions === 1 ? "" : "s"} from Apex's message before release.`);
    const own = await append("initiator", terms, scrubbed.text, { n: 0, plan, proposal: proposal.terms, clamps, model: proposal.model, beta });
    if (clamps.length) await hooks.onClamp(own.n, clamps);
    ownLast = terms;
    await hooks.pace();

    // ---- Client proxy: accept if the provider's offer beats its own next planned offer.
    const bPrice = buyerPrice(k);
    if (terms.priceUsd <= bPrice && slaRank(terms.slaTier) >= slaRank(policy.requiredSlaTier)) {
      await append("counterparty", terms, `Accepted: ${usd(terms.priceUsd)}, net ${terms.netDays}, ${terms.slaTier} SLA.`, null);
      return done("agreement", terms);
    }
    const t = K === 1 ? 1 : k / (K - 1);
    const bDays = policy.targetNetDays > terms.netDays ? Math.round(policy.targetNetDays - (policy.targetNetDays - terms.netDays) * t) : policy.targetNetDays;
    const counter: Terms = { priceUsd: bPrice, netDays: bDays, slaTier: policy.requiredSlaTier };
    const opening = k === 0 && !input.prior?.length && input.counterpartyMessage ? `${input.counterpartyMessage.slice(0, 400)} ` : "";
    await append("counterparty", counter, `${opening}Counter: ${usd(bPrice)}, net ${bDays}, ${counter.slaTier} SLA.`.trim(), null);
    theirLast = counter;
    await hooks.pace();

    // ---- Provider acceptance: deterministic, against its own next planned price.
    const next = k + 1 < K ? sellerPlanPrice(k + 1, concessionBeta(cortexRead(rounds, brief), input.trust), 1) : reserve;
    const acceptable = counter.priceUsd >= Math.max(next, reserve) && counter.netDays <= brief.maxNetDays && slaRank(counter.slaTier) <= slaRank(brief.maxSlaTier);
    if (acceptable) {
      await append("initiator", counter, `Accepted: ${usd(counter.priceUsd)}, net ${counter.netDays}, ${counter.slaTier} SLA.`, { n: 0, plan: counter, proposal: null, clamps: [], model: "sovereign/acceptance", beta });
      return done("agreement", counter);
    }
  }
  return done("no_agreement", null);

  function done(outcome: NegotiationResult["outcome"], terms: Terms | null): NegotiationResult {
    return { outcome, terms, lastCounter: theirLast, rounds, operatorRounds, signals, restructures, usage, model };
  }
}
