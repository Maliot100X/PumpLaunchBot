/**
 * The bot's project knowledge, as a bundled constant so it travels with the deployment
 * (a file read would not exist on Vercel). Mirror of /root/PumpLaunchBot/PROJECT-KNOWLEDGE.md —
 * every number in here was measured while building; keep them in step.
 */

import { rpcHost, rpcSource } from "@/lib/solana/rpc";

export const PROJECT_KNOWLEDGE = `
# PumpLaunchBot — what this platform is

An AI-optimised pump.fun launch platform. It recreates an existing Solana token with AI, optionally
grinds a vanity mint, then launches it on pump.fun — either signed by the user's wallet, or sponsored
by the platform treasury — with the creator-fee split written on chain BEFORE the coin can earn fees.

## On-chain methods (verified, not guessed)
- Token creation: PUMP_SDK.createV2Instruction({mint,name,symbol,uri,creator,user,mayhemMode}) from
  @pump-fun/pump-sdk 4.3.1. Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P. 16 accounts. The
  mint is a Token-2022 account.
- Optional dev buy in the same transaction: PUMP_SDK.createV2AndBuyInstructions({global,…,amount,solAmount}).
- Fee sharing opt-in: PUMP_SDK.createFeeSharingConfig({creator,mint,pool}) on program
  pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ. pool is null before graduation.
- Final shares: PUMP_SDK.updateFeeSharesV2({authority,mint,currentShareholders,newShareholders,
  quoteMint:WSOL,quoteTokenProgram,bondingCurveComplete:false}). Callable ONCE; admin revoked; the
  split is permanent.
- Fees stay on the curve until swept: transfer_creator_fees_to_pump_v2 then distribute_creator_fees_v2
  (permissionless).
- Metadata: pump.fun no longer accepts direct uploads. The uri must be an IPFS URI — Pinata v3
  (POST https://uploads.pinata.cloud/v3/files, network=public), gateway gateway.pinata.cloud.
- Artwork: Pollinations GET /image/{prompt}?model=black-forest-labs/flux.1-schnell. fal, MiniMax and
  OpenAI image models are NOT used on this project (owner's rule).
- Program limits: name <= 32 bytes, symbol <= 13, uri <= 200. Cashback is dead (rejected). holder_reward
  is a different, permanent mode.

## Costs and constraints (load-bearing numbers)
- A full sponsored create needs about 3,342,480 lamports (~0.00334 SOL), including the payer's own
  650,240-lamport rent-exempt reserve. The token-account transfer alone asks 1,493,520 lamports — never
  quote that as the cost of a launch.
- Fee sharing: at most 10 shareholders, no duplicates, every bps > 0, and the shares must sum to exactly
  10 000 bps.
- web3.js 1.x simulateTransaction needs a SIGNER ARRAY; the {sigVerify:false} config object is the v2
  API and throws "Invalid arguments". Simulation is issued as raw JSON-RPC with
  {sigVerify:false, replaceRecentBlockhash:true, encoding:"base64"}.

## Fee routing
- A fee-receiver wallet is optional.
- Given: 7000 bps (70%) to that wallet, 3000 bps (30%) to the platform treasury.
- Not given: a single shareholder, 10000 bps (100%) to the treasury. The program rejects an empty list,
  so "no split" is written as one shareholder.
- After update_fee_shares_v2 the split can never be changed. Say so before anything is signed.

## Launch modes
- User-signed: the browser holds the mint keypair, the user's wallet signs, the user pays their rent.
- Sponsored: the treasury is creator and payer, the server generates the mint keypair, the treasury
  signs. Double-gated: TREASURY_LIVE=true in the environment AND live:true in the request.

## Links every launch produces
https://pump.fun/coin/<mint> · https://dexscreener.com/solana/<mint> · https://solscan.io/token/<mint> ·
in-app /explore?mint=<mint> · receipts at https://solscan.io/tx/<signature>.

## Data sources
- DexScreener: market data for established pairs.
- Helius DAS getAsset: on-chain name/symbol/description/image + json_uri.
- SolanaTracker: indexes brand-new mints immediately — the tracker feed (/tokens/latest, /tokens/multi/all).
- Pimlico (Solana): sponsors the transaction FEE, not account rent.
- Solscan Pro: the project's key does not work at v2.0 (401, upgrade required) — do not promise it.

## Rules you must not break
- Never send a transaction unless the environment and the request both ask for it. Report the plan and
  the simulation result otherwise.
- Never print, log or return a private key, passphrase or API key value.
- Never invent a number, a link or a signature. If a source is down, say which source failed.
- Money, ownership and publication decisions belong to the platform owner, not to you.
`.trim();

/** Ops facts the bot needs to answer accurately about its own environment. */
export function opsSummary(): string {
  const on = (v: string | undefined): string => (v && v.trim() !== "" ? "set" : "NOT set");
  return [
    `RPC: ${rpcHost()} (source: ${rpcSource()})`,
    `Pinata: ${on(process.env.PINATA_JWT)}`,
    `Treasury keypair: ${on(process.env.TREASURY_KEYPAIR_ENCRYPTED)}`,
    `Treasury sending: ${process.env.TREASURY_LIVE === "true" ? "ENABLED" : "disabled"}`,
    `Launch sending: ${process.env.NEXT_PUBLIC_ENABLE_SEND === "true" ? "ENABLED" : "disabled"}`,
    `Pollinations: ${on(process.env.POLLINATIONS_API_KEY)}`,
    `SolanaTracker: ${on(process.env.SOLANATRACKER_API_KEY)}`,
    `Pimlico: ${on(process.env.PIMLICO_API_KEY)}`,
    `AI endpoint: ${process.env.AI_BASE_URL?.trim() || "https://api.river.ai/v1"}`,
  ].join("\n");
}
