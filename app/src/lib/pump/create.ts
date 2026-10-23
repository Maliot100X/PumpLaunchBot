/**
 * Phase 3 — the launch flow (server side).
 *
 * Builds the pump.fun create transaction with the OFFICIAL SDK, never by hand-assembling
 * accounts. Verified against @pump-fun/pump-sdk 4.3.1's shipped types:
 *   PUMP_SDK.createV2Instruction({ mint, name, symbol, uri, creator, user, mayhemMode, ... })
 *   new OnlinePumpSdk(connection)  -> fetchGlobal(), createV2AndBuyInstructions(...)
 *
 * Hard rules encoded here:
 *  - metadata limits from the program: name <= 32, symbol <= 13, uri <= 200
 *  - the mint must be a FRESH keypair whose public key the caller controls (it signs the create)
 *  - cashback is dead: `cashback` is never passed as true
 *  - nothing is ever sent from this module: it returns a transaction and, separately,
 *    a simulation result. Sending is a user action.
 */

import { PUMP_SDK } from "@pump-fun/pump-sdk";
import {
  Connection,
  PublicKey,
  Transaction,
  type AccountMeta,
} from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";

export const METADATA_LIMITS = { name: 32, symbol: 13, uri: 200 } as const;

export type CreateLaunchInput = {
  /** Public key of a fresh mint keypair the caller holds (grinded or generated). */
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  /** Fee recipient / creator address on chain. */
  creator: string;
  /** Payer of rent + fees, and the transaction fee payer. */
  user: string;
  mayhemMode?: boolean;
};

export type ValidationIssue = { field: string; message: string };

export function validateLaunchInput(input: Partial<CreateLaunchInput>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const pubkey = (value: string | undefined, field: string): void => {
    if (!value) {
      issues.push({ field, message: "required" });
      return;
    }
    try {
      new PublicKey(value);
    } catch {
      issues.push({ field, message: "not a valid base58 Solana address" });
    }
  };

  pubkey(input.mint, "mint");
  pubkey(input.creator, "creator");
  pubkey(input.user, "user");

  if (input.mint && input.creator && input.mint === input.creator) {
    issues.push({ field: "creator", message: "creator must not equal the mint address" });
  }

  const len = (value: string | undefined, field: "name" | "symbol" | "uri"): void => {
    if (!value) {
      issues.push({ field, message: "required" });
      return;
    }
    const limit = METADATA_LIMITS[field];
    // The program counts bytes, not JS characters.
    const bytes = new TextEncoder().encode(value).length;
    if (bytes > limit) {
      issues.push({ field, message: `${bytes} bytes exceeds the ${limit}-byte program limit` });
    }
  };
  len(input.name, "name");
  len(input.symbol, "symbol");
  len(input.uri, "uri");

  if (input.uri && !/^(https?|ipfs):\/\//.test(input.uri)) {
    issues.push({ field: "uri", message: "must be an http(s) or ipfs URI" });
  }

  return issues;
}

export function rpcUrl(): string {
  const url = serverRpcUrl(true);
  return url;
}

export function connection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

export type BuiltCreate = {
  /** base64 of the unsigned transaction, ready for the caller to sign. */
  transaction: string;
  /** blockhash the transaction was built against (it expires — rebuild if stale). */
  recentBlockhash: string;
  /** Who must sign: the fresh mint keypair, plus the payer. */
  signers: string[];
  instructions: number;
  accounts: AccountMeta[];
};

/**
 * Build the `create_v2` transaction. The mint keypair is NOT created here — the caller
 * supplies its public key so the private half never touches this server in user-signed mode.
 */
export async function buildCreateTransaction(input: CreateLaunchInput): Promise<BuiltCreate> {
  const issues = validateLaunchInput(input);
  if (issues.length > 0) {
    throw new Error(`invalid launch input: ${issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
  }

  const conn = connection();
  const mint = new PublicKey(input.mint);
  const creator = new PublicKey(input.creator);
  const user = new PublicKey(input.user);

  const createInstruction = await PUMP_SDK.createV2Instruction({
    mint,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    creator,
    user,
    mayhemMode: input.mayhemMode ?? false,
    // cashback is deprecated and rejected by create_v2 — deliberately omitted.
  });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: user, recentBlockhash: blockhash }).add(createInstruction);

  return {
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    recentBlockhash: blockhash,
    signers: [mint.toBase58(), user.toBase58()],
    instructions: tx.instructions.length,
    accounts: createInstruction.keys,
  };
}

export type SimulatedCreate = {
  ok: boolean;
  /** `null` when the simulation itself could not run. */
  err: string | null;
  logs: string[];
  unitsConsumed: number | null;
};

/**
 * Verify a built transaction WITHOUT sending it.
 *
 * web3.js 1.x's `Connection.simulateTransaction` only accepts a signer array as its second
 * argument — the `{sigVerify:false}` config object is the v2 API, and passing it throws
 * "Invalid arguments" (measured). This box pins web3.js 1.99 for the pump SDK, so the
 * simulation is issued as a raw JSON-RPC call, which is exactly what the v2 helper does
 * under the hood. `replaceRecentBlockhash: true` keeps it valid past blockhash expiry.
 */
export async function simulateCreate(base64Tx: string): Promise<SimulatedCreate> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "pump-launch-bot-simulate",
      method: "simulateTransaction",
      params: [
        base64Tx,
        {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
          encoding: "base64",
        },
      ],
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`simulate RPC ${res.status}`);
  const body = (await res.json()) as {
    result?: {
      value?: {
        err: unknown;
        logs?: string[] | null;
        unitsConsumed?: number;
        accounts?: unknown;
      };
    };
    error?: { message: string };
  };
  if (body.error) throw new Error(`simulate RPC: ${body.error.message}`);
  const value = body.result?.value;
  if (!value) throw new Error("simulate RPC: empty result");
  return {
    ok: value.err === null || value.err === undefined,
    err: value.err ? JSON.stringify(value.err) : null,
    logs: value.logs ?? [],
    unitsConsumed: value.unitsConsumed ?? null,
  };
}
