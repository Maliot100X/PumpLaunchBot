/**
 * Helius DAS (Digital Asset Standard) client — the on-chain metadata source.
 *
 * Verified live in Phase 2 research (2026-10-23) against
 * POST https://mainnet.helius-rpc.com/?api-key=… {"method":"getAsset","params":{"id":<mint>}}
 * -> HTTP 200 with content.metadata.{name,symbol,description}, content.links.image, content.json_uri.
 *
 * Why this and not the pump.fun frontend API: frontend-api-v3.pump.fun and
 * frontend-api.pump.fun both answer 403 behind Cloudflare for server-side calls
 * (measured). DexScreener has no description field. DAS is the reliable source.
 */

export type DasAsset = {
  id: string;
  content?: {
    json_uri?: string;
    metadata?: { name?: string; symbol?: string; description?: string };
    links?: { image?: string; external_url?: string };
    files?: { uri?: string; mime?: string }[];
  };
  token_info?: { symbol?: string; decimals?: number; supply?: string };
  ownership?: { owner?: string };
};

export type OffChainMetadata = {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
  extensions?: Record<string, unknown>;
};

type RpcResponse<T> = { result?: T; error?: { code: number; message: string } };

function rpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (url && url.includes("api-key=") && url.split("api-key=")[1].length > 0) return url;
  throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not configured (needs the Helius key)");
}

async function rpc<T>(method: string, params: unknown, timeoutMs = 12_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl(), {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "pump-launch-bot", method, params }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const body = (await res.json()) as RpcResponse<T>;
    if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
    if (body.result === undefined) throw new Error(`RPC ${method}: empty result`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function getAsset(mint: string): Promise<DasAsset | null> {
  try {
    return await rpc<DasAsset>("getAsset", { id: mint });
  } catch (err) {
    if (err instanceof Error && /Asset Not Found|not found/i.test(err.message)) return null;
    throw err;
  }
}

/** ipfs://<cid> and ar://<tx> are not fetchable by the browser; rewrite to a gateway. */
export function toFetchableUri(uri: string | undefined | null): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "").replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${cid}`;
  }
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.replace("ar://", "")}`;
  if (/^https?:\/\//.test(uri)) return uri;
  return null;
}

/** Fetch the off-chain JSON (image + social links) referenced by the asset. */
export async function getOffChainMetadata(uri: string | null): Promise<OffChainMetadata | null> {
  const url = toFetchableUri(uri);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const raw = (await res.json()) as OffChainMetadata;
    return raw;
  } catch {
    return null; // a broken gateway must never break a token lookup
  } finally {
    clearTimeout(timer);
  }
}
