import {
  getTokenSnapshot as getDexScreenerSnapshot,
  type DexSocial,
  type DexWebsite,
  type TokenSnapshot as DexSnapshot,
} from "./dexscreener";
import { getAsset, getOffChainMetadata, toFetchableUri } from "../solana/helius";

/**
 * The canonical token snapshot: on-chain (Helius DAS) metadata merged with
 * market data (DexScreener). Verified sources, Phase 2:
 *  - Helius DAS getAsset -> name, symbol, description, image, json_uri   (HTTP 200, live)
 *  - the json_uri fetch  -> twitter / telegram / website / discord        (gateway rewritten)
 *  - DexScreener         -> priceUsd, marketCap, liquidity, pairs         (HTTP 200, live)
 * pump.fun's own frontend APIs answer 403 behind Cloudflare for server-side calls,
 * so they are deliberately NOT a runtime dependency.
 */
export type FullTokenSnapshot = {
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
  metadataUri: string | null;
  sources: { dexscreener: string; onchain: string };
  fetchedAt: string;
};

function socialsFromOffChain(meta: {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
} | null): { socials: DexSocial[]; websites: DexWebsite[] } {
  const socials: DexSocial[] = [];
  const websites: DexWebsite[] = [];
  if (!meta) return { socials, websites };
  if (meta.twitter) socials.push({ url: meta.twitter, type: "twitter" });
  if (meta.telegram) socials.push({ url: meta.telegram, type: "telegram" });
  if (meta.discord) socials.push({ url: meta.discord, type: "discord" });
  if (meta.website) websites.push({ url: meta.website, label: "Website" });
  return { socials, websites };
}

function mergeUnique<T extends { url?: string }>(a: T[], b: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...a, ...b]) {
    const key = (item.url ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Full snapshot for one mint. On-chain metadata is authoritative for name/symbol/
 * description/image; DexScreener supplies the market numbers. Either source may be
 * degraded without failing the whole lookup, but at least one must answer.
 */
export async function getFullTokenSnapshot(mint: string): Promise<FullTokenSnapshot> {
  const [onchain, market] = await Promise.allSettled([
    getAsset(mint),
    getDexScreenerSnapshot(mint),
  ]);

  const asset = onchain.status === "fulfilled" ? onchain.value : null;
  const dex: DexSnapshot | null = market.status === "fulfilled" ? market.value : null;

  if (!asset && !dex) {
    const reason =
      market.status === "rejected" && market.reason instanceof Error
        ? market.reason.message
        : "no metadata and no market data";
    throw new Error(`no data for mint ${mint}: ${reason}`);
  }

  const offChain = asset ? await getOffChainMetadata(asset.content?.json_uri ?? null) : null;
  const links = socialsFromOffChain(offChain);

  const onchainImage =
    toFetchableUri(asset?.content?.links?.image) ??
    toFetchableUri(asset?.content?.files?.[0]?.uri);

  return {
    mint,
    name: asset?.content?.metadata?.name ?? dex?.name ?? "unknown",
    symbol: asset?.content?.metadata?.symbol ?? dex?.symbol ?? "unknown",
    description: asset?.content?.metadata?.description ?? offChain?.description ?? dex?.description ?? null,
    imageUrl: onchainImage ?? dex?.imageUrl ?? null,
    headerUrl: dex?.headerUrl ?? null,
    websites: mergeUnique(dex?.websites ?? [], links.websites),
    socials: mergeUnique(dex?.socials ?? [], links.socials),
    priceUsd: dex?.priceUsd ?? null,
    marketCap: dex?.marketCap ?? null,
    fdv: dex?.fdv ?? null,
    liquidityUsd: dex?.liquidityUsd ?? null,
    pairAddress: dex?.pairAddress ?? null,
    dexId: dex?.dexId ?? null,
    url: dex?.url ?? null,
    pairCreatedAt: dex?.pairCreatedAt ?? null,
    metadataUri: asset?.content?.json_uri ?? null,
    sources: {
      dexscreener: `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      onchain: "helius:getAsset",
    },
    fetchedAt: new Date().toISOString(),
  };
}
