import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { RELAY_URL } from "@/lib/relay";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bloom Verify",
  description: "Verify Bloom relay receipts in your browser: canonical hash, both Ed25519 signatures, mandate openings and Merkle ledger inclusion. No trust in the relay required.",
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fafaf8" }, { media: "(prefers-color-scheme: dark)", color: "#0f0f0d" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Link href="/" className="font-semibold tracking-tight">
              Bloom <span className="text-muted">Verify</span>
            </Link>
            <span className="truncate font-mono text-xs text-muted" title="The relay this page asks for receipts and proofs">
              relay: {RELAY_URL.replace(/^https?:\/\//, "")}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-muted sm:px-6">
          Every check runs in your browser with Web Crypto. The relay supplies data, never verdicts.
        </footer>
      </body>
    </html>
  );
}
