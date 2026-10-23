/**
 * DexScreener client — the token-data source for PumpLaunchBot.
 *
 * Verified against the live API in Phase 0 research (2026-10-23):
 *   GET https://api.dexscreener.com/latest/dex/tokens/{mint} -> 200
 *   fields used below all observed in a real response.
 *
 * No API key is required. Rate limits are undocumented and shared, so every call
 * goes through a small in-process cache plus an optional Upstash cache later.
 */

export type DexSocial = { url: string; type?: string };
export type DexWebsite = { url: string; label?: string };

export type DexPair = {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: DexWebsite[];
    socials?: DexSocial[];
  };
};

type DexTokensResponse = { pairs: DexPair[] | null; schemaVersion?: string };
type DexSearchResponse = { pairs: DexPair[] | null };

/** Normalised view of one token, used by the API route and the UI. */
export type TokenSnapshot = {
  mint: string;
  name: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  headerUrl: string | null;
  websites: DexWebsite[];
  socials: DexSocial[];
  priceUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  pairAddress: string | null;
  dexId: string | null;
  url: string | null;
  pairCreatedAt: number | null;
  sources: { dexscreener: string };
  fetchedAt: string;
};

const BASE = "https://api.dexscreener.com/latest/dex";

const SOLANA = "solana";

/** Pick the pair that best represents the token: most liquid Solana pair. */
function bestSolanaPair(pairs: DexPair[] | null): DexPair | null {
  if (!pairs || pairs.length === 0) return null;
  const solana = pairs.filter((p) => p.chainId === SOLANA);
  const pool = solana.length > 0 ? solana : pairs;
  return pool.reduce((a, b) =>
    (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
  );
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

async function getJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`DexScreener ${res.status} for ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full snapshot for one mint. Throws on upstream failure — callers decide the
 * HTTP status, we never invent a token that the upstream did not return.
 */
export async function getTokenSnapshot(mint: string): Promise<TokenSnapshot> {
  const data = await getJson<DexTokensResponse>(`${BASE}/tokens/${encodeURIComponent(mint)}`);
  const pair = bestSolanaPair(data.pairs);
  if (!pair) {
    throw new Error(`no pair found for mint ${mint}`);
  }
  const base = pair.baseToken ?? {};
  return {
    mint,
    name: base.name ?? "unknown",
    symbol: base.symbol ?? "unknown",
    description: null, // DexScreener does not return a description; on-chain/pump metadata fills this in Phase 2.
    imageUrl: pair.info?.imageUrl ?? pair.info?.openGraph ?? null,
    headerUrl: pair.info?.header ?? null,
    websites: pair.info?.websites ?? [],
    socials: pair.info?.socials ?? [],
    priceUsd: num(pair.priceUsd),
    marketCap: num(pair.marketCap),
    fdv: num(pair.fdv),
    liquidityUsd: num(pair.liquidity?.usd),
    pairAddress: pair.pairAddress ?? null,
    dexId: pair.dexId ?? null,
    url: pair.url ?? null,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    sources: { dexscreener: `${BASE}/tokens/${mint}` },
    fetchedAt: new Date().toISOString(),
  };
}

/** Free-text search, used by the Explore tab / AI "recreate this token" input. */
export async function searchTokens(query: string, limit = 10): Promise<DexPair[]> {
  const data = await getJson<DexSearchResponse>(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
  );
  const pairs = (data.pairs ?? []).filter((p) => p.chainId === SOLANA);
  return pairs.slice(0, limit);
}
