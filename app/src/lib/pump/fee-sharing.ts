/**
 * Phase 4 — creator fee sharing, straight from pump-public-docs + @pump-fun/pump-sdk 4.3.1.
 *
 * The lifecycle (docs/instructions/CREATOR_FEE_SHARING.md):
 *   1. create_fee_sharing_config  — PDA `[b"sharing-config", mint]`, initial shareholders
 *                                   [(creator, 10_000)]. `pool` is required only once the coin
 *                                   has graduated; omit it (null) before that.
 *   2. update_fee_shares_v2       — sets the FINAL list and revokes the admin. Callable ONCE.
 *                                   Rules: non-empty, <= 10 entries, no duplicates, every
 *                                   bps > 0, sum(bps) == 10_000.
 *   3. transfer_creator_fees_to_pump_v2 / distribute_creator_fees_v2 — sweeps + payouts.
 *
 * SDK signatures used verbatim:
 *   PUMP_SDK.createFeeSharingConfig({ creator, mint, pool })
 *   PUMP_SDK.updateFeeSharesV2({ authority, mint, currentShareholders, newShareholders,
 *                                quoteMint, quoteTokenProgram, bondingCurveComplete })
 */

import { PUMP_SDK, type Shareholder } from "@pump-fun/pump-sdk";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";

export const TOTAL_BPS = 10_000;
export const MAX_SHAREHOLDERS = 10;

/** Wrapped SOL — the quote mint for a SOL-paired coin, per the docs. */
export const WRAPPED_SOL = new PublicKey("So11111111111111111111111111111111111111112");
/** Classic SPL Token program (the quote side of a SOL pair is wrapped SOL, not Token-2022). */
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type ShareSpec = { address: string; bps: number };

export type ShareIssue = { index: number; field: string; message: string };

/** Every rule the program enforces, checked before a transaction is ever built. */
export function validateShares(shares: ShareSpec[]): ShareIssue[] {
  const issues: ShareIssue[] = [];

  if (shares.length === 0) {
    issues.push({ index: -1, field: "shares", message: "must contain at least one shareholder" });
  }
  if (shares.length > MAX_SHAREHOLDERS) {
    issues.push({
      index: -1,
      field: "shares",
      message: `${shares.length} entries exceeds the program maximum of ${MAX_SHAREHOLDERS}`,
    });
  }

  shares.forEach((s, index) => {
    try {
      new PublicKey(s.address);
    } catch {
      issues.push({ index, field: "address", message: `"${s.address}" is not a valid Solana address` });
    }
    if (!Number.isInteger(s.bps)) {
      issues.push({ index, field: "bps", message: "must be a whole number of basis points" });
    } else if (s.bps <= 0) {
      issues.push({ index, field: "bps", message: "every share must be greater than 0" });
    } else if (s.bps > TOTAL_BPS) {
      issues.push({ index, field: "bps", message: `cannot exceed ${TOTAL_BPS}` });
    }
  });

  const seen = new Map<string, number>();
  shares.forEach((s, index) => {
    const key = s.address.trim();
    if (seen.has(key)) {
      issues.push({ index, field: "address", message: `duplicate of entry ${(seen.get(key) ?? 0) + 1}` });
    } else {
      seen.set(key, index);
    }
  });

  const sum = shares.reduce((acc, s) => acc + (Number.isFinite(s.bps) ? s.bps : 0), 0);
  if (shares.length > 0 && sum !== TOTAL_BPS) {
    issues.push({
      index: -1,
      field: "sum",
      message: `the shares must sum to exactly ${TOTAL_BPS} bps; they sum to ${sum}`,
    });
  }

  return issues;
}

/** The platform default: 70% to the user's wallet, 30% to the platform treasury. */
export function defaultSplit(userWallet: string, platformTreasury: string): ShareSpec[] {
  const userBps = Number(process.env.FEE_SHARE_USER_BPS ?? 7000);
  const platformBps = Number(process.env.FEE_SHARE_PLATFORM_BPS ?? 3000);
  return [
    { address: userWallet, bps: userBps },
    { address: platformTreasury, bps: platformBps },
  ];
}

/**
 * When the launching user names NO wallet to receive their share, there is no split at all:
 * the treasury takes 10000 bps. The program rejects an empty list, so this must be an explicit
 * single-shareholder list rather than "no shareholders".
 */
export function treasuryOnlySplit(platformTreasury: string): ShareSpec[] {
  return [{ address: platformTreasury, bps: TOTAL_BPS }];
}

/** One place that decides the split, so the UI, the API and the bot cannot disagree. */
export function resolveSplit(params: {
  feeReceiver?: string | null;
  platformTreasury: string;
}): { shares: ShareSpec[]; mode: "split" | "treasury-only" } {
  const receiver = params.feeReceiver?.trim();
  if (!receiver) {
    return { shares: treasuryOnlySplit(params.platformTreasury), mode: "treasury-only" };
  }
  return { shares: defaultSplit(receiver, params.platformTreasury), mode: "split" };
}

function connection(): Connection {
  const url = serverRpcUrl(true);
  return new Connection(url, "confirmed");
}

async function serialize(ixs: Awaited<ReturnType<typeof PUMP_SDK.createFeeSharingConfig>>[], feePayer: PublicKey) {
  const conn = connection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer, recentBlockhash: blockhash });
  for (const ix of ixs) tx.add(ix);
  return {
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    recentBlockhash: blockhash,
    instructions: tx.instructions.length,
  };
}

/**
 * Build `create_fee_sharing_config` (+ the follow-up `update_fee_shares_v2` when a final
 * split is supplied). Returns unsigned base64 transactions; signing is the caller's job.
 *
 * `pool` must be null for a coin that has not graduated — passing a pool that does not exist
 * is a hard failure, so it is opt-in.
 */
export async function buildFeeSharingTransactions(params: {
  mint: string;
  creator: string;
  /** Final shareholders. Omit to only create the config with the default single creator share. */
  shares?: ShareSpec[];
  /** Pump AMM pool address — required only for a graduated coin. */
  pool?: string | null;
}) {
  const mint = new PublicKey(params.mint);
  const creator = new PublicKey(params.creator);
  const pool = params.pool ? new PublicKey(params.pool) : null;

  if (params.shares) {
    const issues = validateShares(params.shares);
    if (issues.length > 0) {
      throw new Error(
        `invalid fee shares: ${issues.map((i) => `${i.field} (entry ${i.index + 1}): ${i.message}`).join("; ")}`,
      );
    }
  }

  const createIx = await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool });

  if (!params.shares) {
    const created = await serialize([createIx], creator);
    return { create: created, update: null, note: "config only: shareholders default to [(creator, 10000)]" };
  }

  const newShareholders: Shareholder[] = params.shares.map((s) => ({
    address: new PublicKey(s.address),
    shareBps: s.bps,
  }));

  const updateIx = await PUMP_SDK.updateFeeSharesV2({
    authority: creator, // must equal sharing_config.admin — the creator right after creation
    mint,
    currentShareholders: [creator], // the initial [(creator, 10_000)] set
    newShareholders,
    quoteMint: WRAPPED_SOL,
    quoteTokenProgram: TOKEN_PROGRAM,
    bondingCurveComplete: false,
  });

  const create = await serialize([createIx], creator);
  const update = await serialize([updateIx], creator);
  return {
    create,
    update,
    note: "permanent: update_fee_shares_v2 revokes the admin, so this split can never be changed",
  };
}
