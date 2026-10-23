import Link from "next/link";

const CARDS = [
  {
    href: "/launch",
    title: "Launch",
    body: "Paste an existing token or describe a new one. The brain optimises it, you pick a mode, it goes on chain with your fee split baked in.",
  },
  {
    href: "/explore",
    title: "Explore",
    body: "Look up any Solana token: price, liquidity, the real description and links, pulled from DexScreener and on-chain metadata.",
  },
  {
    href: "/launched",
    title: "Launched",
    body: "Every coin this platform has created, with its curve progress, fee config and the wallets the fees flow to.",
  },
  {
    href: "/agents",
    title: "Agents",
    body: "The platform brain: launch, check the treasury, inspect fee logic. Same API the dashboard uses — no second implementation.",
  },
  {
    href: "/vault",
    title: "Vault",
    body: "Treasury status for sponsored launches: balance, rent budget per coin, and the ledger of what was spent on what.",
  },
  {
    href: "/settings",
    title: "Settings",
    body: "Fee split in basis points, default launch mode, metadata gateway and RPC. Everything that must be right before a real launch.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Launch a pump.fun coin properly.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
        Optimise an existing token, grind a vanity mint if you want one, then launch — signed by
        your own wallet, or sponsored by the platform treasury. Creator fees are split on chain
        through pump.fun&apos;s own fee-sharing config, permanently, before the coin goes live.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-lg border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.04] focus-visible:border-[#5e6ad2] focus-visible:outline-none"
          >
            <div className="text-sm font-medium">{card.title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-white/55">{card.body}</p>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-xs text-white/40">
        Phases: 1 data layer · 2 metadata + wallet + shell · 3 launch flow · 4 fee sharing · 5 vanity
        grinding · 6 tracking · 7 bot brain · 8 deploy.
      </p>
    </div>
  );
}
