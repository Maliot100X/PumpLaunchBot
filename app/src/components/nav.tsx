"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/**
 * The wallet button is client-only: the adapters read `window` at import time.
 *
 * `dynamic(() => import(...), { ssr: false })` was the obvious choice and it SILENTLY FAILED here —
 * measured in the browser: the wrapper rendered `<!--$!--><template data-msg="Switched to client
 * rendering because a component requested it.">` and the button never appeared, leaving the header
 * with no way to connect a wallet. Rendering it behind a hydration flag instead works, because the
 * component is only created after mount.
 */
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

        <div
          className={[
            "shrink-0",
            // Design-review fix #3: the wallet-adapter stylesheet ships its own design system
            // (#512da8, 48px tall, DM Sans) and it sat outside ours on every page. These overrides
            // put the control on the app's own ramp without touching the vendor package.
            "[&_.wallet-adapter-button]:!h-9 [&_.wallet-adapter-button]:!px-3",
            "[&_.wallet-adapter-button]:!text-[13px] [&_.wallet-adapter-button]:!font-medium",
            "[&_.wallet-adapter-button]:!rounded-md [&_.wallet-adapter-button]:!bg-[#5e6ad2]",
            "[&_.wallet-adapter-button]:hover:!bg-[#4f59b8]",
            "[&_.wallet-adapter-button]:!font-[inherit] [&_.wallet-adapter-button]:!gap-1.5",
            "[&_.wallet-adapter-button:not([disabled])]:hover:!bg-[#4f59b8]",
            "[&_.wallet-adapter-button-trigger]:!bg-[#5e6ad2]",
            "[&_.wallet-adapter-button_span]:!text-[13px]",
          ].join(" ")}
        >
          {mounted ? (
            <WalletMultiButton />
          ) : (
            // Same footprint as the real control, so the header does not jump on hydration.
            <span
              aria-hidden
              className="inline-block h-9 w-[8.5rem] animate-pulse rounded-md bg-white/10"
            />
          )}
        </div>
      </div>
    </header>
  );
}
