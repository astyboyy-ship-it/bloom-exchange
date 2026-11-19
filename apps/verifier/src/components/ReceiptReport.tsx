"use client";

import Link from "next/link";
import { useState } from "react";
import { verifyRelayReceipt, type MandateOpening, type ReceiptPayload, type ReceiptVerification } from "@bloom-exchange/sdk";
import { formatAtomic, short } from "@/lib/relay";
import { Badge, toneOf } from "./Badge";

const SEALED_NOTE = "Both parties signed commitments to their mandates. Paste a mandate opening (mandate + salt) below to check the cleared price against it.";

/** The verdict and the evidence for one receipt. Re-verifies locally whenever a mandate opening is added. */
export function ReceiptReport({ payload, initial }: { payload: Pick<ReceiptPayload, "receipt" | "signatures"> & Partial<ReceiptPayload>; initial: ReceiptVerification }) {
  const [result, setResult] = useState(initial);
  const [openingText, setOpeningText] = useState("");
  const [openings, setOpenings] = useState<MandateOpening[]>([]);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const r = payload.receipt;
  const c = result.checks;

  async function addOpening() {
    setOpeningError(null);
    let parsed: MandateOpening;
    try {
      parsed = JSON.parse(openingText) as MandateOpening;
      if (!parsed?.mandate || typeof parsed.salt !== "string") throw new Error();
    } catch {
      setOpeningError("Paste an opening as JSON: { \"mandate\": { \"vertical\", \"role\", \"currency\", \"limitAtomic\" }, \"salt\" }.");
      return;
    }
    const next = [...openings.filter((o) => o.mandate.role !== parsed.mandate.role), parsed];
    setOpenings(next);
    setResult(await verifyRelayReceipt({ receipt: payload.receipt, signatures: payload.signatures, hash: payload.hash, ledger: payload.ledger, revoked: payload.revoked }, next));
    setOpeningText("");
  }

  return (
    <div className="space-y-8">
      <section aria-live="polite" className="rounded-xl border border-line bg-surface p-5">
        <div className="text-sm text-muted">Verdict</div>
        <div className="mt-1 text-2xl font-semibold" style={{ color: result.valid ? "var(--pass)" : "var(--fail)" }}>
          {result.valid ? "Valid receipt" : "Not valid"}
        </div>
        {result.problems.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm" style={{ color: "var(--fail)" }}>
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Badge label="Buyer signature" tone={c.buyerSignature} detail={`Ed25519 by ${short(r.buyer.pubkey, 8)} over the receipt hash.`} />
        <Badge label="Seller signature" tone={c.sellerSignature} detail={`Ed25519 by ${short(r.seller.pubkey, 8)} over the receipt hash.`} />
        <Badge label="Mandate bounds" tone={toneOf(c.mandateBounds)} detail={c.mandateBounds === "sealed" ? SEALED_NOTE : c.mandateBounds === "pass" ? `The cleared price sits inside every opened mandate (${openings.map((o) => o.mandate.role).join(", ") || "as supplied"}).` : "An opening does not match its commitment, or the price is outside it."} />
        <Badge label="Ledger inclusion" tone={toneOf(c.ledgerInclusion)} detail={c.ledgerInclusion === "unavailable" ? "No Merkle proof was supplied with this receipt." : `RFC 6962 proof for leaf ${payload.ledger?.leafIndex} of ${payload.ledger?.treeSize} against the relay's root.`} />
        <Badge label="Canonical hash" tone={c.canonicalHash} detail="SHA-256 of the receipt's canonical JSON matches its hash." />
        <Badge label="Ledger status" tone={result.revoked ? "fail" : payload.revoked === undefined ? "idle" : "pass"} detail={result.revoked ? "The relay marks this receipt revoked." : payload.revoked === undefined ? "Unknown: this receipt was pasted, not fetched." : "Not revoked."} />
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Open a mandate</h2>
        <p className="mt-1 text-sm text-muted">Only the party who sealed a mandate holds its opening. Nothing you paste leaves this page.</p>
        <textarea value={openingText} onChange={(e) => setOpeningText(e.target.value)} rows={4} spellCheck={false} className="mt-3 w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs" placeholder='{"mandate":{"vertical":"compute.gpu","role":"buyer","currency":"USD","limitAtomic":"912345"},"salt":"…"}' aria-label="Mandate opening JSON" />
        {openingError && <p className="mt-2 text-sm" style={{ color: "var(--fail)" }}>{openingError}</p>}
        <button type="button" onClick={addOpening} disabled={!openingText.trim()} className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">
          Check against the commitment
        </button>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Receipt</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">Vertical</dt>
          <dd className="font-mono">{r.vertical}</dd>
          <dt className="text-muted">Cleared price</dt>
          <dd className="font-mono">{formatAtomic(r.priceAtomic, r.currency)}</dd>
          <dt className="text-muted">Buyer</dt>
          <dd className="break-all font-mono">
            <Link className="text-accent underline-offset-2 hover:underline" href={`/a/${r.buyer.pubkey}`}>{r.buyer.pubkey}</Link>
          </dd>
          <dt className="text-muted">Seller</dt>
          <dd className="break-all font-mono">
            <Link className="text-accent underline-offset-2 hover:underline" href={`/a/${r.seller.pubkey}`}>{r.seller.pubkey}</Link>
          </dd>
          <dt className="text-muted">Rounds</dt>
          <dd className="font-mono">{r.rounds} counter-offer{r.rounds === 1 ? "" : "s"}</dd>
          <dt className="text-muted">Opened / accepted</dt>
          <dd className="font-mono">{r.openedAt} → {r.acceptedAt}</dd>
          <dt className="text-muted">Relay</dt>
          <dd className="break-all font-mono">{r.relay}</dd>
          <dt className="text-muted">Transcript head</dt>
          <dd className="break-all font-mono text-xs">{r.transcriptHead}</dd>
          {payload.hash && (
            <>
              <dt className="text-muted">Receipt hash</dt>
              <dd className="break-all font-mono text-xs">{payload.hash}</dd>
            </>
          )}
          {payload.ledger && (
            <>
              <dt className="text-muted">Ledger root</dt>
              <dd className="break-all font-mono text-xs">{payload.ledger.root}</dd>
            </>
          )}
        </dl>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted">Terms and raw receipt</summary>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-bg p-3 font-mono text-xs">{JSON.stringify(payload, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}
