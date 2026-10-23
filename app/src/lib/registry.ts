/**
 * The launch registry — the record of every coin this platform launched.
 *
 * Why it exists: pump.fun is the marketplace, but the identity of "launched through PumpLaunchBot"
 * only exists here. The site needs it for /launchlab (the launch board and its leaderboard), and the
 * bot needs it to answer "what did we launch and how did it do".
 *
 * Storage is Upstash Redis over its REST API, so it works from serverless functions with no
 * connection pool. Layout:
 *   plb:launch:<mint>   hash   one record per launch (all the fields below)
 *   plb:launches        zset   score = createdAt ms, member = mint  (newest-first listing)
 *
 * Nothing here is invented: every field is written by the route that actually built or sent the
 * launch, and when the store is not configured the reads report that instead of returning [].
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL?.trim() || null;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || null;

export const KEY_INDEX = "plb:launches";
export const keyFor = (mint: string) => `plb:launch:${mint}`;

export function isConfigured(): boolean {
  return REST_URL !== null && REST_TOKEN !== null;
}

export type LaunchRecord = {
  mint: string;
  name: string;
  symbol: string;
  imageUri: string | null;
  metadataUri: string;
  /** "self" — the launcher's wallet paid; "sponsored" — the platform treasury paid. */
  mode: "self" | "sponsored";
  payer: string;
  creator: string;
  feeWallet: string | null;
  userBps: number;
  platformBps: number;
  /** On-chain signatures, in the order they were sent. Empty when nothing was sent yet. */
  signatures: string[];
  /** The token this launch was recreated from, when it came through the Shield tab. */
  sourceMint: string | null;
  createdAt: number;
};

type RawResult = { result?: unknown; error?: string };

function creds(): { url: string; token: string } {
  if (!REST_URL || !REST_TOKEN) {
    throw new Error(
      "the launch registry is not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
    );
  }
  return { url: REST_URL, token: REST_TOKEN };
}

/** One command. Returns the raw `result` and throws on a Redis-level error. */
async function cmd<T = unknown>(args: (string | number)[]): Promise<T> {
  const { url, token } = creds();
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash answered ${res.status} ${res.statusText}`);
  const body = (await res.json()) as RawResult;
  if (body.error) throw new Error(`upstash error: ${body.error}`);
  return body.result as T;
}

/** Several commands in one round trip. Order is preserved, so results line up with inputs. */
async function pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  const { url, token } = creds();
  // Pipelining is its own endpoint: POSTing an array to the base URL is refused with
  // `ERR unsupported arg type: "["  (json.Delim)` — measured, not guessed.
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`upstash answered ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const body = (await res.json()) as RawResult[];
  if (!Array.isArray(body)) throw new Error("upstash did not return a pipeline result");
  const bad = body.find((r) => r?.error);
  if (bad) throw new Error(`upstash error: ${bad.error}`);
  return body.map((r) => r.result);
}

/** Redis hashes come back flat: [field, value, field, value, ...]. */
function fromHash(mint: string, flat: unknown): LaunchRecord | null {
  if (!Array.isArray(flat) || flat.length === 0) return null;
  const h: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    h[String(flat[i])] = String(flat[i + 1]);
  }
  if (!h.name) return null;
  let signatures: string[] = [];
  try {
    const parsed = JSON.parse(h.signatures || "[]") as unknown;
    if (Array.isArray(parsed)) signatures = parsed.map(String);
  } catch {
    signatures = [];
  }
  return {
    mint: h.mint || mint,
    name: h.name,
    symbol: h.symbol ?? "",
    imageUri: h.imageUri || null,
    metadataUri: h.metadataUri ?? "",
    mode: h.mode === "self" ? "self" : "sponsored",
    payer: h.payer ?? "",
    creator: h.creator ?? "",
    feeWallet: h.feeWallet || null,
    userBps: Number(h.userBps ?? 0),
    platformBps: Number(h.platformBps ?? 0),
    signatures,
    sourceMint: h.sourceMint || null,
    createdAt: Number(h.createdAt ?? 0),
  };
}

/** Write or update one launch. Re-recording a mint keeps its first createdAt. */
export async function recordLaunch(entry: LaunchRecord): Promise<void> {
  const key = keyFor(entry.mint);
  const fields: (string | number)[] = [
    "mint", entry.mint,
    "name", entry.name,
    "symbol", entry.symbol,
    "imageUri", entry.imageUri ?? "",
    "metadataUri", entry.metadataUri,
    "mode", entry.mode,
    "payer", entry.payer,
    "creator", entry.creator,
    "feeWallet", entry.feeWallet ?? "",
    "userBps", entry.userBps,
    "platformBps", entry.platformBps,
    "signatures", JSON.stringify(entry.signatures),
    "sourceMint", entry.sourceMint ?? "",
    "createdAt", entry.createdAt,
  ];
  const existing = await cmd<string | null>(["HGET", key, "createdAt"]);
  if (existing !== null) {
    // keep the original timestamp so the board does not reorder on every update
    const idx = fields.indexOf("createdAt");
    fields[idx + 1] = Number(existing);
  }
  await pipeline([
    ["HSET", key, ...fields],
    ["ZADD", KEY_INDEX, Number(existing ?? entry.createdAt), entry.mint],
  ]);
}

export type ListResult = {
  configured: boolean;
  launches: LaunchRecord[];
  total: number;
  error: string | null;
};

/** Newest first. Reports a missing configuration instead of pretending the board is empty. */
export async function listLaunches(limit = 100): Promise<ListResult> {
  if (!isConfigured()) {
    return { configured: false, launches: [], total: 0, error: "UPSTASH_REDIS_REST_URL / TOKEN are not set" };
  }
  try {
    const total = await cmd<number>(["ZCARD", KEY_INDEX]);
    if (!total) return { configured: true, launches: [], total: 0, error: null };

    const mints = await cmd<string[]>(["ZREVRANGE", KEY_INDEX, 0, Math.max(0, limit - 1)]);
    if (!Array.isArray(mints) || mints.length === 0) {
      return { configured: true, launches: [], total, error: null };
    }

    const rows = await pipeline(mints.map((m) => ["HGETALL", keyFor(m)]));
    const launches = mints
      .map((mint, i) => fromHash(mint, rows[i]))
      .filter((l): l is LaunchRecord => l !== null);
    return { configured: true, launches, total, error: null };
  } catch (err) {
    return {
      configured: true,
      launches: [],
      total: 0,
      error: err instanceof Error ? err.message : "reading the registry failed",
    };
  }
}

/** Fetch one record directly — the bot uses this to answer about a specific coin. */
export async function getLaunch(mint: string): Promise<LaunchRecord | null> {
  if (!isConfigured()) return null;
  try {
    return fromHash(mint, await cmd(["HGETALL", keyFor(mint)]));
  } catch {
    return null;
  }
}
