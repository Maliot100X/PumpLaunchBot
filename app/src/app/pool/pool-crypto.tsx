/**
 * Team Grind Pool — the link contract and the sealing crypto, in one module so the page, the
 * contributor view and the format itself are readable from a single place.
 *
 * WHAT THE INVITE LINK CARRIES, EXACTLY
 *   /pool?join=<base64url of JSON>
 *   { v, id, p, s, cs, salt, it, w, from? }
 *     — `join` is the marker: a query string with it is a pool link, anything else is not.
 *     v     format version, 1
 *     id    pool id, 6 chars from a 32-char alphabet (no 0/O/1/l — it gets read aloud)
 *     p, s  the base58 start / end pattern every browser must grind
 *     cs    true = match exact case
 *     salt  16 random bytes, base64url — PUBLIC by design, not a secret
 *     it    PBKDF2 iteration count — PUBLIC by design, not a secret
 *     w     one sealed witness blob, so any browser holding the pool key can PROVE it does
 *     from  optional sender label. Absent means the link genuinely did not carry one, and the join
 *           view says that instead of inventing a name.
 *
 * WHAT THE LINK DOES NOT CARRY: the pool key. It is generated in the pool creator's browser and has
 * to be handed over separately. Anyone who holds it can open every result sealed for that pool —
 * which is why the page states that plainly rather than implying the key is hiding somewhere clever.
 *
 * CRYPTO, EXACTLY AS IMPLEMENTED BELOW AND REPEATED IN THE UI
 *   key  = PBKDF2-HMAC-SHA256(pool key, 16-byte random salt, 600_000 iterations) → AES-256-GCM
 *   blob = "plbp1." + base64url(12-byte iv) + "." + base64url(ciphertext || GCM tag)
 *   aad  = "plbp1|pool:<id>|<kind>" — bound as additional authenticated data, so a blob sealed for
 *          one pool FAILS to open in another instead of silently decoding into nonsense.
 * Open is AES-GCM decrypt: the tag is authenticated, so a wrong pool key, a different pool or a
 * damaged file is rejected with an error rather than returning partial plaintext.
 *
 * Boundary, stated once and never crossed: this file only ever handles POOL key material — a
 * passphrase that seals freshly-ground mint keypairs on their way between teammates. It is never
 * used for, and must never be used for, the key of a funded wallet or the treasury signer; those
 * stay server-side (see src/lib/treasury.ts) or in memory for a single signature (see /grinder).
 */

import { VanityError, validatePattern } from "@/lib/vanity/grind";

export const POOL_FORMAT_VERSION = 1;

/* KDF + cipher parameters. The iteration count is a number the user is shown, so it lives here once. */
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_HASH = "SHA-256";
export const AES_KEY_BITS = 256;
export const GCM_IV_BYTES = 12;
export const SALT_BYTES = 16;

/** 24 random bytes → 32 base64url chars = 192 bits of key. */
const POOL_KEY_BYTES = 24;

export const SEAL_PREFIX = "plbp1";

/** Pool ids get read aloud and re-typed, so the alphabet drops 0/O, 1/l and I. 32 divides 256, so a
 *  raw byte maps to an index without modulo bias. */
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const ID_MIN = 4;
const ID_MAX = 16;

/** base58 is the grinder's alphabet; a pool pattern has to survive the same rules. */
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PATTERN_MAX = 8; // the engine caps the pattern at 6 chars; a little headroom for a clearer error

const MAX_LINK_LENGTH = 4000;
const MAX_SENDER_LENGTH = 48;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export class PoolCryptoError extends Error {}

/* ------------------------------------------------------------------ availability */

/**
 * WebCrypto only exists in a secure context. Over plain http the browser withholds `crypto.subtle`,
 * so the pool cannot work there at all — the UI says which of the two is missing instead of throwing
 * an unhelpful "cannot read properties of undefined".
 */
export function cryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

export function cryptoUnavailableReason(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    return "this browser exposes no crypto.getRandomValues, so no key can be generated here.";
  }
  if (typeof crypto.subtle === "undefined") {
    return "this page is not a secure context, so the browser withholds crypto.subtle. Over https (or on localhost) the pool works; over plain http it does not.";
  }
  return "WebCrypto is unavailable in this browser.";
}

/* ------------------------------------------------------------------ bytes ↔ base64url */

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/**
 * `crypto.subtle` takes BufferSource, which is an ArrayBuffer-backed view. TextEncoder's return type
 * is wider than that in the current TypeScript DOM libs, so every byte string crossing into WebCrypto
 * goes through here and comes out with the narrower type the API actually requires.
 */
export function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.length % 4 === 0 ? normalised : normalised + "=".repeat(4 - (normalised.length % 4));
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ pool identity */

