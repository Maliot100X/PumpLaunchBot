import { NextResponse } from "next/server";
import { z } from "zod";
import { searchTokens } from "@/lib/tokens/dexscreener";
import { latestLaunches } from "@/lib/tokens/solanatracker";
import { tokenLinks } from "@/lib/links";

/**
 * GET /api/shield/radar — the data behind Vamp Radar.
 *
 * Tells you which tokens on the market are imitating a coin: the same ticker, the same name, or the
 * same first/last characters of the mint. Each row carries the evidence that produced it (the same
 * shape grindcore's own radar prints: "Likely vamp · same ticker · same name · 0+4 matching ends ·
 * liq – · mc $2.9K"), so a flag can be audited instead of trusted.
 *
 * Coverage is partial and the response says so: DexScreener search returns roughly 30 pairs per
 * term, so absence of a flag is not proof of absence. Every term is searched sequentially.
 */

const Query = z.object({
  /** The mint being watched. Its address ends define "looks like". */
  mint: z.string().trim().min(32).max(44),
  /** Ticker / name of that coin. Without them we can still compare address ends. */
  ticker: z.string().trim().max(16).optional(),
  name: z.string().trim().max(64).optional(),
  /** Characters compared at each end. Defaults to the 4 their page uses. */
  lead: z.coerce.number().int().min(1).max(8).optional(),
  tail: z.coerce.number().int().min(1).max(8).optional(),
  maxTerms: z.coerce.number().int().min(1).max(4).optional(),
  /** How many recent launches to compare by address. 0 disables that source. */
  scan: z.coerce.number().int().min(0).max(200).optional(),
});

export type RadarRow = {
  mint: string;
  name: string;
  ticker: string;
  imageUrl: string | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  priceUsd: number | null;
  /** Same ticker, case-insensitive. */
  sameTicker: boolean;
  /** Same name, case-insensitive. */
  sameName: boolean;
  /** Matching characters at the start of the address. */
  leadMatches: number;
  /** Matching characters at the end of the address. */
  tailMatches: number;
  verdict: "Likely vamp" | "Suspicious";
  /** The reasons, in the order they were found — what the row is allowed to claim. */
  reasons: string[];
  /** Which source saw it, so a row can be traced back to how it was found. */
  foundBy: string[];
  links: ReturnType<typeof tokenLinks>;
};

function endsMatch(a: string, b: string, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) break;
    m++;
  }
  return m;
}

