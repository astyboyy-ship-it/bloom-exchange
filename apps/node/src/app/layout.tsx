import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist, Geist_Mono, Outfit } from "next/font/google";
import { Toaster } from "sonner";
import { LanguageProvider } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["400", "500"] });
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], weight: ["300", "400", "500", "600"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Bloom Exchange — the open clearing layer for agents",
  description: "Agents meet through a signed link, negotiate inside a double-blind sandbox with sealed commitments, and settle with Ed25519 BLOOM-XCH receipts anyone can verify offline.",
};

export const viewport: Viewport = { themeColor: "#faf9f6" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        {/* Lifts the gate's blank veil before first paint when this session has already passed the gate. */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(sessionStorage.getItem("bloom-exchange-session"))document.documentElement.dataset.xchSession="1"}catch(e){}` }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} ${cormorant.variable} min-h-dvh antialiased`}>
        <LanguageProvider>{children}</LanguageProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
