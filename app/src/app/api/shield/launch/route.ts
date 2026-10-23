import { NextResponse } from "next/server";
import { z } from "zod";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { pinTokenMetadata } from "@/lib/pinata";
import { buildCreateTransaction, simulateCreate, validateLaunchInput, type CreateLaunchInput } from "@/lib/pump/create";
import { buildFeeSharingTransactions, resolveSplit, validateShares } from "@/lib/pump/fee-sharing";
import { loadTreasury } from "@/lib/treasury";
import { tokenLinks } from "@/lib/links";

/**
 * POST /api/shield/launch — the second half of the Shield tab.
 *
 * Shield scans a token and the recreate brain proposes a stronger identity. This route turns that
 * proposal into an actual launch plan, in ONE of two modes, and it is the same code path the launch
 * tab uses, so the two screens cannot drift apart:
 *
 *   mode "self"      — the launching user pays and signs everything. Their connected wallet is the
 *                      payer AND the creator/fee-recipient. Fees stay with them.
 *   mode "sponsored" — the platform treasury pays and signs. The user only names the wallet that
 *                      receives their share of the creator fees.
 *
 * Both modes write the SAME on-chain fee split: 70% (7000 bps) to the user's wallet, 30% (3000 bps)
 * to the platform treasury, or 100% to the treasury when the user names no wallet (the program
 * rejects an empty shareholder list, so that case must be an explicit single entry).
 *
 * What this route does NOT do: it never sends anything, and in "self" mode it never holds a user
 * key. The mint keypair is generated here because create_v2 requires the mint's signature, and its
 * secret is returned exactly once so the caller can sign and keep the mint's history.
 */

const Body = z.object({
  /** The token that was scanned — kept for provenance in the response, not used to sign. */
  sourceMint: z.string().trim().min(32).max(44).optional(),
  name: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  description: z.string().trim().max(2000).default(""),
  /** IPFS gateway URL of the artwork the recreate step already pinned. */
  imageUri: z.string().trim().url(),
  mode: z.enum(["self", "sponsored"]),
  /** mode "self": the connected wallet — payer, creator and fee recipient. */
  user: z.string().trim().min(32).max(44).optional(),
  /** Where the launcher wants their 70%. Absent => the treasury keeps 100%. */
  feeWallet: z.string().trim().min(32).max(44).optional(),
  /** Optional pre-ground mint (the grinder tab produces one). */
  mint: z.string().trim().min(32).max(44).optional(),
  links: z
    .object({
      twitter: z.string().trim().url().optional(),
      telegram: z.string().trim().url().optional(),
      website: z.string().trim().url().optional(),
    })
    .optional(),
});

