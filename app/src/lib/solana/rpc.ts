import { clusterApiUrl } from "@solana/web3.js";

/**
 * One place that decides which RPC the SERVER talks to.
 *
 * Why this exists: every server-side consumer (DAS metadata, treasury reads, transaction building)
 * used to read `NEXT_PUBLIC_SOLANA_RPC_URL`. Anything named NEXT_PUBLIC_ is inlined into the browser
 * bundle at build time, so the Helius key would have shipped to every visitor — the Vercel CLI
 * refused to save it without an explicit "yes, expose this" (`public_prefix_requires_type`), which is
 * what surfaced the problem.
 *
 * Now: the server prefers the private `SOLANA_RPC_URL` (a Vercel Secret, never in the bundle) and
 * only falls back to the public var. The wallet provider in the browser keeps using the public var,
 * because a client-side RPC endpoint is public by definition.
 *
 * Never import this from a "use client" module: the private value is absent there, which would
 * silently downgrade the browser to the public cluster.
 */

export type RpcSource = "SOLANA_RPC_URL" | "NEXT_PUBLIC_SOLANA_RPC_URL" | "public-cluster";

/** Where the server's RPC comes from, without revealing the URL (it carries an API key). */
export function rpcSource(): RpcSource {
  if (process.env.SOLANA_RPC_URL?.trim()) return "SOLANA_RPC_URL";
  if (process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()) return "NEXT_PUBLIC_SOLANA_RPC_URL";
  return "public-cluster";
}

/** Host only — safe to log or show in a UI. The path/query carries the API key, so it never is. */
export function rpcHost(): string {
  const url = process.env.SOLANA_RPC_URL?.trim() || process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (!url) return "api.mainnet-beta.solana.com (public fallback, heavily rate limited)";
  try {
    return new URL(url).host;
  } catch {
    return "set, but not a parseable URL";
  }
}

/**
 * The server's RPC endpoint. `required` is for callers that genuinely cannot work without a real
 * endpoint (Helius DAS `getAsset` is not available on the public cluster) — they get a clear error
 * naming the variable instead of a mystery 403 later.
 */
export function serverRpcUrl(required = false): string {
  const url = process.env.SOLANA_RPC_URL?.trim() || process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (url) return url;
  if (required) {
    throw new Error(
      "SOLANA_RPC_URL is not configured (a Helius endpoint is required for on-chain metadata, " +
        "treasury reads and transaction building)",
    );
  }
  const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || "mainnet-beta") as
    | "mainnet-beta"
    | "devnet"
    | "testnet";
  return clusterApiUrl(cluster);
}