export function newPoolId(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

/** The pool key: 24 random bytes as base64url. Generated in the browser, never on a server. */
export function newPoolKey(): string {
  return bytesToBase64Url(randomBytes(POOL_KEY_BYTES));
}

export function newSalt(): string {
  return bytesToBase64Url(randomBytes(SALT_BYTES));
}

/* ------------------------------------------------------------------ seal / open */

export type SealKind = "witness" | "result";

export function aadFor(poolId: string, kind: SealKind): string {
  return `${SEAL_PREFIX}|pool:${poolId}|${kind}`;
}

/**
 * PBKDF2 → AES-256-GCM. The derived key is non-extractable: it can encrypt and decrypt here and
 * cannot be read out of the page, which is the point of deriving it rather than storing bytes.
 */
export async function derivePoolKey(poolKey: string, saltBase64Url: string, iterations: number): Promise<CryptoKey> {
  if (!cryptoAvailable()) throw new PoolCryptoError(cryptoUnavailableReason());
  if (iterations !== PBKDF2_ITERATIONS) {
    throw new PoolCryptoError(`this build derives at ${PBKDF2_ITERATIONS.toLocaleString()} iterations; it was asked for ${iterations.toLocaleString()}.`);
  }
  const salt = base64UrlToBytes(saltBase64Url);
  if (salt.length !== SALT_BYTES) {
    throw new PoolCryptoError(`the salt is ${salt.length} bytes; this format uses ${SALT_BYTES}.`);
  }
  const material = await crypto.subtle.importKey("raw", toBufferSource(ENCODER.encode(poolKey)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toBufferSource(salt), iterations, hash: PBKDF2_HASH },
    material,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false, // non-extractable: the key cannot be exported out of the browser
    ["encrypt", "decrypt"],
  );
}

export async function sealJson(key: CryptoKey, value: unknown, aad: string): Promise<string> {
  if (!cryptoAvailable()) throw new PoolCryptoError(cryptoUnavailableReason());
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(iv), additionalData: toBufferSource(ENCODER.encode(aad)) },
    key,
    toBufferSource(ENCODER.encode(JSON.stringify(value))),
  );
  return `${SEAL_PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openSealed(key: CryptoKey, blob: string, aad: string): Promise<unknown> {
  if (!cryptoAvailable()) throw new PoolCryptoError(cryptoUnavailableReason());
  const parts = blob.trim().split(".");
  if (parts.length !== 3 || parts[0] !== SEAL_PREFIX) {
    throw new PoolCryptoError(`that is not a sealed pool result — it should be three dot-separated parts starting with ${SEAL_PREFIX}.`);
  }
  let iv: Uint8Array<ArrayBuffer>;
  let data: Uint8Array<ArrayBuffer>;
  try {
    iv = base64UrlToBytes(parts[1]);
    data = base64UrlToBytes(parts[2]);
  } catch {
    throw new PoolCryptoError("that blob is not valid base64url — it was probably cut short in transit.");
  }
  if (iv.length !== GCM_IV_BYTES) throw new PoolCryptoError(`the IV is ${iv.length} bytes; this format uses ${GCM_IV_BYTES}.`);
  if (data.length <= 16) throw new PoolCryptoError("that blob is too short to hold a GCM tag and any plaintext.");

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toBufferSource(iv), additionalData: toBufferSource(ENCODER.encode(aad)) },
      key,
      toBufferSource(data),
    );
  } catch {
    // AES-GCM authenticates: a failure here is a hard "no", never partial plaintext.
    throw new PoolCryptoError(
      "the sealed result did not open. The GCM tag failed, which means the wrong pool key, a blob sealed for a different pool, or a damaged file — three cases this format cannot tell apart.",
    );
  }
  try {
    return JSON.parse(DECODER.decode(plaintext));
  } catch {
    throw new PoolCryptoError("the blob decrypted but its plaintext is not JSON — refusing to guess at it.");
  }
}

/* ------------------------------------------------------------------ the link contract */

export type JoinPayload = {
  version: number;
  id: string;
  prefix: string;
  suffix: string;
  exactCase: boolean;
  salt: string;
  iterations: number;
  /** One sealed witness: the creator's own proof that a given pool key is the right one. */
  witness: string;
  /** Present only when the person who made the link typed a name. */
  from?: string;
};

export type ParsedJoin =
  | { ok: true; payload: JoinPayload }
  | { ok: false; error: string };

/**
 * The wire shape, written out explicitly. The compact keys (v, id, p, s, cs, salt, it, w, from) are
 * what parseJoinPayload reads back — keeping both sides in one file is the point, and the verification
 * run that caught the first version of this getting them out of step is the reason it is stated as a
 * literal here instead of being derived from the type.
 */
export function buildJoinPayload(input: Omit<JoinPayload, "version">): string {
  const wire: Record<string, unknown> = {
    v: POOL_FORMAT_VERSION,
    id: input.id,
    p: input.prefix,
    s: input.suffix,
    cs: input.exactCase,
    salt: input.salt,
    it: input.iterations,
    w: input.witness,
  };
  if (input.from) wire.from = input.from;
  return bytesToBase64Url(ENCODER.encode(JSON.stringify(wire)));
}

export function joinLinkPath(payload: string): string {
  return `/pool?join=${payload}`;
}

function fail(error: string): ParsedJoin {
  return { ok: false, error };
}

function isBase58(value: string): boolean {
  for (const ch of value) if (!BASE58.includes(ch)) return false;
  return true;
}

function isPoolId(value: string): boolean {
  if (value.length < ID_MIN || value.length > ID_MAX) return false;
  for (const ch of value) if (!ID_ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * Parse and validate a `join=` value. Every rejection names the field that is wrong, because a
 * contributor staring at a broken link deserves better than "invalid link".
 */
export function parseJoinPayload(raw: string): ParsedJoin {
  const value = raw.trim();
  if (value === "") return fail("The link carries an empty join= value — ask your team lead to copy it again.");
  if (value.length > MAX_LINK_LENGTH) return fail(`That join= value is ${value.length} characters; this format tops out at ${MAX_LINK_LENGTH}.`);

  let json: unknown;
  try {
    json = JSON.parse(DECODER.decode(base64UrlToBytes(value)));
  } catch {
    return fail("The join= value is not base64url-encoded JSON — the link was probably cut short, or something re-encoded it.");
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return fail("The join= value decodes, but not into a pool object.");
  }
  const raw0 = json as Record<string, unknown>;

  if (raw0.v !== POOL_FORMAT_VERSION) {
    return fail(`This is a version ${String(raw0.v)} pool link; this build opens version ${POOL_FORMAT_VERSION}.`);
  }
  const id = typeof raw0.id === "string" ? raw0.id : "";
  if (!isPoolId(id)) return fail("The link's pool id is missing or malformed.");

  const prefix = typeof raw0.p === "string" ? raw0.p : "";
  const suffix = typeof raw0.s === "string" ? raw0.s : "";
  if (prefix.length > PATTERN_MAX || suffix.length > PATTERN_MAX) {
    return fail(`The pattern in the link is longer than ${PATTERN_MAX} characters per side.`);
  }
  if (!isBase58(prefix) || !isBase58(suffix)) {
    return fail('The pattern in the link uses characters base58 cannot contain (0, O, I or l).');
  }
  try {
    validatePattern(prefix, suffix);
  } catch (err) {
    const message = err instanceof VanityError ? err.message : "the grinder rejects it";
    return fail(`The link's pattern is not one the grinder will run: ${message}.`);
  }

  if (typeof raw0.cs !== "boolean") return fail("The link does not say whether the pattern is case-sensitive.");
  const salt = typeof raw0.salt === "string" ? raw0.salt : "";
  if (salt === "") return fail("The link carries no KDF salt, so no browser can derive the same key from it.");

  const iterations = typeof raw0.it === "number" ? raw0.it : NaN;
  if (iterations !== PBKDF2_ITERATIONS) {
    return fail(`The link asks for ${Number.isFinite(iterations) ? iterations.toLocaleString() : "an unreadable"} PBKDF2 iterations; this build derives at ${PBKDF2_ITERATIONS.toLocaleString()}.`);
  }

  const witness = typeof raw0.w === "string" ? raw0.w.trim() : "";
  if (witness === "") return fail("The link carries no sealed witness, so a contributor cannot check the pool key against anything.");

  let from: string | undefined;
  if (typeof raw0.from === "string") {
    const cleaned = raw0.from.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_SENDER_LENGTH);
    if (cleaned !== "") from = cleaned;
  }

  return {
    ok: true,
    payload: { version: POOL_FORMAT_VERSION, id, prefix, suffix, exactCase: raw0.cs, salt, iterations, witness, ...(from ? { from } : {}) },
  };
}

/**
 * Accepts whatever a teammate actually manages to send: a full URL, a path with a query, a bare
 * `join=…` fragment, or the raw payload on its own. Anything else is rejected upstream by
 * parseJoinPayload, which explains why.
 */
export function joinValueFrom(input: string): string {
  const text = input.trim();
  if (text === "") return "";
  const queryStart = text.indexOf("?");
  if (queryStart >= 0) {
    const params = new URLSearchParams(text.slice(queryStart + 1));
    const value = params.get("join");
    if (value) return value.trim();
    return "";
  }
  if (text.startsWith("join=")) return text.slice("join=".length).trim();
  // A URL or path with no query at all is not a pool link; say so instead of trying to decode it.
  if (text.includes("://") || text.startsWith("/")) return "";
  return text;
}

