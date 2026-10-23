/**
 * Phase 5 — the platform treasury.
 *
 * The treasury keypair is the ONLY wallet this project signs with, and it is stored ENCRYPTED:
 * AES-256-GCM, key derived with scrypt from TREASURY_KEYPAIR_PASSPHRASE. The plaintext key is
 * never written to disk, never logged, and never leaves this module.
 *
 * Env contract:
 *   TREASURY_KEYPAIR_ENCRYPTED   base64( salt | iv | authTag | ciphertext )  of the 64-byte secret key
 *   TREASURY_KEYPAIR_PASSPHRASE  passphrase used with scrypt
 *   PLATFORM_TREASURY_PUBKEY     the public address, shown in the UI (not a secret)
 *
 * Server-only. Importing this from a client component would ship the ciphertext to the browser.
 */

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Connection,
  Transaction,
} from "@solana/web3.js";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { serverRpcUrl } from "@/lib/solana/rpc";

const SCRYPT_KEYLEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;
const TAG_LEN = 16;

/** Encrypt a 64-byte secret key into the single base64 blob the env var holds. */
export function encryptKeypair(secretKey: Uint8Array, passphrase: string): string {
  if (secretKey.length !== 64) throw new Error(`expected a 64-byte secret key, got ${secretKey.length}`);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(passphrase, salt, SCRYPT_KEYLEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ciphertext]).toString("base64");
}

/** Decrypt the env blob back into a Keypair. Throws a plain error on a wrong passphrase. */
export function decryptKeypair(blob: string, passphrase: string): Keypair {
  const raw = Buffer.from(blob, "base64");
  if (raw.length <= SALT_LEN + IV_LEN + TAG_LEN) throw new Error("treasury blob is too short to be valid");
  const salt = raw.subarray(0, SALT_LEN);
  const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = raw.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = scryptSync(passphrase, salt, SCRYPT_KEYLEN);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return Keypair.fromSecretKey(new Uint8Array(plain));
  } catch {
    throw new Error("could not decrypt the treasury keypair — wrong passphrase or corrupted blob");
  }
}

export type TreasuryStatus = {
  configured: boolean;
  address: string | null;
  /** false when the blob or the passphrase is missing — the UI must then disable sponsored mode. */
  decryptable: boolean;
  balanceSol: number | null;
  balanceLamports: number | null;
  /** Measured cost of one sponsored create, INCLUDING the payer's own rent-exempt reserve. */
  rentPerLaunchLamports: number;
  launchesAffordable: number | null;
  error: string | null;
};

/**
 * Measured twice on this box (Phase 4-5):
 *  - the ATA transfer inside create_v2 asked for 1,493,520 lamports, and
 *  - a treasury holding 3,306,500 lamports came up 35,980 short of completing the whole create.
 * So a full sponsored create needs ~3,342,480 lamports = ~0.00334 SOL, of which 650,240 is the
 * payer's own rent-exempt reserve (dataSize 0). The earlier 1.5M figure was only the token-account
 * part; quoting that as "cost per launch" is how a launch fails in front of a user.
 */
export const RENT_PER_LAUNCH_LAMPORTS = 3_342_480;
export const PAYER_RESERVE_LAMPORTS = 650_240;

function rpcUrl(): string {
  const url = serverRpcUrl(true);
  return url;
}

/** Decrypt in memory only. The caller must not persist or log the result. */
export function loadTreasury(): Keypair | null {
  const blob = process.env.TREASURY_KEYPAIR_ENCRYPTED?.trim();
  const passphrase = process.env.TREASURY_KEYPAIR_PASSPHRASE?.trim();
  if (!blob || !passphrase) return null;
  return decryptKeypair(blob, passphrase);
}

/**
 * Never throws for the UI: a broken treasury is reported as a status, because "sponsored mode
 * unavailable, here is why" beats a 500 with no explanation.
 */
export async function getTreasuryStatus(): Promise<TreasuryStatus> {
  const pubkey = process.env.PLATFORM_TREASURY_PUBKEY?.trim() || null;
  const blob = process.env.TREASURY_KEYPAIR_ENCRYPTED?.trim();
  const passphrase = process.env.TREASURY_KEYPAIR_PASSPHRASE?.trim();

  if (!blob || !passphrase) {
    return {
      configured: false,
      address: pubkey,
      decryptable: false,
      balanceSol: null,
      balanceLamports: null,
      rentPerLaunchLamports: RENT_PER_LAUNCH_LAMPORTS,
      launchesAffordable: null,
      error: "TREASURY_KEYPAIR_ENCRYPTED / TREASURY_KEYPAIR_PASSPHRASE are not set",
    };
  }

  try {
    const kp = decryptKeypair(blob, passphrase);
    const conn = new Connection(rpcUrl(), "confirmed");
    const lamports = await conn.getBalance(kp.publicKey, "confirmed");
    const spendable = Math.max(0, lamports - PAYER_RESERVE_LAMPORTS);
    const perLaunch = RENT_PER_LAUNCH_LAMPORTS - PAYER_RESERVE_LAMPORTS;
    return {
      configured: true,
      address: kp.publicKey.toBase58(),
      decryptable: true,
      balanceSol: lamports / LAMPORTS_PER_SOL,
      balanceLamports: lamports,
      rentPerLaunchLamports: RENT_PER_LAUNCH_LAMPORTS,
      launchesAffordable: Math.floor(spendable / perLaunch),
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      address: pubkey,
      decryptable: false,
      balanceSol: null,
      balanceLamports: null,
      rentPerLaunchLamports: RENT_PER_LAUNCH_LAMPORTS,
      launchesAffordable: null,
      error: err instanceof Error ? err.message : "unknown treasury error",
    };
  }
}

/**
 * Sign a base64 transaction with the treasury and return the signed bytes.
 * Used only by the sponsored path; the caller decides whether to send.
 */
export async function signWithTreasury(base64Tx: string): Promise<{ signed: string; signer: string }> {
  const treasury = loadTreasury();
  if (!treasury) throw new Error("treasury is not configured (missing encrypted keypair or passphrase)");
  const tx = Transaction.from(Buffer.from(base64Tx, "base64"));
  tx.partialSign(treasury);
  return {
    signed: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    signer: treasury.publicKey.toBase58(),
  };
}

export function treasuryAddress(): PublicKey | null {
  const pk = process.env.PLATFORM_TREASURY_PUBKEY?.trim();
  if (!pk) return null;
  try {
    return new PublicKey(pk);
  } catch {
    return null;
  }
}
