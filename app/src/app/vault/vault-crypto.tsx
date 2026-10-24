"use client";

/**
 * The BROWSER-LOCAL vault's crypto. Deliberately WebCrypto only — no `node:crypto`, no server call,
 * nothing that could ship the user's mint keys anywhere.
 *
 * This is a DIFFERENT thing from src/lib/treasury.ts, and the two must never be confused:
 *  - treasury.ts  : the PLATFORM's wallet, encrypted server-side with scrypt + AES-256-GCM, used to
 *                   sign sponsored launches. That key is a server secret and this module never
 *                   touches it, or imports it, or reads its env vars.
 *  - this module  : the USER's own grinded mint keypairs, encrypted in this browser with a key
 *                   derived from a passphrase the user types. It never leaves the browser.
 *
 * Parameters are stated once, here, and the UI reads them from these constants so the copy on screen
 * cannot drift from the code that actually runs:
 *   KDF    PBKDF2-SHA256, 310,000 iterations, 16-byte random salt
 *   CIPHER AES-256-GCM, 12-byte random IV, 128-bit auth tag (WebCrypto appends the tag to the
 *          ciphertext, so the envelope stores only the ciphertext and records tagBits)
 *
 * A wrong passphrase cannot corrupt anything: AES-GCM is authenticated, so decrypt() throws instead
 * of returning garbage.
 */

import { Keypair } from "@solana/web3.js";

/* ------------------------------------------------------------ parameters (single source) */

/** The iteration count the code runs with. The label below is derived from it — never retype it. */
export const PBKDF2_ITERATIONS = 310_000;
export const PBKDF2_HASH = "SHA-256" as const;
export const PBKDF2_ROUNDS_LABEL = PBKDF2_ITERATIONS.toLocaleString("en-US");
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const AEAD_TAG_BITS = 128;
/** A Solana ed25519 secret key is always 64 bytes (32-byte seed ‖ 32-byte public key). */
export const KEYPAIR_BYTES = 64;

/**
 * An imported backup is a file from somewhere else, so its declared round count is attacker-ish
 * input. Refuse anything outside this window rather than letting a "backup" ask this tab to run a
 * billion PBKDF2 rounds.
 */
export const MIN_ACCEPTED_ITERATIONS = 10_000;
export const MAX_ACCEPTED_ITERATIONS = 2_000_000;

export const VAULT_FORMAT = "claw-local-vault";
export const VAULT_VERSION = 1;
/** The single localStorage slot this vault owns. Nothing else in the app reads or writes it. */
export const STORAGE_KEY = "claw.local-vault.v1";
/** The app's own mint-keypair JSON shape (what the grinder's "Download keypair JSON" writes). */
export const KEYPAIR_JSON_HINT = "a 64-byte array, e.g. [12,34,…] — the grinder's downloaded keypair JSON";

/* ------------------------------------------------------------------------------ types */

export type VaultKey = {
  /** Public base58 address — derived from the bytes, never trusted from the input. */
  address: string;
  /** The 64-byte secret key as a plain array, exactly the shape solana-keygen / the grinder use. */
  secretKey: number[];
  label: string | null;
  addedAt: string;
};

export type VaultPayload = {
  vault: typeof VAULT_VERSION;
  keys: VaultKey[];
};

export type VaultEnvelope = {
  format: typeof VAULT_FORMAT;
  version: number;
  createdAt: string;
  kdf: { name: "PBKDF2"; hash: typeof PBKDF2_HASH; iterations: number; salt: string };
  cipher: { name: "AES-256-GCM"; iv: string; tagBits: number };
  /** base64 of AES-GCM ciphertext with the 128-bit authentication tag appended. */
  ciphertext: string;
};

/* --------------------------------------------------------------------------- encoding */

/**
 * TS 5.9 + the current DOM libs type WebCrypto's `BufferSource` as `ArrayBufferView<ArrayBuffer>`,
 * while `Uint8Array` on its own defaults to `Uint8Array<ArrayBufferLike>`. Everything this module
 * hands to WebCrypto is built here, so it is typed precisely once instead of casting at each call.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** UTF-8 bytes as a fresh `Uint8Array<ArrayBuffer>` (TextEncoder's own return type is too wide). */
