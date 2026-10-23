/**
 * One-off: encrypt the project treasury keypair into .env.local.
 *
 * The plaintext key is read from the source file named on the command line, encrypted with a
 * passphrase taken from the environment, and the RESULT is written into .env.local. The key is
 * never printed and never written in the clear.
 *
 *   SOURCE_ENV=/root/pumpapi-hermes/.env TREASURY_PASSPHRASE='…' node scripts/encrypt-treasury.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptKeypair } from "../src/lib/treasury.ts";

const sourceEnv = process.env.SOURCE_ENV;
const passphrase = process.env.TREASURY_PASSPHRASE;
if (!sourceEnv || !passphrase) {
  console.error("SOURCE_ENV and TREASURY_PASSPHRASE are required");
  process.exit(2);
}
if (passphrase.length < 16) {
  console.error("passphrase must be at least 16 characters");
  process.exit(2);
}

const text = readFileSync(sourceEnv, "utf8");
function value(name: string): string | undefined {
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).replace(/^["']|["']$/g, "").trim();
}

const secretB58 = value("AGENT_SOLANA_BASE58_PRIVATE_KEY");
if (!secretB58) {
  console.error(`no AGENT_SOLANA_BASE58_PRIVATE_KEY in ${sourceEnv}`);
  process.exit(2);
}

const secretKey = bs58.decode(secretB58);
const keypair = Keypair.fromSecretKey(secretKey);
const blob = encryptKeypair(secretKey, passphrase);

// Round-trip check before writing anything: a blob that cannot decrypt is worthless.
const { decryptKeypair } = await import("../src/lib/treasury.ts");
const check = decryptKeypair(blob, passphrase);
if (!check.publicKey.equals(keypair.publicKey)) {
  console.error("round-trip check failed — refusing to write the blob");
  process.exit(1);
}

const envPath = ".env.local";
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const setLine = (name: string, val: string): void => {
  const re = new RegExp(`^${name}=.*$`, "m");
  const line = `${name}="${val}"`;
  env = re.test(env) ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`;
};

setLine("TREASURY_KEYPAIR_ENCRYPTED", blob);
setLine("TREASURY_KEYPAIR_PASSPHRASE", passphrase);
setLine("PLATFORM_TREASURY_PUBKEY", keypair.publicKey.toBase58());
writeFileSync(envPath, env, { mode: 0o600 });

console.log("treasury address :", keypair.publicKey.toBase58());
console.log("blob bytes       :", Buffer.from(blob, "base64").length);
console.log("round-trip       : OK");
console.log(`${envPath} updated (mode 600) — plaintext key never written`);
