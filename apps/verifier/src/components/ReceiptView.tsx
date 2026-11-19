"use client";

import { useEffect, useState } from "react";
import { verifyRelayReceipt, type ReceiptPayload, type ReceiptVerification } from "@bloom-exchange/sdk";
import { fetchReceipt, HEX64, RelayFetchError } from "@/lib/relay";
import { ReceiptReport } from "./ReceiptReport";

/** Fetches a receipt by hash from the relay and verifies it here, in the browser. */
export function ReceiptView({ hash }: { hash: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; payload: ReceiptPayload; result: ReceiptVerification }>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    if (!HEX64.test(hash)) {
      setState({ kind: "error", message: "A receipt hash is 64 lowercase hex characters." });
      return;
    }
    (async () => {
      try {
        const payload = await fetchReceipt(hash);
        // The relay's payload is only data: the verdict comes from recomputing everything here.
        const result = await verifyRelayReceipt({ ...payload, hash });
        if (live) setState({ kind: "ready", payload, result });
      } catch (err) {
        if (live) setState({ kind: "error", message: err instanceof RelayFetchError && err.status === 404 ? "The relay has no cleared receipt with this hash." : err instanceof Error ? err.message : "Verification failed." });
      }
    })();
    return () => {
      live = false;
    };
  }, [hash]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Receipt</h1>
        <p className="mt-1 break-all font-mono text-xs text-muted">{hash}</p>
      </div>
      {state.kind === "loading" && <p className="text-muted">Fetching and verifying…</p>}
      {state.kind === "error" && (
        <p className="rounded-lg border border-line bg-surface p-4" style={{ color: "var(--fail)" }}>
          {state.message}
        </p>
      )}
      {state.kind === "ready" && <ReceiptReport payload={state.payload} initial={state.result} />}
    </div>
  );
}
