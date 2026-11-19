import type { Metadata } from "next";
import { ReceiptView } from "@/components/ReceiptView";

export async function generateMetadata({ params }: { params: Promise<{ hash: string }> }): Promise<Metadata> {
  const { hash } = await params;
  return { title: `Receipt ${hash.slice(0, 12)}… · Bloom Verify` };
}

export default async function ReceiptPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  return <ReceiptView hash={hash.toLowerCase()} />;
}
