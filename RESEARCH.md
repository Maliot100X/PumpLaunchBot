# PumpLaunchBot — Phase 0 research summary

Researched: 2026-10-23 UTC · every claim below was read from the source this session, not recalled.
Raw material kept in `/root/PumpLaunchBot/_research/` (cloned docs + OpenAPI spec + captured page text).

---

## 1. SOURCES READ (what each one actually gave)

| Source | What was extracted |
|---|---|
| `pump-fun/pump-public-docs` (GitHub, cloned) | The authoritative instruction docs: `docs/instructions/COIN_CREATION.md` (create_v2 account list + argument table), `docs/instructions/CREATOR_FEE_SHARING.md` (4-instruction lifecycle), `HOLDER_REWARDS_README.md`, `SWEEP_FEES.md`, `TRADE_V3.md`, `CLAIM_CASHBACK.md`, `FAQ.md`, plus the repo README's changelog (fees stay on the curve; v3 trade instructions; depth-2 pump-coin quotes). |
| `@pump-fun/pump-sdk` 4.3.1 (npm, packed + inspected) | Exact TS surface: `createV2Instruction`, `createV2AndBuyInstructions`, `createV2AndBuyV2Instructions`, `createFeeSharingConfig`, `updateFeeSharesV2` (also `updateFeeShares`, `transferFeeSharingAuthority`, `revokeFeeSharingAuthority`, `feeSharingConfigPda`), class `OnlinePumpSdk` / `PumpSdk`, typed errors (`TooManyShareholdersError`, `InvalidShareTotalError`, `DuplicateShareholderError`, `ZeroShareError`, `CreatorFeeBpsOutOfRangeError`, `HolderRewardDisabledError`). GitHub repo `pump-fun/pump-sdk` is **not publicly clonable** (auth prompt) → npm is the distribution channel. |
| `pumpportal.fun/creation/` (and the doc tree: Lightning API, Local API, Data API, Claim Creator Fees, Wallet Creation, Fees) | Token creation via their API; **the old `pump.fun/api/ipfs` metadata upload is dead** — metadata must be pinned to IPFS (their examples now use Pinata `https://uploads.pinata.cloud/v3/files`). Documented pattern: upload image → build metadata JSON → upload JSON → get the create tx. Lightning API = server pays + their fee; Local API (`/api/trade-local`) returns an unsigned tx you sign yourself. |
| `grindcore.fun` + `/#/dev` | Vanity grinder UX + the developer surface: browser WASM multi-thread grinder (keys never leave the browser), CLI `node cli/grindcore.mjs --start moon --end pump --ignore-case --count 3 --out ./keys`, and a core API `import { grind, keypairJson } from './src/core/grind.js'; import { expectedKeys } from './src/core/pattern.js'`. Output = standard 64-byte JSON keypairs. Their own launch snippet uses PumpPortal `/api/trade-local` action `create` with `mint`, dev buy, slippage, priorityFee, `pool: 'pump'`, signed by `[mintKeypair, creator]`. Cost table matters for the UI: `…pump` ≈ 11.3M keys avg (~7 min 4-thread), `moon…` ≈ 45.7M, `moon…pump` ≈ 517T (GPU only). |
| `otcdesks.cash/docs` | The fee-recycling model and, critically, the wallet topology a platform uses: separate public wallets for launcher rewards, Meteora rewards, desk pot, buyback, protocol. Their launcher converts **creator fees** into holder yield — i.e. fee sharing is the money path, exactly what we implement with `createFeeSharingConfig` + `updateFeeSharesV2`. The docs sidebar exposes "Launching from your own app" + "The fields" + "The numbers" + "The accounts", but the page is a client-rendered docs SPA whose section bodies did not resolve through text extraction this session → **gap, retry with the browser in Phase 3** (only their marketing-level flow is captured so far). |
| `heyclawlaunch.vercel.app` (+ `/docs`) | The sponsored-launch UX to mirror: "0 SOL / no dev buy / never a dev buy", **platform covers the ~0.03 SOL rent and network fee**, user only chooses where fees go (wallet, X account, or holders), 80/20 creator/platform split on their side, phone-call/chat launch flow, MCP connector at `/mcp`, agent skill published at `/skill.md`, live table of launched coins with fees-route and curve progress. Verified: 18 coins launched, 0.37 SOL raised on curves. |
| DexScreener API (live probe) | `GET https://api.dexscreener.com/latest/dex/tokens/{mint}` → 200, 30 pairs for SOL; fields confirmed: `chainId`, `dexId`, `url`, `priceUsd`, `liquidity`, `info.imageUrl`, `info.header`, `info.websites[]`, `info.socials[]`. That is the token-data source for "fetch full data from an existing token". |
| GitHub search (authenticated) | Candidates to clone/read: `rckprtr/pumpdotfun-sdk` (817★), `cicere/pumpfun-bundler` (442★, create+bundle), `bilix-software/pump-fun-token-launcher` (167★), `slightlyuseless/pumpfun-terminal` (57★, self-hosted web launcher), `nirholas/pump-fun-sdk` (138★), `nirholas/atomic` (launch/collect/trade scripts), `MeteoraAg/dynamic-bonding-curve-sdk` (43★, official Meteora DBC TS SDK), `WincerChan/SolVanityCL` (185★ GPU vanity), `m2-labs/vanity-solana` (50★), `ziglana/grincel.gpu`. |

