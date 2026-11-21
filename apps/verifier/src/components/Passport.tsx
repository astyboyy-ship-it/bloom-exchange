"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Reputation } from "@bloom-exchange/sdk";
import { fetchReputation, PUBKEY, RelayFetchError, short, timeAgo } from "@/lib/relay";

const ms = (v: number | null) => (v === null ? "—" : v < 1000 ? `${v} ms` : v < 60_000 ? `${(v / 1000).toFixed(1)} s` : `${(v / 60_000).toFixed(1)} min`);

/** An agent's public record on the relay, keyed by its Ed25519 public key. */
export function Passport({ pubkey }: { pubkey: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; rep: Reputation }>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    if (!PUBKEY.test(pubkey)) {
      setState({ kind: "error", message: "An agent key is 43 base64url characters." });
      return;
    }
    fetchReputation(pubkey)
      .then((rep) => live && setState({ kind: "ready", rep }))
      .catch((err) => live && setState({ kind: "error", message: err instanceof RelayFetchError && err.status === 404 ? "The relay has no agent with this key." : "The relay could not be reached." }));
    return () => {
      live = false;
    };
  }, [pubkey]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Agent passport</h1>
        <p className="mt-1 break-all font-mono text-xs text-muted">{pubkey}</p>
      </div>
      {state.kind === "loading" && <p className="text-muted">Loading…</p>}
      {state.kind === "error" && (
        <p className="rounded-lg border border-line bg-surface p-4" style={{ color: "var(--fail)" }}>
          {state.message}
        </p>
      )}
      {state.kind === "ready" && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Completed deals", state.rep.completedDeals.toLocaleString("en-US")],
              ["Dispute rate", `${(state.rep.disputeRate * 100).toFixed(1)}%`],
              ["Median time to clear", ms(state.rep.medianLatencyMs)],
              ["Domain", state.rep.domain ? `${state.rep.domain}${state.rep.domainVerified ? " ✓" : " (claimed)"}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface p-4">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-1 break-words font-mono">{v}</dd>
              </div>
            ))}
          </dl>
          {state.rep.org && <p className="text-sm text-muted">Organization (self-declared): {state.rep.org}</p>}
          <p className="text-xs text-muted">Domains and organizations are claimed by the agent and not yet verified by the relay. Deals, disputes and timing come from cleared receipts.</p>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-medium">Recent cleared receipts</h2>
            <ol className="mt-3 divide-y divide-line">
              {state.rep.recentReceipts.length === 0 && <li className="py-3 text-sm text-muted">None yet.</li>}
              {state.rep.recentReceipts.map((r) => (
                <li key={r.hash} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/r/${r.hash}`} className="truncate font-mono text-accent underline-offset-2 hover:underline">
                    {short(r.hash, 12)}
                  </Link>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {r.vertical} · {timeAgo(r.clearedAt)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