function utf8(text: string): Bytes {
  return new Uint8Array(new TextEncoder().encode(text));
}

function isBase64(text: unknown): text is string {
  return typeof text === "string" && text.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

/* ----------------------------------------------------------------------------- webcrypto */

/**
 * WebCrypto only exists in a secure context (https, or http on localhost). On a plain-http host the
 * whole feature is unavailable — the UI says exactly that instead of failing on the first click.
 */
export function webCryptoAvailable(): boolean {
  return typeof globalThis !== "undefined" && !!globalThis.crypto && !!globalThis.crypto.subtle;
}

export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** PBKDF2-SHA256 → a non-extractable AES-256-GCM key. The derived key never leaves WebCrypto. */
async function deriveAesKey(
  passphrase: string,
  salt: Bytes,
  iterations: number,
): Promise<CryptoKey> {
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    utf8(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: PBKDF2_HASH },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ------------------------------------------------------------------------ envelope create */

export async function encryptVault(
  passphrase: string,
  payload: VaultPayload,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<VaultEnvelope> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(passphrase, salt, iterations);
  const plaintext = utf8(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  // Wipe the plaintext copy we made for the call; the key material itself stays inside WebCrypto.
  plaintext.fill(0);
  return {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    createdAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: PBKDF2_HASH, iterations, salt: toBase64(salt) },
    cipher: { name: "AES-256-GCM", iv: toBase64(iv), tagBits: AEAD_TAG_BITS },
    ciphertext: toBase64(ciphertext),
  };
}

/* ----------------------------------------------------------------------- envelope open */

export class VaultError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural check for a backup blob, including the iteration cap. Never decrypts.
 *
 * Everything the file claims to be is checked against what this build can actually do: a blob that
 * says it is SHA-512 or has a 96-bit tag is refused with that reason, rather than being fed to a
 * SHA-256 / 128-bit-tag decrypt and reported as "wrong passphrase".
 */
export function parseEnvelope(text: string): { envelope: VaultEnvelope | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { envelope: null, error: "that is not valid JSON — a backup is the .json file this vault exported" };
  }
  if (!isRecord(raw)) return { envelope: null, error: "a backup must be a JSON object" };
  if (raw.format !== VAULT_FORMAT) {
    return { envelope: null, error: `unknown format ${JSON.stringify(raw.format ?? null)} — expected ${VAULT_FORMAT}` };
  }
  if (raw.version !== VAULT_VERSION) {
    return { envelope: null, error: `backup version ${JSON.stringify(raw.version ?? null)} — this build reads version ${VAULT_VERSION}` };
  }
  if (!isRecord(raw.kdf) || !isRecord(raw.cipher)) {
    return { envelope: null, error: "the backup has no kdf / cipher block" };
  }
  const kdf = raw.kdf;
  const cipher = raw.cipher;

  if (kdf.name !== "PBKDF2") {
    return { envelope: null, error: `key derivation ${JSON.stringify(kdf.name ?? null)} — this vault only reads PBKDF2` };
  }
  if (kdf.hash !== PBKDF2_HASH) {
    return { envelope: null, error: `key derivation uses ${JSON.stringify(kdf.hash ?? null)} — this vault derives with ${PBKDF2_HASH}` };
  }
  const iterations = kdf.iterations;
  if (typeof iterations !== "number" || !Number.isInteger(iterations)) {
    return { envelope: null, error: "the backup does not declare a PBKDF2 iteration count" };
  }
  if (iterations < MIN_ACCEPTED_ITERATIONS) {
    return { envelope: null, error: `${iterations.toLocaleString("en-US")} PBKDF2 rounds is below this vault's floor of ${MIN_ACCEPTED_ITERATIONS.toLocaleString("en-US")} — refusing a blob that weak` };
  }
  if (iterations > MAX_ACCEPTED_ITERATIONS) {
    return { envelope: null, error: `${iterations.toLocaleString("en-US")} PBKDF2 rounds is above this vault's ceiling of ${MAX_ACCEPTED_ITERATIONS.toLocaleString("en-US")} — refusing to run a blob that expensive` };
  }
  if (cipher.name !== "AES-256-GCM") {
    return { envelope: null, error: `cipher ${JSON.stringify(cipher.name ?? null)} — this vault only reads AES-256-GCM` };
  }
  const tagBits = typeof cipher.tagBits === "number" ? cipher.tagBits : AEAD_TAG_BITS;
  if (tagBits !== AEAD_TAG_BITS) {
    return { envelope: null, error: `the backup declares a ${tagBits}-bit authentication tag — this vault writes and reads ${AEAD_TAG_BITS}` };
  }
  if (!isBase64(kdf.salt) || !isBase64(cipher.iv) || !isBase64(raw.ciphertext)) {
    return { envelope: null, error: "the backup is missing its salt, iv or ciphertext" };
  }
  return {
    envelope: {
      format: VAULT_FORMAT,
      version: VAULT_VERSION,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
      kdf: { name: "PBKDF2", hash: PBKDF2_HASH, iterations, salt: kdf.salt },
      cipher: { name: "AES-256-GCM", iv: cipher.iv, tagBits },
      ciphertext: raw.ciphertext,
    },
    error: null,
  };
}

function coercePayload(raw: unknown): VaultPayload {
  if (!isRecord(raw)) throw new VaultError("the decrypted payload is not an object");
  const keys = raw.keys;
  if (!Array.isArray(keys)) throw new VaultError("the decrypted payload has no keys array");
  const out: VaultKey[] = [];
  for (const entry of keys) {
    if (!isRecord(entry)) throw new VaultError("the decrypted payload contains a key entry that is not an object");
    const { address, secretKey, label, addedAt } = entry;
    if (!Array.isArray(secretKey) || secretKey.length !== KEYPAIR_BYTES || typeof address !== "string") {
      throw new VaultError("the decrypted payload contains an entry that is not a 64-byte keypair");
    }
    for (const byte of secretKey) {
      if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new VaultError("the decrypted payload contains a secret key with bytes that are not 0–255");
      }
    }
    out.push({
      address,
      secretKey: secretKey as number[],
      label: typeof label === "string" ? label : null,
      addedAt: typeof addedAt === "string" ? addedAt : new Date(0).toISOString(),
    });
  }
  return { vault: VAULT_VERSION, keys: out };
}

