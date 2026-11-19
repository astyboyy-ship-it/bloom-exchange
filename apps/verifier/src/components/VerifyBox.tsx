"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { verifyRelayReceipt, type ReceiptPayload, type ReceiptVerification } from "@bloom-exchange/sdk";
import { HEX64 } from "@/lib/relay";
import { ReceiptReport } from "./ReceiptReport";

/** Paste a receipt hash (opens /r/<hash>) or a whole receipt payload (verified right here, offline). */
export function VerifyBox() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<{ payload: ReceiptPayload; result: ReceiptVerification } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLocal(null);
    const v = input.trim();
    if (HEX64.test(v.toLowerCase())) {
      router.push(`/r/${v.toLowerCase()}`);
      return;
    }
    let payload: ReceiptPayload;
    try {
      payload = JSON.parse(v) as ReceiptPayload;
    } catch {
      setError("Paste a 64-hex receipt hash, or a receipt as JSON.");
      return;
    }
    if (!payload?.receipt || !payload.signatures) {
      setError("That JSON has no `receipt` and `signatures`: paste the payload GET /v1/receipts/:hash returns.");
      return;
    }
    setLocal({ payload, result: await verifyRelayReceipt({ receipt: payload.receipt, signatures: payload.signatures, hash: payload.hash, ledger: payload.ledger ?? null, revoked: payload.revoked }) });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-5">
        <label htmlFor="receipt" className="font-medium">
          Verify a receipt
        </label>
        <p className="mt-1 text-sm text-muted">A receipt hash, or the full receipt JSON. Pasted receipts are verified in this tab and sent nowhere.</p>
        <textarea id="receipt" value={input} onChange={(e) => setInput(e.target.value)} rows={5} spellCheck={false} className="mt-3 w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs" placeholder="3f9a… (64 hex) or { &quot;receipt&quot;: …, &quot;signatures&quot;: … }" />
        {error && <p className="mt-2 text-sm" style={{ color: "var(--fail)" }}>{error}</p>}
        <button type="submit" disabled={!input.trim()} className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">
          Verify
        </button>
      </form>
      {local && <ReceiptReport payload={local.payload} initial={local.result} />}
    </div>
  );
}
