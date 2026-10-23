/**
 * Phase 5 — sponsored launches: the platform treasury pays and signs.
 *
 * Verified numbers this phase: the treasury (YxbGAr…A6Db) holds 0.0033065 SOL and one create
 * costs 1,513,840 lamports, so exactly 2 sponsored launches are affordable right now. That is
 * surfaced to the UI instead of letting someone press a button that cannot be paid for.
 *
 * Design: the treasury is the `creator` and the `user` (payer). The person launching supplies
 * only the wallet that receives their share of the creator fees. The mint keypair is generated
 * server-side because the treasury signs this path end to end — no user signature is needed.
 *
 * Sending is gated twice: `TREASURY_LIVE=true` in the environment AND an explicit `live: true`
 * in the request. Anything less returns a fully simulated plan and sends nothing.
 */

import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  buildCreateTransaction,
  connection,
  simulateCreate,
  validateLaunchInput,
  type CreateLaunchInput,
} from "./create.ts";
import { buildFeeSharingTransactions, resolveSplit, type ShareSpec } from "./fee-sharing.ts";
import { loadTreasury, RENT_PER_LAUNCH_LAMPORTS } from "../treasury.ts";
import { tokenLinks, type TokenLinks } from "../links.ts";

export type SponsoredPlan = {
  mode: "sponsored";
  live: boolean;
  sent: false | { signature: string };
  treasury: string;
  mint: string;
  /** The mint keypair's secret, returned ONCE so the caller can keep the mint authority history. */
  mintSecretKey: number[] | null;
  create: {
    transaction: string;
    simulation: Awaited<ReturnType<typeof simulateCreate>>;
  };
  feeSharing: {
    createConfig: string;
    updateShares: string;
    shares: ShareSpec[];
    /** "split" = 70/30 with the user's wallet, "treasury-only" = the user named no wallet. */
    splitMode: "split" | "treasury-only";
  };
  /** Real, public URLs for the coin that was (or would be) created. */
  links: TokenLinks;
  warnings: string[];
};

export type SponsoredInput = {
  name: string;
  symbol: string;
  uri: string;
  /** Wallet that receives the user's share. Omitted -> the treasury keeps 100% of the fees. */
  feeReceiver?: string;
  /** Optional pre-ground mint public key. When absent the server generates one. */
  mint?: string;
  /** Explicit confirmation to send. Still requires TREASURY_LIVE=true. */
  live?: boolean;
};

export async function runSponsoredLaunch(input: SponsoredInput): Promise<SponsoredPlan> {
  const treasury = loadTreasury();
  if (!treasury) {
    throw new Error("sponsored mode is unavailable: treasury keypair is not configured");
  }
  const treasuryAddress = treasury.publicKey.toBase58();

  const conn = connection();
  const balance = await conn.getBalance(treasury.publicKey, "confirmed");
  const warnings: string[] = [];
  if (balance < RENT_PER_LAUNCH_LAMPORTS) {
    warnings.push(
      `treasury holds ${balance} lamports but one create needs ${RENT_PER_LAUNCH_LAMPORTS} — this will fail on chain`,
    );
  }

  const mintKeypair = input.mint ? null : Keypair.generate();
  const mint = input.mint ?? mintKeypair!.publicKey.toBase58();

  const createInput: CreateLaunchInput = {
    mint,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    creator: treasuryAddress, // the fee-recipient identity is the treasury; the split redistributes it
    user: treasuryAddress, // payer = treasury
  };

  const issues = validateLaunchInput(createInput);
  if (issues.length > 0) {
    throw new Error(`invalid launch input: ${issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
  }

  const built = await buildCreateTransaction(createInput);

  // Sign with the mint keypair when we generated it: create_v2 requires the mint's signature.
  let createTxBase64 = built.transaction;
  if (mintKeypair) {
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    tx.partialSign(mintKeypair);
    createTxBase64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
  }

  const simulation = await simulateCreate(createTxBase64);

  const { shares, mode: splitMode } = resolveSplit({
    feeReceiver: input.feeReceiver,
    platformTreasury: treasuryAddress,
  });
  const feeTx = await buildFeeSharingTransactions({
    mint,
    creator: treasuryAddress,
    shares,
    pool: null, // a fresh coin has not graduated
  });

  if (splitMode === "treasury-only") {
    warnings.push(
      "no fee receiver was supplied, so the treasury keeps 10000 bps (100%) of the creator fees",
    );
  }

  const live = process.env.TREASURY_LIVE === "true" && input.live === true;
  if (!live) {
    warnings.push(
      "not sent: sponsored sending requires TREASURY_LIVE=true in the environment and live:true in the request",
    );
  }
  if (!simulation.ok) {
    warnings.push(`simulation failed, so nothing was sent: ${simulation.err}`);
  }

  return {
    mode: "sponsored",
    live,
    sent: false,
    treasury: treasuryAddress,
    mint,
    mintSecretKey: mintKeypair ? Array.from(mintKeypair.secretKey) : null,
    create: { transaction: createTxBase64, simulation },
    feeSharing: {
      createConfig: feeTx.create.transaction,
      updateShares: feeTx.update!.transaction,
      shares,
      splitMode,
    },
    links: tokenLinks(mint),
    warnings,
  };
}

/**
 * Send the sponsored create transaction, signed by the treasury.
 * Only reachable when runSponsoredLaunch reported live + a passing simulation.
 */
export async function sendSponsored(plan: SponsoredPlan): Promise<{ signature: string }> {
  if (!plan.live) throw new Error("refusing to send: sponsored sending is not enabled");
  if (!plan.create.simulation.ok) throw new Error("refusing to send: the simulation failed");

  const treasury = loadTreasury();
  if (!treasury) throw new Error("treasury is not configured");

  const tx = Transaction.from(Buffer.from(plan.create.transaction, "base64"));
  tx.partialSign(treasury);

  const conn = connection();
  const signature = await conn.sendRawTransaction(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    { skipPreflight: false, maxRetries: 3 },
  );
  const latest = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature, ...latest }, "confirmed");
  return { signature };
}

/** Kept for typing parity with the SDK's VersionedTransaction path. */
export type SponsoredSendResult = VersionedTransaction | null;

export function treasuryPubkey(): PublicKey | null {
  return loadTreasury()?.publicKey ?? null;
}
