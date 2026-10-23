"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/**
 * The wallet button is client-only: the adapters read `window` at import time.
 *
 * `dynamic(() => import(...), { ssr: false })` was the obvious choice and it SILENTLY FAILED here —
 * measured in the browser: the wrapper rendered `<!--$!--><template data-msg="Switched to client
 * rendering because a component requested it.">` and the button never appeared, leaving the header
 * with no way to connect a wallet. Rendering it behind a hydration flag instead works.
 *
 * Navigation, with the tab count this platform actually has:
 *  - every tab is a real route in src/app, so nothing here links to a page that does not exist
 *  - the tab list is grouped, because twelve flat tabs is a wall; groups are labelled on desktop
 *  - desktop: the grouped bar scrolls horizontally if the window is narrow, never wraps into a mess
 *  - mobile: a Menu button opens a full-width panel listing every tab grouped, with the active one
 *    marked; it closes on navigation and on Escape, and the trigger reports aria-expanded
 */

type Tab = { href: string; label: string };
type Group = { label: string; tabs: Tab[] };

const GROUPS: Group[] = [
  {
    label: "Launch",
    tabs: [
      { href: "/launch", label: "Launch" },
      { href: "/shield", label: "Shield" },
      { href: "/grinder", label: "Grinder" },
    ],
  },
  {
    label: "Plan",
    tabs: [
      { href: "/lab", label: "Launch Lab" },
      { href: "/kit", label: "Kit" },
      { href: "/splits", label: "Splits" },
      { href: "/pool", label: "Pool" },
    ],
  },
  {
    label: "Market",
    tabs: [
      { href: "/explore", label: "Explore" },
      { href: "/launched", label: "Launched" },
      { href: "/launchlab", label: "LaunchLab" },
    ],
  },
  {
    label: "Platform",
    tabs: [
      { href: "/agents", label: "Agents" },
      { href: "/vault", label: "Vault" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

const ALL_TABS: Tab[] = GROUPS.flatMap((g) => g.tabs);

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Hydration flag without setState-in-effect (the lint rule react-hooks/set-state-in-effect rejects
  // the useEffect version): false while server-rendering, true once the client is live.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const current = ALL_TABS.find((t) => isActive(t.href));

  const walletWrapperClass = [
    "shrink-0",
    // The wallet-adapter stylesheet ships its own design system (#512da8, 48px, DM Sans) and it sat
    // outside ours on every page. These overrides put the control on the app's own ramp.
    "[&_.wallet-adapter-button]:!h-9 [&_.wallet-adapter-button]:!px-3",
    "[&_.wallet-adapter-button]:!text-[13px] [&_.wallet-adapter-button]:!font-medium",
    "[&_.wallet-adapter-button]:!rounded-md [&_.wallet-adapter-button]:!bg-[#5e6ad2]",
    "[&_.wallet-adapter-button]:hover:!bg-[#4f59b8]",
    "[&_.wallet-adapter-button]:!font-[inherit] [&_.wallet-adapter-button]:!gap-1.5",
    "[&_.wallet-adapter-button:not([disabled])]:hover:!bg-[#4f59b8]",
    "[&_.wallet-adapter-button-trigger]:!bg-[#5e6ad2]",
    "[&_.wallet-adapter-button_span]:!text-[13px]",
  ].join(" ");

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08090a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#5e6ad2]" aria-hidden />
          <span className="hidden sm:inline">PumpLaunchBot</span>
        </Link>

        {/* Desktop / tablet: grouped tab bar, horizontally scrollable when it must be. */}
        <nav
          aria-label="Dashboard sections"
          className="-mx-1 hidden flex-1 items-center gap-3 overflow-x-auto px-1 md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {GROUPS.map((group) => (
            <div key={group.label} className="flex items-center gap-1">
              <span className="mr-1 hidden text-[10px] uppercase tracking-wide text-white/25 lg:inline">
                {group.label}
              </span>
              {group.tabs.map((tab) => {
                const active = isActive(tab.href);
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/60 hover:bg-white/5 hover:text-white focus-visible:bg-white/5"
                    }`}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Mobile: one button that shows/hides the whole tab list. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-tabs"
          className="ml-auto flex items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/80 transition-colors hover:border-white/30 hover:bg-white/5 active:bg-white/10 md:hidden"
        >
          <span className="text-xs">{current?.label ?? "Menu"}</span>
          <span aria-hidden className="text-[10px] text-white/50">
            {open ? "▲" : "▼"}
          </span>
          <span className="sr-only">{open ? "Hide tabs" : "Show tabs"}</span>
        </button>

        <div className={walletWrapperClass}>
          {mounted ? (
            <WalletMultiButton />
          ) : (
            // Same footprint as the real control, so the header does not jump on hydration.
            <span aria-hidden className="inline-block h-9 w-[8.5rem] animate-pulse rounded-md bg-white/10" />
          )}
        </div>
      </div>

      {/* Mobile panel: every tab, grouped, closed by navigation. */}
      {open ? (
        <div id="mobile-tabs" className="border-t border-white/10 bg-[#08090a] px-4 py-3 md:hidden">
          <div className="space-y-3">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] uppercase tracking-wide text-white/30">{group.label}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.tabs.map((tab) => {
                    const active = isActive(tab.href);
                    return (
                      <Link
                        key={tab.href}
                        href={tab.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-white/10 text-white"
                            : "border border-white/10 text-white/60 hover:border-white/25 hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  );
}
