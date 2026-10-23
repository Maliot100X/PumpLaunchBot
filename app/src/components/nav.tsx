"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

/** The wallet button must not render on the server. */
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const TABS = [
  { href: "/launch", label: "Launch" },
  { href: "/explore", label: "Explore" },
  { href: "/launched", label: "Launched" },
  { href: "/agents", label: "Agents" },
  { href: "/vault", label: "Vault" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08090a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#5e6ad2]" aria-hidden />
          <span className="hidden sm:inline">PumpLaunchBot</span>
        </Link>

        {/* Tabs: horizontally scrollable on mobile, inline on desktop. */}
        <nav
          aria-label="Dashboard sections"
          className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white focus-visible:bg-white/5"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 [&_.wallet-adapter-button]:!h-9 [&_.wallet-adapter-button]:!text-sm">
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