/**
 * Open an envelope with a passphrase. The round count comes from the file, not from the constant, so
 * a backup written by an older build still opens. AES-GCM authentication turns a wrong passphrase
 * into this error rather than into garbage keys.
 */
export async function decryptVault(envelope: VaultEnvelope, passphrase: string): Promise<VaultPayload> {
  const key = await deriveAesKey(passphrase, fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
  let plaintext: Bytes;
  try {
    plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(envelope.cipher.iv) },
        key,
        fromBase64(envelope.ciphertext),
      ),
    );
  } catch {
    throw new VaultError("wrong passphrase — AES-GCM could not authenticate this vault");
  }
  const text = new TextDecoder().decode(plaintext);
  plaintext.fill(0);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultError("this vault decrypted but its contents are not JSON — it is not a vault from this build");
  }
  return coercePayload(parsed);
}

/* ------------------------------------------------------------------------ localStorage */

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredEnvelope(): { text: string | null; error: string | null } {
  const store = storage();
  if (!store) return { text: null, error: "this browser blocks localStorage, so a vault cannot be saved here" };
  try {
    return { text: store.getItem(STORAGE_KEY), error: null };
  } catch {
    return { text: null, error: "the browser refused to read localStorage" };
  }
}

/**
 * Write, then read back and compare. A silent localStorage quota failure is exactly how a user would
 * lose keys they believed were saved, so the write is verified before the UI claims it worked.
 */