function bad(error: string, detail: string | string[], status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

/** A base58 Solana address, checked the same way the fee-sharing builder checks it. */
function isAddress(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return bad("invalid_json", "the request body was not JSON");
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return bad(
      "invalid_body",
      parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
    );
  }
  const body = parsed.data;
  const warnings: string[] = [];

  // --- who receives the 70% -----------------------------------------------------------------
  const treasury = loadTreasury();
  const treasuryAddress = treasury?.publicKey.toBase58() ?? process.env.PLATFORM_TREASURY_PUBKEY?.trim() ?? null;
  if (!treasuryAddress) {
    return bad("treasury_unconfigured", "PLATFORM_TREASURY_PUBKEY / treasury keypair is not configured", 503);
  }
  if (!isAddress(treasuryAddress)) {
    return bad("treasury_invalid", "the configured platform treasury is not a valid Solana address", 503);
  }

  // In "self" mode the launcher IS the creator, so their wallet is the fee recipient by default.
  const feeReceiver = body.feeWallet ?? (body.mode === "self" ? body.user ?? null : null);
  if (feeReceiver && !isAddress(feeReceiver)) {
    return bad("invalid_fee_wallet", `"${feeReceiver}" is not a valid Solana address`);
  }

  const { shares, mode: splitMode } = resolveSplit({ feeReceiver, platformTreasury: treasuryAddress });
  const shareIssues = validateShares(shares);
  if (shareIssues.length > 0) {
    return bad(
      "invalid_split",
      shareIssues.map((i) => `${i.field}${i.index >= 0 ? ` (entry ${i.index + 1})` : ""}: ${i.message}`),
      422,
    );
  }
  if (splitMode === "treasury-only") {
    warnings.push(
      "no fee wallet was supplied, so the treasury keeps 10000 bps (100%) of the creator fees — pass feeWallet to split it",
    );
  }

  // --- who pays -----------------------------------------------------------------------------
  let payer: string;
  if (body.mode === "self") {
    if (!body.user) {
      return bad("missing_user", "mode \"self\" needs the connected wallet as `user` — it pays and signs");
    }
    if (!isAddress(body.user)) {
      return bad("invalid_user", `"${body.user}" is not a valid Solana address`);
    }
    payer = body.user;
  } else {
    if (!treasury) {
      return bad("treasury_unconfigured", "sponsored mode needs the treasury keypair, which is not configured", 503);
    }
    payer = treasuryAddress;
  }

  // --- metadata must exist on IPFS before create_v2 can reference it -------------------------
  let metadataUri: string;
  try {
    const metadata = await pinTokenMetadata({
      name: body.name,
      symbol: body.symbol,
      description: body.description,
      imageUri: body.imageUri,
      twitter: body.links?.twitter,
      telegram: body.links?.telegram,
      website: body.links?.website,
    });
    metadataUri = metadata.uri;
  } catch (err) {
    return bad("pin_failed", err instanceof Error ? err.message : "pinning the metadata failed", 502);
  }

  // --- the mint: pre-ground when supplied, otherwise generated here --------------------------
  let mintKeypair: Keypair | null = null;
  let mint: string;
  if (body.mint) {
    if (!isAddress(body.mint)) return bad("invalid_mint", `"${body.mint}" is not a valid Solana address`);
    mint = body.mint;
    // A caller-supplied mint must still sign create_v2, and we do not have its key here.
    warnings.push(
      "a pre-ground mint was supplied: create_v2 also requires THAT keypair's signature, so the caller must sign with it",
    );
  } else {
    mintKeypair = Keypair.generate();
    mint = mintKeypair.publicKey.toBase58();
  }

  // In "self" mode the creator is the user; in sponsored mode the treasury is the creator and
  // redistributes through the split.
  const creator = body.mode === "self" ? payer : treasuryAddress;
  const createInput: CreateLaunchInput = {
    mint,
    name: body.name,
    symbol: body.symbol,
    uri: metadataUri,
    creator,
    user: payer,
  };

  const issues = validateLaunchInput(createInput);
  if (issues.length > 0) {
    return NextResponse.json({ ok: false, error: "invalid_launch_input", issues }, { status: 422 });
  }

  let createTransaction: string;
  let createSimulation: Awaited<ReturnType<typeof simulateCreate>>;
  let feeTx: Awaited<ReturnType<typeof buildFeeSharingTransactions>>;
  try {
    const built = await buildCreateTransaction(createInput);
    createTransaction = built.transaction;

    // create_v2 requires the mint's own signature. For a generated mint we sign it here; the
    // remaining signature (payer) is the caller's. For a supplied mint, the caller signs both.
    if (mintKeypair) {
      const tx = Transaction.from(Buffer.from(createTransaction, "base64"));
      tx.partialSign(mintKeypair);
      createTransaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    }

    createSimulation = await simulateCreate(createTransaction);

    // Two transactions, never one: create + fee-sharing together is ~1,280 bytes and pump's
    // ceiling is 1,232, so packing them always fails. See lib/pump/tx-limit.ts.
    feeTx = await buildFeeSharingTransactions({ mint, creator, shares, pool: null });
  } catch (err) {
    return bad("build_failed", err instanceof Error ? err.message : "building the launch failed", 502);
  }

  if (!createSimulation.ok) {
    warnings.push(`the create transaction did not simulate cleanly: ${createSimulation.err}`);
  }

  return NextResponse.json({
    ok: true,
    mode: body.mode,
    note:
      body.mode === "self"
        ? "nothing was sent: sign create, then the fee-sharing config, then update the shares — in that order, as separate transactions"
        : "nothing was sent: sponsored sending needs TREASURY_LIVE=true and an explicit live:true",
    source: body.sourceMint ? { mint: body.sourceMint } : null,
    launch: {
      mint,
      /** Returned ONCE, and only when this route generated the mint, so the caller can sign. */
      mintSecretKey: mintKeypair ? Array.from(mintKeypair.secretKey) : null,
      mintWasGenerated: mintKeypair !== null,
      name: body.name,
      symbol: body.symbol,
      metadataUri,
      payer,
      creator,
      treasury: treasuryAddress,
    },
    feeSharing: {
      shares,
      splitMode,
      /** Step 1 of the fee-sharing pair: create the config (never packed with create_v2). */
      createConfig: feeTx.create.transaction,
      /** Step 2: write the final shares. This call revokes the admin, so the split is permanent. */
      updateShares: feeTx.update?.transaction ?? null,
      note: feeTx.note,
      userBps: shares.find((s) => s.address !== treasuryAddress)?.bps ?? 0,
      platformBps: shares.find((s) => s.address === treasuryAddress)?.bps ?? 10_000,
    },
    create: { transaction: createTransaction, simulation: createSimulation },
    links: tokenLinks(mint),
    warnings,
  });
}