---

## 2. THE STACK I CHOSE (and why)

**Frontend / platform**
- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui components.
- `@solana/wallet-adapter-react` + `-react-ui` + `-wallets` (Phantom/Solflare) for user-signed mode.
- Deploy target: **Vercel**, repo **public, named exactly `PumpLaunchBot`**.

**Chain**
- `@solana/web3.js` (legacy or v2 — pinned after a version check in Phase 1) + `@pump-fun/pump-sdk` 4.3.1.
- RPC: **Helius mainnet** (already live on this box: `HELIUS_MAINNET_RPC` + `HELIUS_API_KEY`), devnet RPC also present for dry runs.
- Token creation: `PUMP_SDK.createV2Instruction(...)` — primary path, no third-party fee, full control of `mint`, `name`, `symbol`, `uri`, `creator`, and the coin's fee mode. Dev buy in the same tx with `createV2AndBuyInstructions`.
- Fallback / cross-check: PumpPortal `/api/trade-local` action `create` (returns a `VersionedTransaction` you sign locally) — used to A/B the tx against the SDK, never as the only path.

**Metadata**
- Pinata: image → `POST https://uploads.pinata.cloud/v3/files` (network=public) → CID → metadata JSON (`name, symbol, image, description, twitter, telegram, website`) → upload → `uri = https://ipfs.io/ipfs/<cid>`. Keys already on the box (`PINATA_API_KEY`, `PINATA_API_SECRET`, `PINATA_JWT`).
- Constraint from the instruction table: `name ≤ 32 chars`, `symbol ≤ 13`, `uri ≤ 200`.

**Fee sharing (the money path)**
- Lifecycle, exactly as documented: 1) `create_fee_sharing_config` (PDA for the coin, initial shareholders `[(creator, 10_000)]`), 2) `update_fee_shares_v2` — sets the FINAL list, **once**, admin revoked after, **sum must equal 10 000 bps**, **max 10 shareholders**, no duplicates, every bps > 0, 3) AMM-side sweep (`transfer_creator_fees_to_pump_v2`) and 4) `distribute_creator_fees_v2` (permissionless payout).
- Our default split: **70% user wallet / 30% platform treasury** (7000/3000 bps).
- The permanence is a feature to surface in the UI: after `update_fee_shares_v2` the split can never be changed — the dashboard must show a confirm dialog with the exact bps before signing.

**Vanity CA**
- Primary: **client-side Web-Worker grinder** (ed25519 loop in the browser, key never leaves the machine), mirroring grindcore's core API (`expectedKeys(patterns)` for the ETA, `grind(...)` with `onProgress`/`onFound`). Ship it with a difficulty/ETA estimator and the same honest cost table (suffix `…pump` is minutes; both-ends patterns are GPU-only).
- Server-side alternative for big patterns: `solana-keygen grind` (needs the Solana CLI, currently MISSING) or a GPU tool (`SolVanityCL`/`grincel.gpu`) — documented as an optional path, never required for the happy flow.

