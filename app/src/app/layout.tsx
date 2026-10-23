import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { SolanaProvider } from "@/components/providers/solana-provider";
import { Nav } from "@/components/nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PumpLaunchBot",
  description:
    "AI-optimised pump.fun launches: recreate a token, grind a vanity CA, launch into your own wallet or let the platform sponsor it, with an on-chain 70/30 creator-fee split.",
};

/**
 * Web Interface Guidelines: the browser chrome should match the page, and the dark theme should be
 * declared so form controls and scrollbars render dark instead of light.
 */
export const viewport: Viewport = {
  themeColor: "#08090a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#08090a] text-white">
        <SolanaProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-[#5e6ad2] focus:px-3 focus:py-2 focus:text-sm focus:text-white"
          >
            Skip to main content
          </a>
          <Nav />
          <main id="main" className="flex-1">
            {children}
          </main>
        </SolanaProvider>
      </body>
    </html>
  );
}
