import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { GrinderClient } from "./grinder-client";

export const metadata: Metadata = {
  title: "Grinder · PumpLaunchBot",
  description:
    "Grind a vanity Solana address in this browser: a prefix, a suffix or both, live odds, a measured keys-per-second rate and an expectations table. Nothing is uploaded and nothing is stored.",
};

/**
 * Grinder — the shell. The tab is entirely a client surface (keypair generation, the search loop,
 * clipboard and a Blob download), so this page stays a static shell: no request-time data, no
 * <Suspense> boundary, no RPC of any kind.
 */
export default function GrinderPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Grinder">
        Make your contract address impossible to fake. Type the characters you want at the start, the
        end, or both — the keypair is generated here in the browser, matched here, and never sent
        anywhere. Save every result you want to keep: nothing is stored for you. The table at the
        bottom costs every pattern out before you start, using this engine&apos;s own arithmetic and a
        rate measured on your device — not a number from a sales page.
      </PageHeader>

      <GrinderClient />
    </div>
  );
}
