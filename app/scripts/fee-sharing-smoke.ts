/**
 * Phase 4 smoke test — fee sharing.
 * Builds create_fee_sharing_config + update_fee_shares_v2 for a fresh mint and simulates them.
 * Nothing is sent. A never-created mint CANNOT pass simulation (no bonding curve exists), so
 * the expected result here is a precise account-not-found style error: that is what proves the
 * transactions reach the right programs with the right accounts, and it is reported verbatim.
 *
 * Run: AUTHORITY=<pubkey> PLATFORM=<pubkey> node --env-file=.env.local scripts/fee-sharing-smoke.ts
 */
import { Keypair } from "@solana/web3.js";
import { buildFeeSharingTransactions, defaultSplit, validateShares } from "../src/lib/pump/fee-sharing.ts";
import { simulateCreate } from "../src/lib/pump/create.ts";

const user = process.env.AUTHORITY;
const platform = process.env.PLATFORM;
if (!user || !platform) {
  console.error("AUTHORITY and PLATFORM pubkeys are required");
  process.exit(2);
}

console.log("--- validation: the platform default split ---");
const good = defaultSplit(user, platform);
console.log(JSON.stringify(good.map((s) => ({ ...s, address: `${s.address.slice(0, 6)}…` }))));
console.log("issues:", validateShares(good));

console.log("\n--- negative controls (each must be rejected) ---");
const cases: [string, Parameters<typeof validateShares>[0]][] = [
  ["sum 9999", [{ address: user, bps: 6999 }, { address: platform, bps: 3000 }]],
  ["sum 10001", [{ address: user, bps: 7001 }, { address: platform, bps: 3000 }]],
  ["duplicate wallet", [{ address: user, bps: 5000 }, { address: user, bps: 5000 }]],
  ["zero share", [{ address: user, bps: 0 }, { address: platform, bps: 10000 }]],
  ["11 holders", Array.from({ length: 11 }, (_, i) => ({ address: user, bps: 909 + (i === 0 ? 91 : 0) }))],
  ["bad address", [{ address: "not-an-address", bps: 10000 }]],
];
for (const [label, shares] of cases) {
  const issues = validateShares(shares);
  console.log(`  ${label}: ${issues.length ? issues.map((i) => i.message).join(" | ") : "NOT REJECTED (bug!)"}`);
}

console.log("\n--- build the two transactions for a fresh mint ---");
const mint = Keypair.generate().publicKey.toBase58();
const built = await buildFeeSharingTransactions({ mint, creator: user, shares: good });
console.log("create tx bytes:", Buffer.from(built.create.transaction, "base64").length, "| instructions:", built.create.instructions);
console.log("update tx bytes:", Buffer.from(built.update!.transaction, "base64").length, "| instructions:", built.update!.instructions);
console.log("note:", built.note);

console.log("\n--- simulations (expected to fail: this mint was never created) ---");
for (const [label, b64] of [["create_fee_sharing_config", built.create.transaction], ["update_fee_shares_v2", built.update!.transaction]] as const) {
  try {
    const sim = await simulateCreate(b64);
    console.log(`  ${label}: ok=${sim.ok} units=${sim.unitsConsumed} err=${sim.err}`);
    for (const line of sim.logs.slice(-4)) console.log(`    log: ${line}`);
  } catch (err) {
    console.log(`  ${label}: simulation itself failed: ${err instanceof Error ? err.message : err}`);
  }
}
