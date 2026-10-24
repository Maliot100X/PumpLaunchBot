import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Vanity mint grinding (spec Phase 5) — the client-side half of a launch.
 *
 * A pump.fun create needs a FRESH mint keypair, and its secret key must sign the transaction. So the
 * keypair is generated here, in the browser, matched against the requested prefix/suffix, and kept in
 * memory until the user signs. It is never sent to the server: the server only ever sees the public
 * address (and builds an unsigned transaction around it).
 *
 * This is deliberately the same shape as grindcore-style grinders: random ed25519 seeds, base58
 * compare, progress callbacks, cooperative cancellation. No WASM.
 *
 * It runs on the main thread in chunks that yield between them: measured 4,941 keypairs/s in this
 * runtime (tests/vanity.test.ts prints the number), which keeps 4-character patterns to a few
 * seconds and stays responsive. Moving the loop into a Web Worker is the next optimisation, not a
 * correctness one — a 6-character pattern is the point where the main thread starts to feel it.
 */

export type GrindOptions = {
  /** Base58 prefix the mint must start with. */
  prefix?: string;
  /** Base58 suffix the mint must end with. */
  suffix?: string;
  /** Compare case-insensitively (base58 is case-sensitive; this widens the search space a lot). */
  ignoreCase?: boolean;
  /** Safety valve so a hopeless request cannot spin forever. */
  maxAttempts?: number;
  /** How many keypairs to try between yields, so a caller can stay responsive. */
  chunkSize?: number;
  onProgress?: (p: GrindProgress) => void;
  signal?: AbortSignal;
};

export type GrindProgress = {
  attempts: number;
  /** Attempts per second, measured over the whole run. */
  rate: number;
  elapsedMs: number;
  /** Expected attempts for this pattern, so the UI can show progress honestly. */
  expectedAttempts: number;
};

export type GrindResult = {
  publicKey: string;
  secretKey: Uint8Array;
  attempts: number;
  elapsedMs: number;
};

/** Characters that can appear in base58 (Bitcoin alphabet, no 0/O/I/l). */
export const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const BASE58_SIZE = BASE58_ALPHABET.length; // 58

/**
 * Baseline throughput of this engine's main-thread loop, used for time estimates BEFORE a run has
 * produced a measurement of its own (the /grinder expectations table).
 *
 * Where the number comes from: the same source the UI and the test read at runtime — the engine's
 * own progress rate, attempts ÷ elapsed × 1000 (see onProgress below). Measured with a 4 s
 * grindVanity() run of this file on the build host: 3,510 /s (two consecutive runs: 3,510 and
 * 3,460). The header comment's 4,941 came from an earlier, quieter run of the same loop, so the
 * constant is deliberately the lower, reproducible figure. The tab replaces it with the device's
 * own measured rate as soon as the first grind reports one.
 */
export const BROWSER_KEYPAIRS_PER_SECOND = 3_500;

export class VanityError extends Error {}

export function validatePattern(prefix: string, suffix: string): void {
  const all = `${prefix}${suffix}`;
  if (all.length === 0) {
    throw new VanityError("give a prefix or a suffix — otherwise a plain random mint is faster");
  }
  for (const ch of all) {
    if (!BASE58_ALPHABET.includes(ch)) {
      throw new VanityError(`"${ch}" cannot appear in base58 (no 0, O, I or l)`);
    }
  }
  if (all.length > 6) {
    throw new VanityError(
      `a ${all.length}-character pattern is ${(BASE58_SIZE ** all.length).toExponential(1)} combinations — ` +
        `pick 6 or fewer, or run it as a background job`,
    );
  }
}

/**
 * Null when the engine would run this pattern, otherwise the reason it would refuse — the engine's
 * own wording, so a caller (the /grinder expectations table) can explain a refusal without
 * re-stating the rules and drifting from them.
 */
export function patternRefusal(prefix: string, suffix: string): string | null {
  try {
    validatePattern(prefix, suffix);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "invalid pattern";
  }
}

export function expectedAttempts(prefix: string, suffix: string, ignoreCase = false): number {
  const len = prefix.length + suffix.length;
  return ignoreCase ? (BASE58_SIZE / 2) ** len : BASE58_SIZE ** len;
}

function matches(value: string, prefix: string, suffix: string, ignoreCase: boolean): boolean {
  const v = ignoreCase ? value.toLowerCase() : value;
  const p = ignoreCase ? prefix.toLowerCase() : prefix;
  const s = ignoreCase ? suffix.toLowerCase() : suffix;
  if (p && !v.startsWith(p)) return false;
  if (s && !v.endsWith(s)) return false;
  return true;
}

/**
 * Grind until a mint matches, the caller aborts, or maxAttempts is exhausted.
 * Returns null when it stopped without a match (abort or budget) — never a partial keypair.
 */
export async function grindVanity(options: GrindOptions): Promise<GrindResult | null> {
  const { prefix = "", suffix = "", ignoreCase = false, maxAttempts = 5_000_000, chunkSize = 400 } = options;
  validatePattern(prefix, suffix);
  const expected = expectedAttempts(prefix, suffix, ignoreCase);

  const started = Date.now();
  let attempts = 0;

  while (attempts < maxAttempts) {
    for (let i = 0; i < chunkSize; i++) {
      const kp = Keypair.generate();
      attempts++;
      const address = kp.publicKey.toBase58();
      if (matches(address, prefix, suffix, ignoreCase)) {
        const elapsedMs = Date.now() - started;
        return { publicKey: address, secretKey: kp.secretKey, attempts, elapsedMs };
      }
    }

    const elapsedMs = Date.now() - started;
    options.onProgress?.({
      attempts,
      rate: elapsedMs > 0 ? Math.round((attempts / elapsedMs) * 1000) : 0,
      elapsedMs,
      expectedAttempts: expected,
    });

    if (options.signal?.aborted) return null;
    await new Promise((resolve) => setTimeout(resolve, 0)); // yield: keep the UI and the signal responsive
  }

  return null;
}

/** The keypair a grinder result carries, ready to sign a create transaction. */
export function keypairFromResult(result: GrindResult): Keypair {
  const kp = Keypair.fromSecretKey(result.secretKey);
  if (kp.publicKey.toBase58() !== result.publicKey) {
    throw new VanityError("the ground keypair does not match its own public key — refusing to use it");
  }
  return kp;
}

/** bs58 export, kept here so the form does not need to reach into a dependency for it. */
export function encodeBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}
