/**
 * Proves the 1,232-byte rule on THIS project's real instructions.
 *
 * OTC's integration docs claim that pump's create_v2 plus its two fee-sharing instructions in one
 * transaction lands around 1,280 bytes and always fails. That is the reason this project splits the
 * launch into separate transactions. This script measures it instead of trusting it:
 *
 *   node --env-file=.env.local scripts/tx-limit-smoke.ts
 *
 * It builds each transaction exactly as the launch path does, prints the serialised sizes, then builds
 * the combined transaction to show why it cannot be done in one — and asserts the guard refuses it.
 */
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { MAX_TRANSACTION_BYTES, assertTxFits, transactionSize } from "../src/lib/pump/tx-limit.ts";

const rpc = (process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "").trim();
if (!rpc) throw new Error("no RPC configured (SOLANA_RPC_URL)");

const connection = new Connection(rpc, "confirmed");
const user = Keypair.generate();
const creator = new PublicKey(process.env.USER_PUBKEY ?? user.publicKey.toBase58());
const mint = Keypair.generate();
const { blockhash } = await connection.getLatestBlockhash("confirmed");
const uri = process.env.TEST_METADATA_URI ?? "https://gateway.pinata.cloud/ipfs/bafkreign3fd4apuuihgmsgpzalscncaiy5f2pxaz6wqffma5omcw3ayzye";

console.log(`limit: ${MAX_TRANSACTION_BYTES} bytes (one Solana packet)\n`);

// --- tx 1: create_v2 alone (what the launch path sends first) --------------------------------
const createIx = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name: "Limit Probe",
  symbol: "LIMIT",
  uri,
  creator,
  user: user.publicKey,
  mayhemMode: false,
});
const createTx = new Transaction({ feePayer: user.publicKey, recentBlockhash: blockhash }).add(createIx);
console.log(`  create_v2 alone                 : ${String(transactionSize(createTx)).padStart(5)} bytes`);

// --- tx 2 + 3: the two fee-sharing instructions, each alone (what the launch path sends next) --
const configIx = await PUMP_SDK.createFeeSharingConfig({ creator, mint: mint.publicKey, pool: null });
const configTx = new Transaction({ feePayer: creator, recentBlockhash: blockhash }).add(configIx);
console.log(`  create_fee_sharing_config alone : ${String(transactionSize(configTx)).padStart(5)} bytes`);

const updateIx = await PUMP_SDK.updateFeeSharesV2({
  authority: creator,
  mint: mint.publicKey,
  currentShareholders: [creator],
  newShareholders: [{ address: creator, shareBps: 10_000 }],
  quoteMint: new PublicKey("So11111111111111111111111111111111111111112"),
  quoteTokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  bondingCurveComplete: false,
});
const updateTx = new Transaction({ feePayer: creator, recentBlockhash: blockhash }).add(updateIx);
console.log(`  update_fee_shares_v2 alone      : ${String(transactionSize(updateTx)).padStart(5)} bytes`);

// --- all three in one (what OTC says always fails) --------------------------------------------
const combined = new Transaction({ feePayer: user.publicKey, recentBlockhash: blockhash })
  .add(createIx)
  .add(configIx)
  .add(updateIx);
const combinedSize = transactionSize(combined);
console.log(`\n  all three in ONE transaction    : ${String(combinedSize).padStart(5)} bytes  <-- their claim`);

// --- assertions ------------------------------------------------------------------------------
const checks: [string, boolean][] = [
  ["create_v2 alone fits", transactionSize(createTx) <= MAX_TRANSACTION_BYTES],
  ["fee-sharing config alone fits", transactionSize(configTx) <= MAX_TRANSACTION_BYTES],
  ["update_fee_shares_v2 alone fits", transactionSize(updateTx) <= MAX_TRANSACTION_BYTES],
  ["all three in one does NOT fit", combinedSize > MAX_TRANSACTION_BYTES],
];

let refused = false;
try {
  assertTxFits(combined, "combined launch");
} catch (err) {
  refused = true;
  console.log(`\n  guard says: ${(err as Error).message}`);
}
checks.push(["the guard refuses the combined transaction", refused]);

let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log(`\n${ok ? "ALL CHECKS PASSED" : "CHECKS FAILED"} — the split is required, and the builders enforce it.`);
process.exit(ok ? 0 : 1);
