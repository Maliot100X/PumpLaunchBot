# Vercel checklist — the exact settings this repo needs

Everything below was verified against the local production build (`npm run build && npm start`) and
the current Vercel docs. Nothing here has been pushed to Vercel yet.

## Project settings

| Setting | Value | Why |
| --- | --- | --- |
| Framework preset | **Next.js** (auto-detected) | Next 16.4.3 is in `app/package.json`. |
| Root Directory | **`app`** | The Next app lives in `app/`; the repo root holds the docs. This is the one setting that must be set by hand — Vercel's auto-detect will not find `package.json` at the root. |
| Build command | `npm run build` (default) | |
| Install command | `npm install` (default) | A `package-lock.json` is committed. |
| Output directory | *(leave default)* | Next.js on Vercel uses the Build Output API; do not set `.next`. |
| Node.js version | **24.x** (Vercel's default) | Pinned in `app/package.json` → `engines.node`. |
| Environment | Production + Preview both need the variables below. | |

## Environment variables

`NEXT_PUBLIC_*` values are **inlined at build time**. They must exist in the Vercel project *before*
the first build, or the deployed client bundle ships empty strings — the classic "it worked locally"
deploy. Everything else is read at runtime by the server.

### Needed for the build to produce a working client bundle

| Variable | Example | Note |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | `https://mainnet.helius-rpc.com/?api-key=…` | Chain reads + wallet provider. |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` | Fallback only. |
| `NEXT_PUBLIC_ENABLE_SEND` | `false` | Keep `false` until the launch test is done. |
| `NEXT_PUBLIC_APP_URL` | *(the assigned domain)* | Set it, redeploy once, and share links become absolute. |
| `NEXT_PUBLIC_PLATFORM_TREASURY_PUBKEY` | treasury address | Shown in the UI; public by definition. |

### Runtime only (server-side, never in the client bundle)

| Variable | Required for | Note |
| --- | --- | --- |
| `PINATA_JWT` | pinning metadata | Without it `/api/pin` fails, so no launch can be prepared. |
| `TREASURY_KEYPAIR_ENCRYPTED` | sponsored launches | 108-byte AES-256-GCM blob, base64. |
| `TREASURY_KEYPAIR_PASSPHRASE` | sponsored launches | scrypt passphrase. |
| `PLATFORM_TREASURY_PUBKEY` | sponsored launches | Canonical name for the address. |
| `TREASURY_LIVE` | sending | `false` now; `true` + `{"live":true}` are both required to send. |
| `AI_API_KEY` (+ `AI_BASE_URL`, `AI_MODEL`) | the Agents tab | Any OpenAI-compatible endpoint; defaults to River. |
| `SOLANATRACKER_API_KEY` | the Launched feed | Without it the page shows its empty notice. |
| `POLLINATIONS_API_KEY` | artwork | Model defaults to `flux.1-schnell`. |
| `PIMLICO_API_KEY` | gas sponsorship | Optional; sponsors the fee, never rent. |
| `FEE_SHARE_USER_BPS` / `FEE_SHARE_PLATFORM_BPS` | fee split | Default `7000` / `3000`, must sum to 10000. |
| `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | launch recording | Optional today: without them the Launched tab says records are not persisted. |

Total budget: 64 KB of environment variables per deployment — this list is a few KB, no risk.

## What is verified before the push

- `npm run build` — clean, 16 routes; `/vault` and `/launched` report `◐` (static shell, streamed live data).
- `npm run lint` — clean (0 errors, 0 warnings).
- `npm test` — 20/20 (10 API contract tests against a running server + 10 vanity grinder tests).
- `npm start` — 7/7 dashboard routes 200, hydration confirmed in a browser, wallet button rendered,
  0 px horizontal overflow at 390 px, dark shell holding on a light-preference browser.
- Secret scan of the committed tree: no key material; `.env*` ignored except `.env.example`.

## Known caveat

The local build runs on Node 26.7.0; Vercel will run Node 24.x. `engines.node` pins it and the
dependencies are prebuilt for both, but the first Vercel build is the real proof — that is the one
step that cannot be verified from here.

## After the first deploy

1. Copy the assigned domain into `NEXT_PUBLIC_APP_URL` (Production **and** Preview) and redeploy once.
2. Open `/settings` on the live URL: it reads the deployment's own environment and will show exactly
   which integrations came through and which are still missing.
3. Open `/vault`: it reads the treasury over RPC, so a wrong RPC key shows up there immediately.
4. Only then set `TREASURY_LIVE=true` (with a funded treasury) and `NEXT_PUBLIC_ENABLE_SEND=true`,
   and run the real launch test.
