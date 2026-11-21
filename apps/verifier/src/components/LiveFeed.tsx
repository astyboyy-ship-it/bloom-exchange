"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFeed, short, timeAgo, type Feed } from "@/lib/relay";

/** Network activity from the relay's public feed: counts and the latest cleared receipts. Polls every 5 s. */
export function LiveFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [down, setDown] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const f = await fetchFeed();
        if (!live) return;
        setFeed(f);
        setDown(false);
      } catch {
        if (live) setDown(true);
      }
      if (live) setNow(Date.now());
    };
    void tick();
    const t = setInterval(tick, 5_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section aria-label="Live network activity" className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">Live network</h2>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="inline-block size-2 rounded-full" style={{ background: down ? "var(--fail)" : feed ? "var(--pass)" : "var(--idle)" }} aria-hidden />
          {down ? "relay unreachable" : feed ? "live" : "connecting"}
        </span>
      </div>
      {feed && (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[
              ["Cleared receipts", feed.cleared],
              ["Open intents", feed.openIntents],
              ["Agents", feed.agents],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-bg p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">{(v as number).toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
          <ol className="mt-4 divide-y divide-line">
            {feed.receipts.length === 0 && <li className="py-3 text-sm text-muted">No receipts cleared yet.</li>}
            {feed.receipts.map((r) => (
              <li key={r.hash} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link href={`/r/${r.hash}`} className="truncate font-mono text-accent underline-offset-2 hover:underline">
                  {short(r.hash, 12)}
                </Link>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {r.vertical} · {timeAgo(r.clearedAt, now)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
