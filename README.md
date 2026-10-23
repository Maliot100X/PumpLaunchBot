# PumpLaunchBot

An AI-optimised **pump.fun** launch platform: recreate an existing Solana token with AI, optionally
grind a vanity mint, then launch it — signed by the user's wallet, or **sponsored by the platform
treasury** — with the creator-fee split written **on chain** through pump.fun's own fee-sharing
program *before* the coin can earn anything.

> Status: built and verified locally, phase by phase. No launch has been sent from this repo yet —
> every chain-touching step here is proven by **simulation**, and sending is behind two explicit gates.

---

## What it does

| Feature | Where |
| --- | --- |
| Token data (name, image, ticker, description, links) | DexScreener + Helius DAS `getAsset` |
| AI-optimised recreation (name, ticker, description, art prompt) | `src/lib/agent/*` (tool-calling brain) |
| Metadata pinning | Pinata v3 uploads API (IPFS) |
| Artwork | Pollinations `black-forest-labs/flux.1-schnell` |
| Vanity CA | browser-side Web-Worker ed25519 grinder (phase 5) |
| Launch modes | user-signed wallet **or** treasury-sponsored |
| Creator fee split | `createFeeSharingConfig` + `updateFeeSharesV2` (permanent) |
| Bot / agent | `/api/agent/chat` with 8 real tools + the project knowledge bundled |
| Live tracking | SolanaTracker lifecycle feed + our own launch records |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind · `@solana/web3.js` 1.x ·
`@pump-fun/pump-sdk` 4.3.1 · `@solana/wallet-adapter-*` · zod 4 · Pinata · Helius ·
SolanaTracker · Pimlico (Solana gas sponsorship) · Neon Postgres · Upstash Redis.

## Local setup

```bash
cd app
npm install
cp .env.example .env.local     # then fill it in — see the table below
npm run dev                    # http://localhost:3000
npm run build                  # must be clean before any deploy
node --test tests/api.test.ts  # contract tests (needs the dev server running)
```

### Smoke scripts (each prints the command it ran and the real result)

```bash
node --env-file=.env.local scripts/create-smoke.ts        # builds + simulates a create_v2 tx
node --env-file=.env.local scripts/fee-sharing-smoke.ts   # builds the two fee-sharing txs + validation
node --env-file=.env.local scripts/pinata-smoke.ts        # pins metadata and reads it back
node --env-file=.env.local scripts/data-sources-smoke.ts  # Pimlico + SolanaTracker live status
```

`scripts/encrypt-treasury.ts` turns a private key into the encrypted env blob:

```bash
SOURCE_ENV=/path/with/AGENT_SOLANA_BASE58_PRIVATE_KEY \
TREASURY_PASSPHRASE='at-least-16-characters' \
node scripts/encrypt-treasury.ts
```

## Environment variables (complete list)

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | yes | Helius (or any) mainnet RPC. Every chain call uses it. |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | no | dev fallback cluster when the RPC url is empty. |
| `PINATA_JWT` | yes for launching | IPFS pinning. pump.fun no longer accepts direct metadata uploads. |
| `PINATA_API_KEY` / `PINATA_API_SECRET` | optional | legacy Pinata auth. |
| `PINATA_GATEWAY` | no | defaults to `https://gateway.pinata.cloud/ipfs` (`ipfs.io` now refuses plain HTTP clients). |
| `TREASURY_KEYPAIR_ENCRYPTED` | for sponsored mode | base64 `salt\|iv\|authTag\|ciphertext` of the 64-byte secret key. |
| `TREASURY_KEYPAIR_PASSPHRASE` | for sponsored mode | scrypt passphrase for the blob. |
| `PLATFORM_TREASURY_PUBKEY` | for sponsored mode | the treasury's public address (shown in the UI). |
| `TREASURY_LIVE` | no (default `false`) | `true` + `{"live":true}` are BOTH needed to send a sponsored launch. |
| `FEE_SHARE_USER_BPS` / `FEE_SHARE_PLATFORM_BPS` | no | default `7000` / `3000`; must sum to 10000. |
| `NEXT_PUBLIC_ENABLE_SEND` | no (default `false`) | user-signed sending gate. |
| `DATABASE_URL` | optional | Neon Postgres for launch records + treasury ledger. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | optional | cache + polling watermarks for the tracker. |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | for the bot | OpenAI-compatible endpoint (defaults to River `https://api.river.ai/v1`). |
| `POLLINATIONS_API_KEY` | for artwork | image generation. Model defaults to `flux.1-schnell`. |
| `SOLANATRACKER_API_KEY` | for the live feed | indexes brand-new mints before DexScreener does. |
| `PIMLICO_API_KEY` | optional | Solana gas sponsorship via `https://solana.pimlico.io/v1/mainnet/rpc`. |
| `NEXT_PUBLIC_APP_URL` | after deploy | the Vercel domain, for absolute links. |

## API surface

| Route | Method | What it does |
| --- | --- | --- |
| `/api/token/[mint]` | GET | merged on-chain + market snapshot (400 invalid, 404 unknown). |
| `/api/pin` | POST | pins image + metadata JSON to IPFS, returns the `uri`. |
| `/api/launch/prepare` | POST | builds `create_v2` and **simulates** it. Never sends. |
| `/api/launch/sponsored` | POST | treasury plan (+ real pump.fun links); sends only if double-gated. |
| `/api/treasury` | GET | treasury address, balance, rent per launch, launches affordable. |
| `/api/agent/chat` | POST | the bot: tool-calling loop, returns the answer **and** its tool trail. |
| `/api/agent/knowledge` | GET | what the bot knows, its tools, and the live environment summary. |

## Deploy to Vercel

1. Import the GitHub repo in Vercel.
2. **Root Directory: `app`** (the Next app lives in `app/`, the repo root holds the docs).
3. Framework preset: Next.js. Build command `npm run build`. Install `npm install`. No extra output config.
4. Add every variable from the table above in **Settings → Environment Variables** (Production +
   Preview). `NEXT_PUBLIC_*` values are shipped to the browser; everything else stays server-side.
5. Deploy. After the domain is assigned, set `NEXT_PUBLIC_APP_URL` to it and redeploy once so
   absolute links resolve.

### Not on localhost

Nothing in this project requires a loopback URL: the API routes are same-origin paths, the tracker
pollers run server-side, and there is no OAuth redirect to register. The only wall-clock dependency
is the RPC endpoint, which is public.

## Hard facts the code is built around

- A full **sponsored create costs ≈ 3,342,480 lamports** (~0.00334 SOL), including the payer's own
  650,240-lamport rent reserve. (The token-account transfer alone is 1,493,520 — not the full cost.)
- Fee sharing: ≤ 10 shareholders, no duplicates, every bps > 0, `sum == 10_000`, and
  `update_fee_shares_v2` can be called **once** — after it the split is permanent.
- With **no fee receiver** the treasury takes 10000 bps; the program rejects an empty shareholder list.
- `web3.js` 1.x `simulateTransaction` takes a signer array — the `{sigVerify:false}` object is the v2
  API and throws. Simulation here goes through raw JSON-RPC.
- Cashback coins can no longer be created; `holder_reward` is a different, permanent mode.

## Security

- No key is in the repository: the treasury lives encrypted in the environment; only its public
  address is displayed. `.env*` is gitignored, `.env.example` is the contract.
- No secret is ever logged or returned by an API (one contract test asserts this on `/api/treasury`).
- Sending is double-gated, and an unfunded/unset treasury disables sponsored mode in the UI instead
  of failing in front of a user.
