/**
 * An external procurement agent negotiating with Bloom Exchange on its own.
 *
 *   node examples/external-buyer-agent.ts                       (Node 23.6+; runs the TypeScript directly)
 *   BLOOM_EXCHANGE_URL=https://your-bloom.app BLOOM_ACCESS_KEY=BLOOMK-… node examples/external-buyer-agent.ts
 *   OPENAI_API_KEY=sk-… node examples/external-buyer-agent.ts   (optional: the agent drafts its own opening note)
 *
 * The agent derives a sealed mandate from its procurement brief, streams the negotiation, and if Bloom escalates
 * (its counter fell outside the provider's mandate) it decides for itself whether its board-approved budget allows
 * a revised mandate, resumes once, and finally verifies the BLOOM-XCH certificate offline.
 */
import { BloomExchangeClient, type BuyerMandate } from "../src/index.ts";

const brief = {
  need: "Managed observability platform, 12-month enterprise license",
  targetPriceUsd: 46_000,
  boardApprovedMaxUsd: 52_000,
  requiredSla: "gold" as const,
  preferredNetDays: 60,
};

function mandateFrom(b: typeof brief, stretch = 0): BuyerMandate {
  const ceiling = Math.min(b.boardApprovedMaxUsd, Math.round(b.targetPriceUsd * (1.06 + stretch)));
  return { ceilingPriceUsd: ceiling, maxBudgetUsd: b.boardApprovedMaxUsd, requiredSlaTier: b.requiredSla, targetNetDays: b.preferredNetDays, openingPriceUsd: Math.round(b.targetPriceUsd * 0.78) };
}

async function openingNote(): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  const fallback = `We're consolidating observability vendors this quarter and can move fast for the right terms. Gold SLA is a must; we prefer net ${brief.preferredNetDays}.`;
  if (!key) return fallback;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 120, messages: [{ role: "user", content: `In two sentences, open a B2B price negotiation for: ${brief.need}. Must have gold SLA, prefer net ${brief.preferredNetDays}. Do not state any budget.` }] }),
    });
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

async function main() {
  const bloom = new BloomExchangeClient({
    baseUrl: process.env.BLOOM_EXCHANGE_URL ?? "http://localhost:3000",
    accessKey: process.env.BLOOM_ACCESS_KEY,
    agent: { name: "acme-procurement-agent", framework: process.env.OPENAI_API_KEY ? "openai" : "bloom-sdk" },
  });
  const card = await bloom.connect();
  console.log(`✓ ${card.name} ${card.version} · agent card signature verified · skills: ${card.skills.map((s) => s.id).join(", ")}`);

  let run = bloom.negotiate({ mandate: mandateFrom(brief), item: { description: brief.need }, message: await openingNote(), paymentRail: "stripe" });
  for (let attempt = 0; ; attempt++) {
    for await (const e of run) {
      if (e.type === "firewall") console.log(`  shield  ${e.verdict}${e.threats.length ? ` (${e.threats.length} vectors)` : ""}`);
      if (e.type === "round") console.log(`  R${String(e.round.n).padStart(2)} ${e.round.by === "initiator" ? "bloom " : "us    "} ${usd(e.round.terms.priceUsd).padStart(9)}  net ${e.round.terms.netDays}  ${e.round.terms.slaTier}`);
      if (e.type === "state" && e.state === "input_required") console.log(`  ⚠ ${e.reason}`);
    }
    const { task, state, certificate } = await run.result;
    if (state === "completed" && certificate) {
      const proof = await bloom.verifyCertificate(certificate);
      console.log(`\n${certificate.certificateId} · ${usd(certificate.terms.priceUsd)} · net ${certificate.terms.netDays} (due ${certificate.terms.paymentDueDate}) · ${certificate.terms.slaTier} SLA`);
      console.log(`verification: ${proof.valid ? "VALID" : `INVALID (${proof.reason})`} · ${Object.entries(proof.checks).map(([k, v]) => `${k}:${v ? "✓" : "✗"}`).join(" ")}`);
      console.log(`AP2 payment mandate: ${certificate.ap2.paymentMandate.id} · rail ${certificate.settlement.preferredRail} · binding ${certificate.settlement.binding}`);
      return;
    }
    if (state === "input_required" && attempt === 0 && task.metadata["bloom.awaiting"] === "revised_mandate_or_executive") {
      const revised = mandateFrom(brief, 0.07);
      console.log(`\nagent: still inside board approval, stretching ceiling to ${usd(revised.ceilingPriceUsd)} and resuming…`);
      run = bloom.resume(task.id, revised);
      continue;
    }
    console.log(`\nfinished: ${state}${task.status.message?.parts[0]?.text ? ` · ${task.status.message.parts[0].text}` : ""}`);
    return;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
