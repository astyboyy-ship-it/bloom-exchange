import type { Metadata } from "next";
import { Passport } from "@/components/Passport";

export async function generateMetadata({ params }: { params: Promise<{ pubkey: string }> }): Promise<Metadata> {
  const { pubkey } = await params;
  return { title: `Agent ${pubkey.slice(0, 10)}… · Bloom Verify` };
}

export default async function PassportPage({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  return <Passport pubkey={pubkey} />;
}