**Sponsored launch (platform pays)**
- Treasury keypair held **encrypted** (AES-256-GCM, passphrase/key from env; KMS-style: ciphertext in env `TREASURY_KEY_ENCRYPTED`, never plaintext in the repo).
- Treasury pays the ~0.03 SOL rent + fees; the user only supplies the destination fee-share wallet. Mirrors HeyClaw's "0 SOL, no dev buy" model.

**Platform services**
- Postgres (Neon) for launched-token records + treasury ledger; Upstash Redis for rate-limit/queue/cache of DexScreener calls; Jupiter key available if swaps are needed later.
- Bot/agent brain: one internal API surface (`/api/agent/*`) the bot calls — same code path the UI uses, so the bot can launch, read treasury balance and inspect fee config without a second implementation.

---

## 3. FLOWS (end state, exact)

**A. Recreate-optimized flow**
1. User pastes a token mint (or DexScreener link) → `GET /api/token/:mint` → DexScreener `/latest/dex/tokens/{mint}` + on-chain metadata fallback.
2. AI analysis: name/ticker/description/links/image → optimized name, ticker, description, links, and an **image prompt**.
3. Image generated with **Pollinations `black-forest-labs/flux.1-schnell`** (owner's standing rule; never fal/MiniMax/OpenAI image models) → optionally edited with `flux.1-kontext-pro` via `/v1/images/edits`.
4. Preview card → user picks: sign themselves, or sponsored launch.

**B. User-signed launch**
Build tx server-side (`createV2Instruction` + optional `createV2AndBuyInstructions` + `createFeeSharingConfig`/`updateFeeSharesV2` where legal in the same flow) → serialize → client signs with the connected wallet → send via RPC → confirm → record in DB → live tracker picks it up.

**C. Sponsored launch**
Server decrypts treasury key in memory → signs the same instruction set (treasury = `creator`, payer) → user's wallet is a fee-share recipient, chain destination only → confirm → record with `mode: sponsored` and the treasury debit in the ledger.

**D. Live tracking**
Poller (Upstash-backed watermark) → DexScreener + on-chain curve state → dashboard row: MCAP, curve %, fees accrued, fee recipients, age.

---

## 4. TOOLS / PACKAGES TO INSTALL (when the phase needs them)

Already on the box: node 26.7, npm 12, uv/uvx, docker, Helius RPC, Pinata, Upstash, Neon, Jupiter, Pollinations, Browser Use, GITHUB_PAT (in `.cwc-secrets/stack.env`, quoted — strip quotes when reading), Vercel token.

To add during build: `@solana/web3.js`, `@solana/wallet-adapter-*`, `@pump-fun/pump-sdk`, `@pinata/sdk` (or plain fetch), `@upstash/redis`, `postgres`/`drizzle`, `next`, `tailwindcss`, `shadcn`, `zod`, `@noble/ed25519` (browser grinder), `vitest`/`playwright` for tests. Optional: Solana CLI (for `solana-keygen grind` + keypair inspection), `gh` CLI.

Clones worth reading (not dependencies): `rckprtr/pumpdotfun-sdk`, `cicere/pumpfun-bundler`, `bilix-software/pump-fun-token-launcher`, `slightlyuseless/pumpfun-terminal`, `MeteoraAg/dynamic-bonding-curve-sdk`.

---

## 5. OPEN ITEMS / BLOCKERS (stated plainly, not guessed)

1. **Treasury funding is the hard blocker for sponsored mode.** The only wallet on this box holds **0.0035 SOL** (~$0.70); each sponsored launch needs ~0.03 SOL of rent+fees. Signing mode works with any user wallet — sponsored mode needs a funded treasury keypair supplied by the owner.
2. **`otcdesks` "The fields" / "The accounts" sections unresolved** (client-rendered docs) — retry in Phase 3 with the browser; not needed for phases 1-2.
3. **Solana CLI not installed** — only needed for the optional CLI grinding path; the browser grinder needs nothing.
4. **Neon/Upstash wiring** exists as keys, not yet as a provisioned project — Phase 2 will create the schema and prove the connection with a live query before any UI depends on it.
5. Repo creation (public `PumpLaunchBot`) and Vercel project will be done at the end of Phase 2, once there is a build that actually compiles.
