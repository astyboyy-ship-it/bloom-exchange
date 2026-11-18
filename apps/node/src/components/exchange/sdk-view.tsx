"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, ShieldAlert, ShieldCheck, Terminal } from "lucide-react";
import { useExchangeCopy } from "./copy";
import { Badge, Panel, PanelHeader } from "./ui";
import type { Exchange } from "./use-exchange";

export const quickstart = (origin: string) => `import { BloomExchangeClient } from "@bloom-exchange/sdk";

const bloom = new BloomExchangeClient({ baseUrl: "${origin}" });
const run = bloom.negotiate({ mandate: { ceilingPriceUsd: 52_000, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 45 }, item: { description: "12-month license" } });
const { certificate } = await run.result;
console.log(await bloom.verifyCertificate(certificate!)); // { valid: true, checks: { digest, certificateId, chain, signature, ap2Proofs } }`;

const resources = `const run = bloom.negotiate({
  mandate: {
    ceilingPriceUsd: 68_000, maxBudgetUsd: 72_000, requiredSlaTier: "gold", targetNetDays: 30,
    resources: {
      computeUnits: { quantity: 90_000, minQuantity: 60_000 },
      energyKwh:    { quantity: 30_000 },
      bandwidthGbps:{ quantity: 25, minQuantity: 10 },
    },
  },
  item: { description: "Q1 inference capacity" },
  paymentRail: "x402",
});
for await (const e of run) if (e.type === "round") console.log(e.round.n, e.round.terms.priceUsd);
const { certificate } = await run.result;   // certificate.resources.allocation + per-dimension proofs`;

const curl = (origin: string) => `curl -N ${origin}/api/exchange/a2a \\
  -H "Content-Type: application/json" -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"SendStreamingMessage","params":{"message":{"messageId":"m1","role":"user",
       "parts":[{"kind":"data","data":{"bloomExchange":{"mandate":{"ceilingPriceUsd":52000,"maxBudgetUsd":55000,
       "requiredSlaTier":"gold","targetNetDays":45},"item":{"description":"12-month license"}}}}]}}}'`;

function Code({ title, code }: { title: string; code: string }) {
  const t = useExchangeCopy().sdk;
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-x-ink/40">{title}</p>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            })
          }
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-x-ink/45 hover:text-x-ink"
        >
          {copied ? <Check className="size-3 text-[var(--xch-verified)]" /> : <Copy className="size-3" />} {copied ? t.copied : t.copy}
        </button>
      </div>
      <pre className="tnum mt-1.5 overflow-auto rounded-[10px] border border-[var(--xch-line)] bg-x-ink/25 p-3.5 font-mono text-[11px] leading-relaxed text-x-ink/75" dir="ltr">
        {code}
      </pre>
    </div>
  );
}

export function SdkView({ x }: { x: Exchange }) {
  const t = useExchangeCopy().sdk;
  const [origin, setOrigin] = useState("https://your-bloom.app");
  useEffect(() => setOrigin(window.location.origin), []);
  const card = x.card;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <Panel className="space-y-5 xl:col-span-8">
        <PanelHeader icon={Terminal} title={t.title} sub={t.sub} />
        <Code title={t.install} code="npm install @bloom-exchange/sdk" />
        <Code title={t.quickstart} code={quickstart(origin)} />
        <Code title={t.resources} code={resources} />
        <Code title={t.curl} code={curl(origin)} />
      </Panel>

      <div className="space-y-4 xl:col-span-4">
        <Panel>
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-x-ink/40">{t.endpoint}</p>
            {card && (
              <Badge tone={card.verified ? "emerald" : "amber"}>
                {card.verified ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
                {card.verified ? t.verified : t.unverified}
              </Badge>
            )}
          </div>
          <a href="/.well-known/agent-card.json" target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1.5 truncate rounded-md border border-[var(--xch-line)] bg-x-ink/[0.025] px-2.5 py-1.5 font-mono text-[11px] text-x-ink/80 hover:text-x-ink" dir="ltr">
            <span className="truncate">{origin}/.well-known/agent-card.json</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
          {card && (
            <dl className="tnum mt-3 space-y-1.5 font-mono text-[10.5px]" dir="ltr">
              {[
                ["kid", card.keys[0]?.kid ?? "—"],
                ["bindings", card.card.supportedInterfaces.map((i) => i.protocolBinding).join(" · ")],
                ["skills", card.card.skills.map((s) => s.id).join(", ")],
                ["version", card.card.version],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-16 shrink-0 text-x-ink/35">{k}</dt>
                  <dd className="min-w-0 break-all text-x-ink/70">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
        <Panel>
          <ol className="space-y-3">
            {t.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[22px_1fr] gap-2">
                <span className="tnum font-mono text-[10px] text-[var(--xch-verified)]">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[12px] leading-relaxed text-x-ink/70">{s}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
