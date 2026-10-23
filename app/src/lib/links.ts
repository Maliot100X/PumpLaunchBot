/**
 * Canonical links for a launched coin. Every one of these is a real, public URL built from the
 * mint address — no fabricated identifiers, no guesswork:
 *   pump.fun coin page   https://pump.fun/coin/<mint>
 *   DexScreener          https://dexscreener.com/solana/<mint>
 *   Solana explorer      https://solscan.io/token/<mint>
 *   pump.fun fee-sharing https://pump.fun/coin/<mint> (the creator-fee panel lives on the coin page)
 *
 * The platform's own explore view is a route in this app, so it is returned as a path.
 */

export type TokenLinks = {
  mint: string;
  pumpFun: string;
  dexScreener: string;
  explorer: string;
  platformExplore: string;
  /** The same view as an absolute URL — for sharing, bots and Telegram, where a path is useless. */
  platformExploreAbsolute: string;
};

/**
 * Absolute URL for a path in this app. Comes from NEXT_PUBLIC_APP_URL, which Vercel sets after the
 * first deploy; without it the path is returned unchanged so local development keeps working.
 */
export function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function tokenLinks(mint: string): TokenLinks {
  const platformExplore = `/explore?mint=${mint}`;
  return {
    mint,
    pumpFun: `https://pump.fun/coin/${mint}`,
    dexScreener: `https://dexscreener.com/solana/${mint}`,
    explorer: `https://solscan.io/token/${mint}`,
    platformExplore,
    platformExploreAbsolute: absoluteUrl(platformExplore),
  };
}

/** Transactions are worth showing too — a launch receipt is a signature, not a screen. */
export function txLink(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

/** Account link for a wallet (treasury, fee receiver). */
export function accountLink(address: string): string {
  return `https://solscan.io/account/${address}`;
}
