/**
 * Pinata pinning — the metadata path for coin creation.
 *
 * pump.fun no longer accepts direct metadata uploads (the old /api/ipfs endpoint is dead),
 * so `uri` must be an IPFS URI. Verified against Pinata this session:
 *   POST https://api.pinata.cloud/data/testAuthentication  -> 200 (JWT valid)
 * The upload endpoint used below is the v3 files API that PumpPortal's own current
 * examples use: POST https://uploads.pinata.cloud/v3/files with network=public.
 *
 * Server-only. Never import this from a client component.
 */

const UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
/**
 * Gateway choice matters and was measured: `https://ipfs.io/ipfs/<cid>` now answers a
 * browser-only "switching to a service worker gateway" notice to plain HTTP clients
 * (verified with a real pinned CID this session), so it cannot be the default for a
 * server-side read-back. Pinata's own gateway serves the raw content and is the default;
 * override with PINATA_GATEWAY when a dedicated gateway is configured.
 */
const GATEWAY = process.env.PINATA_GATEWAY?.trim() || "https://gateway.pinata.cloud/ipfs";

export type PinnedFile = {
  cid: string;
  uri: string; // gateway URL — what pump.fun's `uri` field receives
  ipfsUri: string; // ipfs://<cid> — the canonical form
  size: number;
};

export type TokenMetadataInput = {
  name: string;
  symbol: string;
  description: string;
  imageUri: string; // usually the ipfs gateway URL of the pinned image
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
};

function jwt(): string {
  const token = process.env.PINATA_JWT?.trim();
  if (!token) throw new Error("PINATA_JWT is not configured");
  return token;
}

async function upload(file: Blob, filename: string, timeoutMs = 60_000): Promise<PinnedFile> {
  const form = new FormData();
  form.append("network", "public");
  form.append("file", file, filename);
  form.append("name", filename);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt()}` },
      body: form,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Pinata upload failed: ${res.status} ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as { data?: { cid?: string; size?: number } };
    const cid = body.data?.cid;
    if (!cid) throw new Error(`Pinata returned no cid: ${text.slice(0, 200)}`);
    return {
      cid,
      uri: `${GATEWAY}/${cid}`,
      ipfsUri: `ipfs://${cid}`,
      size: body.data?.size ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Pin raw bytes (the token image). */
export async function pinFile(bytes: Uint8Array, filename: string, mime = "image/png"): Promise<PinnedFile> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return upload(blob, filename);
}

/** Pin the token metadata JSON and return the URI that goes into create_v2. */
export async function pinTokenMetadata(meta: TokenMetadataInput): Promise<PinnedFile> {
  const json = JSON.stringify(
    {
      name: meta.name,
      symbol: meta.symbol,
      description: meta.description,
      image: meta.imageUri,
      ...(meta.twitter ? { twitter: meta.twitter } : {}),
      ...(meta.telegram ? { telegram: meta.telegram } : {}),
      ...(meta.website ? { website: meta.website } : {}),
      ...(meta.discord ? { discord: meta.discord } : {}),
      showName: true,
    },
    null,
    2,
  );
  const blob = new Blob([json], { type: "application/json" });
  return upload(blob, "metadata.json");
}

/** Fetch an image URL and pin it — the path used when the AI generates the art. */
export async function pinImageFromUrl(url: string): Promise<PinnedFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch image: ${res.status} ${url}`);
  const mime = res.headers.get("content-type") ?? "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  return pinFile(bytes, `token-image.${ext}`, mime);
}
