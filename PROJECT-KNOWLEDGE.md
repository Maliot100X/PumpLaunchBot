# PumpLaunchBot — project knowledge (the bot's brain, kept factual)

Everything here was measured on this box while building. Nothing is recalled from a tutorial.
If a number below disagrees with the live chain, the chain wins and this file gets corrected.

## 1. What the product does

A dashboard + bot that recreates an existing Solana token with AI, optionally grinds a vanity CA,
then launches it on pump.fun — either signed by the user's wallet or sponsored by the platform
treasury — with the creator-fee split written on chain through pump.fun's own fee-sharing config
before anyone can withdraw anything.

## 2. The exact on-chain methods (verified, not guessed)

| Step | Method | Notes |
| --- | --- | --- |
| Token creation | `PUMP_SDK.createV2Instruction({...})` from `@pump-fun/pump-sdk` 4.3.1 | 16 accounts; program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; mint is Token-2022 |
| Dev buy (optional) | `PUMP_SDK.createV2AndBuyInstructions({ global, …, amount, solAmount, isTokenizedAgent? })` | one transaction, not two |
| Fee sharing opt-in | `PUMP_SDK.createFeeSharingConfig({ creator, mint, pool })` | program `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`; `pool: null` before graduation |
| Fee shares (final) | `PUMP_SDK.updateFeeSharesV2({ authority, mint, currentShareholders, newShareholders, quoteMint, quoteTokenProgram, bondingCurveComplete })` | callable ONCE; admin revoked; sum must be exactly 10 000 bps; ≤ 10 holders |
| Sweep + payout | `transfer_creator_fees_to_pump_v2`, `distribute_creator_fees_v2` | permissionless; fees stay on the curve until swept |
| Metadata | Pinata v3 `POST https://uploads.pinata.cloud/v3/files` (network=public) | `uri` must be an IPFS URI; the old pump.fun `/api/ipfs` upload is dead |
| Artwork | Pollinations `GET /image/{prompt}?model=black-forest-labs/flux.1-schnell` | the owner's rule: no fal / MiniMax / OpenAI image models |
| Token data in | `GET https://api.dexscreener.com/latest/dex/tokens/{mint}` + Helius DAS `getAsset` | market data + real name/symbol/description/image |
| Vanity CA | browser Web-Worker ed25519 loop (grindcore-style) | `…pump` ≈ 11.3M keys; both-ends patterns are GPU territory |

## 3. Measured costs and limits (these numbers are load-bearing)

- **A full sponsored create needs ≈ 3,342,480 lamports (~0.00334 SOL)**, of which 650 240 is the
  payer's own rent-exempt reserve (0-data system account). The token-account transfer alone asks
  1,493,520 lamports — quoting that as "cost per launch" is how a launch fails in front of a user.
- Metadata limits enforced by the program: `name` ≤ 32 **bytes**, `symbol` ≤ 13, `uri` ≤ 200.
- Cashback is dead: `create_v2` rejects `is_cashback_enabled = [true]`.
- `is_holder_reward = [true]` is a different, permanent mode where no creator wallet receives fees.
- Fee sharing: ≤ 10 shareholders, no duplicates, every bps > 0, `sum(bps) == 10 000`, permanent
  after `update_fee_shares_v2`.
- `web3.js` 1.x `simulateTransaction` takes a SIGNER ARRAY, not `{sigVerify:false}` — that config
  object is the v2 API and throws `Invalid arguments`. Simulation is issued as raw JSON-RPC with
  `{sigVerify:false, replaceRecentBlockhash:true, encoding:"base64"}`.

## 4. Fee routing (how the money actually moves)

1. The launching wallet is asked for a **fee-receiver address**.
2. If one is given: `7000 bps` to that wallet, `3000 bps` to the platform treasury.
3. If none is given: a single-entry list, `10000 bps` to the treasury. The program rejects an
   empty shareholder list, so "no split" must be written as one shareholder, not as zero.
4. `create_fee_sharing_config` then `update_fee_shares_v2` run against the fresh mint, and after
   that the split can never be changed — the UI must say so before it is signed.

## 5. Launch modes

- **User-signed**: the browser holds the mint keypair, the wallet signs, the user pays their own
  rent. The server only builds and simulates.
- **Sponsored**: the treasury is `creator` and `user` (payer), the server generates the mint
  keypair, and the treasury signs. The person launching supplies only their fee-receiver wallet.
  Double-gated: `TREASURY_LIVE=true` in the env AND `live:true` in the request.

## 6. Real links every launch produces

`https://pump.fun/coin/<mint>` · `https://dexscreener.com/solana/<mint>` ·
`https://solscan.io/token/<mint>` · in-app `/explore?mint=<mint>` · transaction receipts at
`https://solscan.io/tx/<signature>`.

## 7. pump.fun "agent" stack (researched, deliberately NOT wired)

`@pump-fun/agent-payments-sdk` 3.0.3 ("TypeScript SDK for Pump Agent Payments", a restricted
package that ships as a dependency of the pump SDK) exposes `PumpAgent` / `PumpAgentOffline`, its
own program id (`PUMP_AGENT_PAYMENTS_PROGRAM_ID`), token-agent-payment PDAs, invoices
(`getInvoiceIdPDA`), an accept-payment flow, a buyback authority and a withdraw authority, with
`TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS = 1 412 880`.

That program is for coins that are themselves **payment-accepting agents** (they charge users and
buy back). PumpLaunchBot launches ordinary coins and routes creator fees, so the agent program is
not part of this flow. It is documented here so nobody "discovers" it later and wires a second
program into the launch path by accident. `isTokenizedAgent` on the dev-buy path is the same
feature and stays `false`.

## 8. Known blockers / open items

- **Treasury funding.** The treasury holds 3 306 500 lamports and one create needs 3 342 480, so
  sponsored launches are ~35 980 lamports short. `GET /api/treasury` reports `launchesAffordable: 0`
  rather than pretending otherwise. A top-up of ~0.005 SOL enables it; nothing else changes.
- Postgres (Neon) and Upstash are wired as env vars but not yet used for records/tracking — that is
  the tracking phase, and the code must not claim persistence before it exists.

## 9. Repo layout

```
app/src/lib/pump/create.ts       create_v2 build + validation + simulation
app/src/lib/pump/fee-sharing.ts  share validation, default/treasury-only splits, the two fee txs
app/src/lib/pump/sponsored.ts    sponsored plan + treasury-signed send
app/src/lib/treasury.ts          AES-256-GCM treasury storage, status, signing
app/src/lib/pinata.ts            image + metadata pinning
app/src/lib/links.ts             pump.fun / DexScreener / explorer URLs
app/src/lib/tokens/*             DexScreener + Helius DAS merge
app/src/lib/solana/helius.ts     DAS getAsset + off-chain json_uri
app/scripts/*-smoke.ts           the executable proofs for each phase
```
