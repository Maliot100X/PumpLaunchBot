import Link from "next/link";
import { Alert, Card, PageHeader } from "@/components/ui";

const CARDS = [
  {
    href: "/launch",
    title: "Launch",
    body: "Paste an existing token or describe a new one. The brain optimises it, you pick a mode, it goes on chain with your fee split baked in.",
  },
  {
    href: "/explore",
    title: "Explore",
    body: "Look up any Solana token: price, liquidity, the real description and links, from DexScreener and on-chain metadata.",
  },
  {
    href: "/launched",
    title: "Launched",
    body: "This platform's own launches, plus a live feed of what is launching on pump.fun right now.",
  },
  {
    href: "/agents",
    title: "Agents",
    body: "The platform brain: reads the vault, explains fee logic, looks tokens up, prepares launches. Same server code as the UI.",
  },
  {
    href: "/vault",
    title: "Vault",
    body: "Treasury status for sponsored launches: balance, the real rent cost per coin, and how many launches it covers.",
  },
  {
    href: "/settings",
    title: "Settings",
    body: "The live environment: fee split, pinning, RPC, sending gates. Answers what is actually configured before a launch.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader title="Launch a pump.fun coin properly.">
        Optimise an existing token, grind a vanity mint if you want one, then launch — signed by your own
        wallet, or sponsored by the platform treasury. Creator fees are split on chain through pump.fun’s
        own fee-sharing config, permanently, before the coin goes live.
      </PageHeader>

      <div className="mt-6">
        <Alert tone="warn" title="This deployment does not send transactions">
          The launch path builds every transaction and simulates it against mainnet, then stops. A real
          submit needs <code className="font-mono">NEXT_PUBLIC_ENABLE_SEND=true</code> (user-signed) or
          <code className="font-mono"> TREASURY_LIVE=true</code> plus a funded treasury (sponsored).
          Anything you see marked “prepared” has not been sent.
        </Alert>
      </div>

      <nav aria-label="Sections" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className="group block rounded-lg">
            <Card className="h-full p-4 transition-colors group-hover:border-white/20 group-hover:bg-white/[0.04] group-focus-visible:border-[#5e6ad2] group-active:bg-white/[0.06]">
              <div className="text-sm font-medium">{card.title}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-white/55">{card.body}</p>
            </Card>
          </Link>
        ))}
      </nav>
    </div>
  );
}
