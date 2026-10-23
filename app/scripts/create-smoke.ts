/**
 * Phase 3 smoke test — builds the real create_v2 transaction and SIMULATES it.
 * Nothing is sent; no funds move.
 *
 * Run:
 *   USER_PUBKEY=<funded-or-any-existing-account> node --env-file=.env.local scripts/create-smoke.ts
 */
import { Keypair } from "@solana/web3.js";
import { buildCreateTransaction, simulateCreate, validateLaunchInput } from "../src/lib/pump/create.ts";

const user = process.env.USER_PUBKEY;
if (!user) {
  console.error("USER_PUBKEY is required (an existing account, used as payer for the simulation)");
  process.exit(2);
}

// A real pinned metadata URI from the Pinata smoke run (297 bytes of JSON).
const uri =
  process.env.TEST_METADATA_URI ??
  "https://gateway.pinata.cloud/ipfs/bafkreiejf2nf36uz5kzmznxtg3qskviqqdplnuv5n2g65vn23ftifu72nm";

const mintKeypair = Keypair.generate();
const input = {
  mint: mintKeypair.publicKey.toBase58(),
  name: "PumpLaunchBot Smoke",
  symbol: "PLBSMOKE",
  uri,
  creator: user,
  user,
  mayhemMode: false,
};

console.log("validation issues:", validateLaunchInput(input));

// Negative control: the limits must actually reject bad metadata.
console.log(
  "limit check (33-byte name):",
  validateLaunchInput({ ...input, name: "x".repeat(33) }).map((i) => `${i.field}:${i.message}`),
);

const built = await buildCreateTransaction(input);
console.log("built: instructions:", built.instructions, "| signers:", built.signers.length);
console.log("create_v2 accounts:", built.accounts.length);
console.log("account names:", built.accounts.map((a) => (a.pubkey ? a.pubkey.toBase58().slice(0, 8) : "?")).join(" "));
console.log("tx bytes:", Buffer.from(built.transaction, "base64").length);

const sim = await simulateCreate(built.transaction);
console.log("--- simulation ---");
console.log("ok:", sim.ok, "| unitsConsumed:", sim.unitsConsumed, "| err:", sim.err);
for (const line of sim.logs.slice(-12)) console.log("  log:", line);