export function saveEnvelope(text: string): { ok: boolean; error: string | null } {
  const store = storage();
  if (!store) return { ok: false, error: "this browser blocks localStorage, so the vault cannot be saved" };
  try {
    store.setItem(STORAGE_KEY, text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `the browser refused to save: ${err.message}` : "the browser refused to save the vault" };
  }
  const readBack = store.getItem(STORAGE_KEY);
  if (readBack !== text) return { ok: false, error: "the browser stored something different from what was written — the vault is NOT saved" };
  return { ok: true, error: null };
}

export function clearStoredEnvelope(): { ok: boolean; error: string | null } {
  const store = storage();
  if (!store) return { ok: false, error: "this browser blocks localStorage" };
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    return { ok: false, error: "the browser refused to clear localStorage" };
  }
  return { ok: store.getItem(STORAGE_KEY) === null, error: null };
}

export function envelopeBytes(envelope: VaultEnvelope): number {
  try {
    // base64 length → byte length, minus the padding and minus the 16-byte GCM tag.
    const raw = fromBase64(envelope.ciphertext).length;
    return Math.max(0, raw - envelope.cipher.tagBits / 8);
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------------ keypair parsing */

export type ParsedKeys = { keys: VaultKey[]; errors: string[] };

function asSecretArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== KEYPAIR_BYTES) return null;
  for (const n of value) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 255) return null;
  }
  return value as number[];
}

/**
 * Read a mint keypair out of whatever JSON shape the user pasted — the grinder's bare 64-byte array,
 * a `{ secretKey: [...] }` object, a list of either, or a `{ keys: [...] }` wrapper. Every key is
 * re-derived from its bytes and, when the input also declares a public key, the two must agree —
 * a keypair that disagrees with its own address is refused, never stored.
 */
export function parseKeypairJson(text: string): ParsedKeys {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { keys: [], errors: [`that is not valid JSON — paste ${KEYPAIR_JSON_HINT}`] };
  }

  const keys: VaultKey[] = [];
  const errors: string[] = [];

  const visit = (node: unknown, label: string | null, declared: string | null, path: string) => {
    if (Array.isArray(node)) {
      if (node.length === 0) return;
      if (typeof node[0] === "number") {
        const arr = asSecretArray(node);
        if (!arr) {
          errors.push(`${path}: a keypair array must hold exactly ${KEYPAIR_BYTES} bytes, each 0–255 (got ${node.length})`);
          return;
        }
        try {
          const kp = Keypair.fromSecretKey(new Uint8Array(arr));
          const address = kp.publicKey.toBase58();
          if (declared && declared !== address) {
            errors.push(`${path}: the JSON says ${declared} but those bytes derive ${address} — refusing that key`);
            return;
          }
          keys.push({ address, secretKey: arr, label, addedAt: new Date().toISOString() });
        } catch {
          errors.push(`${path}: those ${node.length} bytes are not a valid ed25519 keypair`);
        }
        return;
      }
      node.forEach((child, i) => visit(child, label, declared, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const nextLabel =
        typeof obj.label === "string" ? obj.label : typeof obj.name === "string" ? obj.name : label;
      const nextDeclared = typeof obj.publicKey === "string" ? obj.publicKey : declared;
      for (const field of ["secretKey", "privateKey", "keypair", "keys", "keypairs"]) {
        if (field in obj) {
          visit(obj[field], nextLabel, nextDeclared, `${path}.${field}`);
          return;
        }
      }
      errors.push(`${path}: no secretKey / privateKey / keys array found in that object`);
      return;
    }
    errors.push(`${path}: expected a 64-byte array or an object carrying one`);
  };

  visit(parsed, null, null, "json");

  const unique: VaultKey[] = [];
  for (const k of keys) {
    if (unique.some((u) => u.address === k.address)) {
      errors.push(`${k.address} appears twice in that input — kept once`);
      continue;
    }
    unique.push(k);
  }
  return { keys: unique, errors };
}