function endsMatchTail(a: string, b: string, n: number): number {
  let m = 0;
  for (let i = 1; i <= n; i++) {
    if (a[a.length - i] !== b[b.length - i]) break;
    m++;
  }
  return m;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_query",
        detail: parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const { mint, ticker, name, lead = 4, tail = 4, maxTerms = 3, scan = 100 } = parsed.data;
  const warnings: string[] = [];

  /**
   * Search terms are the ticker and the name ONLY.
   *
   * The address tail is deliberately NOT a search term, and that is a measured decision:
   * DexScreener's search matches tickers and names, not address fragments. Searching "pump"
   * returns the coin whose TICKER is PUMP (pumpCmXqMfrsAkQ5r49W…, which does not end in "pump"),
   * and searching a tail like "B263" returns nothing useful. Using the tail as a term looked like
   * it worked while finding nothing — the address comparison below is what actually catches a copy.
   */
  const terms = [ticker?.trim(), name?.trim()].filter((t): t is string => Boolean(t && t.length >= 2));
  const uniqueTerms = [...new Set(terms.map((t) => t.trim()))].slice(0, maxTerms);

  if (uniqueTerms.length === 0 && scan === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_terms",
        detail: "give a ticker or a name, or leave the recent-launch scan on — there is nothing to look for otherwise",
      },
      { status: 400 },
    );
  }

  const seen = new Map<string, RadarRow>();

  /** Judge one candidate, and record it only when there is something to report. */
  function consider(candidate: {
    mint: string;
    name: string;
    ticker: string;
    imageUrl?: string | null;
    liquidityUsd?: number | null;
    marketCap?: number | null;
    priceUsd?: number | null;
    source: string;
  }) {
    if (candidate.mint === mint) return; // never flag the coin being watched

    const sameTicker = Boolean(ticker && candidate.ticker.toLowerCase() === ticker.toLowerCase());
    const sameName = Boolean(name && candidate.name.toLowerCase() === name.toLowerCase());
    const leadHits = endsMatch(mint, candidate.mint, lead);
    const tailHits = endsMatchTail(mint, candidate.mint, tail);

    /**
     * The default suffix is not evidence.
     *
     * Every pump.fun mint ends in "pump", so a tail match against one identifies nothing — the same
     * point their own Shield view makes ("the tail identifies nothing… a copy only has to match the
     * middle of the address"). Without this rule a scan of a pump-token returns dozens of
     * "0+4 matching ends" rows that say only "both are pump tokens". A tail match on a default
     * suffix therefore only counts when the leading characters match too.
     */
    const watchedEndsInDefault = mint.toLowerCase().endsWith("pump");
    const tailIsDefaultMatch = watchedEndsInDefault && tail > 0 && tailHits === tail;
    const informativeEnds = tailIsDefaultMatch ? leadHits > 0 : leadHits > 0 || tailHits > 0;

    const reasons: string[] = [];
    if (sameTicker) reasons.push("same ticker");
    if (sameName) reasons.push("same name");
    if (informativeEnds) reasons.push(`${leadHits}+${tailHits} matching ends`);
    if (reasons.length === 0) return;

    // "Likely vamp" requires the ticker AND the whole compared tail, the bar their list uses;
    // a matching name alone, or one matching end, is "Suspicious".
    const fullTail = tail > 0 && tailHits === tail && !tailIsDefaultMatch;
    const verdict: RadarRow["verdict"] = sameTicker && fullTail ? "Likely vamp" : "Suspicious";

    const existing = seen.get(candidate.mint);
    if (existing) {
      // Seen by both sources: keep the richest numbers and record every sighting.
      if (!existing.foundBy.includes(candidate.source)) existing.foundBy.push(candidate.source);
      existing.liquidityUsd ??= candidate.liquidityUsd ?? null;
      existing.marketCap ??= candidate.marketCap ?? null;
      existing.priceUsd ??= candidate.priceUsd ?? null;
      existing.imageUrl ??= candidate.imageUrl ?? null;
      return;
    }

    seen.set(candidate.mint, {
      mint: candidate.mint,
      name: candidate.name,
      ticker: candidate.ticker,
      imageUrl: candidate.imageUrl ?? null,
      liquidityUsd: candidate.liquidityUsd ?? null,
      marketCap: candidate.marketCap ?? null,
      priceUsd: candidate.priceUsd ?? null,
      sameTicker,
      sameName,
      leadMatches: leadHits,
      tailMatches: tailHits,
      verdict,
      reasons,
      foundBy: [candidate.source],
      links: tokenLinks(candidate.mint),
    });
  }

  /* ---- source 1: DexScreener search over the ticker and the name ---- */

  for (const term of uniqueTerms) {
    try {
      const pairs = await searchTokens(term, 30); // ≈30 pairs per term, their documented coverage
      for (const pair of pairs) {
        if (pair.chainId !== "solana") continue;
        const candidate = pair.baseToken?.address;
        if (!candidate) continue;
        consider({
          mint: candidate,
          name: pair.baseToken?.name ?? "",
          ticker: pair.baseToken?.symbol ?? "",
          imageUrl: pair.info?.imageUrl ?? null,
          liquidityUsd: pair.liquidity?.usd ?? null,
          marketCap: pair.marketCap ?? null,
          priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
          source: `search:${term}`,
        });
      }
    } catch (err) {
      warnings.push(`searching "${term}" failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  /* ---- source 2: compare recent launches by address ---- */

  if (scan > 0) {
    try {
      const recent = await latestLaunches(Math.min(scan, 200));
      for (const token of recent) {
        if (!token.mint) continue;
        consider({
          mint: token.mint,
          name: token.name ?? "",
          ticker: token.symbol ?? "",
          imageUrl: token.image ?? null,
          liquidityUsd: token.pools?.[0]?.liquidity?.usd ?? null,
          // The launch feed carries no market cap; the row shows — rather than a fabricated number.
          marketCap: null,
          priceUsd: null,
          source: "recent-launches",
        });
      }
    } catch (err) {
      warnings.push(`scanning recent launches failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  const rows = [...seen.values()].sort(
    (a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0) || b.tailMatches - a.tailMatches || a.mint.localeCompare(b.mint),
  );

  return NextResponse.json({
    ok: true,
    watched: { mint, ticker: ticker ?? null, name: name ?? null, compared: { lead, tail } },
    searchedTerms: uniqueTerms,
    scannedLaunches: scan,
    count: rows.length,
    flagged: rows.filter((r) => r.verdict === "Likely vamp").length,
    suspicious: rows.filter((r) => r.verdict === "Suspicious").length,
    rows,
    warnings,
    coverageNote:
      "Two partial sources. DexScreener search covers roughly 30 pairs per term and matches tickers and names only — it cannot find an address copy, which is why recent launches are also compared address-by-address. No flags here is not proof that no copy exists. A watchlist rescans while the tab is open and does nothing while it is closed.",
  });
}
