import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { LabClient } from "./lab-client";

export const metadata: Metadata = {
  title: "Launch Lab · PumpLaunchBot",
  description:
    "Simulate a pump.fun launch: dev buy, bundled wallets, ownership, market cap and graduation against the published bonding-curve constants. A model, not a promise.",
};

/**
 * Launch Lab — the shell. The tab is entirely client-side arithmetic (see lab-client.tsx): there is
 * no request-time data to read here, so this page stays a static shell with no <Suspense> boundary
 * and no RPC of any kind.
 */
export default function LabPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader title="Launch Lab">
        Test your launch before you ship it. A constant-product curve with pump.fun&apos;s published
        parameters — see who owns what after your dev buy and any bundled wallets, where the price
        ends up, and how far a graduation still is. It is a simulator: no wallet, no network, nothing
        sent.
      </PageHeader>

      <LabClient />
    </div>
  );
}
