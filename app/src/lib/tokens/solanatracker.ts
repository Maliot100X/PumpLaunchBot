/**
 * SolanaTracker data API — the second market-data + tracking source.
 * Verified live with the project's key: GET https://data.solanatracker.io/search?query=bonk
 * -> 200 with full token objects (name, symbol, mint, image, pools, risk, events).
 *
 * Why a second source: DexScreener is excellent for established pairs, but a coin that was
 * launched seconds ago may have no DexScreener pair yet. SolanaTracker indexes new pump.fun
 * mints immediately, which is what the live tracker needs.
 *
 * Auth: header `x-api-key: <SOLANATRACKER_API_KEY>`.
 */

const BASE = "https://data.solanatracker.io";

export type SolanaTrackerToken = {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;
  decimals?: number;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  pools?: { poolId?: string; dex?: string; liquidity?: { usd?: number } }[];
  events?: Record<string, unknown>;
  risk?: Record<string, unknown>;
};

function apiKey(): string {
  const key = process.env.SOLANATRACKER_API_KEY?.trim();
  if (!key) throw new Error("SOLANATRACKER_API_KEY is not configured");
  return key;
}

async function get<T>(path: string, timeoutMs = 12_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-api-key": apiKey(), accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`SolanaTracker ${res.status} for ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Full record for one mint, including pools and risk flags. */
export async function getTrackerToken(mint: string): Promise<SolanaTrackerToken | null> {
  try {
    const body = await get<{ token?: SolanaTrackerToken }>(`/tokens/${encodeURIComponent(mint)}`);
    return body.token ?? null;
  } catch {
    return null; // a missing token must never break a page
  }
}

/** Search by name/symbol — used by the Explore tab and the bot's "recreate this" flow. */
export async function searchTracker(query: string): Promise<SolanaTrackerToken[]> {
  try {
    const body = await get<{ data?: SolanaTrackerToken[] }>(`/search?query=${encodeURIComponent(query)}`);
    return body.data ?? [];
  } catch {
    return [];
  }
}

/** SolanaTracker's feed endpoints nest the token under `token` and add pool/risk siblings. */
type FeedEntry = { token?: SolanaTrackerToken } & Partial<SolanaTrackerToken>;

function unwrap(entry: FeedEntry): SolanaTrackerToken | null {
  if (entry.token && entry.token.mint) {
    return { ...entry.token, pools: entry.pools ?? entry.token.pools, risk: entry.risk ?? entry.token.risk };
  }
  return entry.mint ? (entry as SolanaTrackerToken) : null;
}

/**
 * Newest token launches — the feed the live tracker polls.
 * Measured: GET /tokens/latest returns a bare ARRAY whose entries look like
 * `{ token: {...}, pools, events, risk, buys, sells, txns }`, so entries are unwrapped here
 * instead of assuming the token fields sit at the top level.
 */
export async function latestLaunches(limit = 20): Promise<SolanaTrackerToken[]> {
  try {
    const body = await get<FeedEntry[] | { tokens?: FeedEntry[] }>(`/tokens/latest?limit=${limit}`);
    const list = Array.isArray(body) ? body : (body.tokens ?? []);
    return list.map(unwrap).filter((t): t is SolanaTrackerToken => t !== null).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * The three lifecycle buckets in one call — measured shape:
 *   { latest: [...], graduating: [...], graduated: [...] } with 100 entries each.
 * This is the tracking feed: newest launches, coins about to graduate, coins that graduated.
 */
export async function lifecycleFeed(): Promise<{
  latest: SolanaTrackerToken[];
  graduating: SolanaTrackerToken[];
  graduated: SolanaTrackerToken[];
}> {
  try {
    const body = await get<{
      latest?: FeedEntry[];
      graduating?: FeedEntry[];
      graduated?: FeedEntry[];
    }>("/tokens/multi/all");
    const pick = (list?: FeedEntry[]): SolanaTrackerToken[] =>
      (list ?? []).map(unwrap).filter((t): t is SolanaTrackerToken => t !== null);
    return {
      latest: pick(body.latest),
      graduating: pick(body.graduating),
      graduated: pick(body.graduated),
    };
  } catch {
    return { latest: [], graduating: [], graduated: [] };
  }
}
