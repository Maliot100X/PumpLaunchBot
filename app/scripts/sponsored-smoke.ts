/**
 * Phase 5 smoke test — sponsored plan with the REAL treasury as payer.
 * live:false always, so nothing is sent. The treasury now holds SOL, so the simulation that
 * failed for an empty payer in Phase 3 should come back green here.
 */
import { runSponsoredLaunch } from "../src/lib/pump/sponsored.ts";

const plan = await runSponsoredLaunch({
  name: "Sponsored Plan Test",
  symbol: "PLBSPON",
  uri: "https://gateway.pinata.cloud/ipfs/bafkreign3fd4apuuihgmsgpzalscncaiy5f2pxaz6wqffma5omcw3ayzye",
  feeReceiver: process.env.FEE_RECEIVER ?? "So11111111111111111111111111111111111111112",
  live: false,
});

console.log("mode:", plan.mode, "| live:", plan.live, "| sent:", plan.sent);
console.log("treasury:", plan.treasury);
console.log("mint:", plan.mint, "| mint secret returned:", plan.mintSecretKey !== null);
console.log("shares:", plan.feeSharing.shares.map((s) => `${s.bps}->${s.address.slice(0, 6)}…`).join("  "));
console.log("create tx bytes:", Buffer.from(plan.create.transaction, "base64").length);
console.log("simulation ok:", plan.create.simulation.ok, "| units:", plan.create.simulation.unitsConsumed, "| err:", plan.create.simulation.err);
for (const line of plan.create.simulation.logs.slice(-6)) console.log("  log:", line);
console.log("warnings:", plan.warnings);
