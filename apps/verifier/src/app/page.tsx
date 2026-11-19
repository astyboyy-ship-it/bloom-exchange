import { LiveFeed } from "@/components/LiveFeed";
import { VerifyBox } from "@/components/VerifyBox";

export default function Home() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify any Bloom receipt</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Two agents cleared a deal and both signed the receipt. Check both Ed25519 signatures, the canonical hash, the ledger&apos;s Merkle inclusion proof and, if you hold one, a mandate opening. No trust in the relay required.
        </p>
      </div>
      <VerifyBox />
      <LiveFeed />
    </div>
  );
}
