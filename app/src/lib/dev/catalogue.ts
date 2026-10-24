/**
 * The /dev catalogue — one source of truth for what this platform actually exposes.
 *
 * Why a data file instead of hand-written page copy: a docs page that drifts from the code is worse
 * than no docs, because people trust it. Every entry below names the real route file, and
 * tests/catalogue.test.ts asserts that file exists and exports that HTTP method — so deleting or
 * renaming a route fails the test suite instead of silently leaving a lie on the page.
 *
 * Nothing here is aspirational: each path answers today, and each note says what it does NOT do.
 */

export type Endpoint = {
  method: "GET" | "POST";
  path: string;
  /** Path relative to app/, checked by the test suite. */
  routeFile: string;
  purpose: string;
  /** A real request body, or null for GETs. */
  body?: Record<string, unknown> | null;
  returns: string;
  notes: string[];
};

export const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/token/{mint}",
    routeFile: "src/app/api/token/[mint]/route.ts",
    purpose: "Full snapshot of any Solana mint: on-chain metadata from Helius DAS merged with live market data from DexScreener.",
    returns: "{ ok, token: { mint, name, symbol, description, imageUrl, priceUsd, marketCap, liquidityUsd, dexId, socials, websites, metadataUri } }",
    notes: [
      "pump.fun's own frontend API answers 403 behind Cloudflare to server-side calls, so DAS is the metadata source.",
      "Every field is whatever upstream returned — a missing price is null, never 0.",
    ],
  },
  {
    method: "POST",
    path: "/api/recreate",
    routeFile: "src/app/api/recreate/route.ts",
    purpose: "The recreate brain: read a token, propose a stronger identity, render its artwork with Pollinations and pin that artwork to IPFS.",
    body: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", withImage: true },
    returns: "{ ok, plan: { name, symbol, description, imagePrompt, rationale }, image: { url, cid, model }, feeSplit, model, fallback, warnings }",
    notes: [
      "The image model is black-forest-labs/flux.1-schnell and nothing else.",
      "Name is clamped to 32 BYTES, ticker to 13 — pump.fun counts bytes, and an emoji is four of them.",
      "If the model is unreachable the plan is derived from the token's own metadata and `fallback: true` is set.",
      "It pins the artwork only. Metadata is pinned by the launch route, and nothing is signed or sent here.",
    ],
  },
  {
    method: "POST",
    path: "/api/shield/launch",
    routeFile: "src/app/api/shield/launch/route.ts",
    purpose: "Turn a recreate plan into a launch: pin metadata, resolve the fee split, build and simulate every transaction.",
    body: {
      name: "Moustache Reloaded",
      symbol: "MOUST",
      description: "…",
      imageUri: "https://gateway.pinata.cloud/ipfs/<cid>",
      mode: "sponsored",
      feeWallet: "<your wallet>",
    },
    returns: "{ ok, launch, feeSharing: { shares, createConfig, updateShares, userBps, platformBps }, create: { transaction, simulation }, links, warnings }",
    notes: [
      "mode \"self\" needs the connected wallet as `user`: it pays, signs and takes the fees.",
      "mode \"sponsored\" is paid and signed by the treasury; you only name your fee wallet.",
      "Three transactions, never one: create_v2 + create_fee_sharing_config + update_fee_shares_v2 packed together is ~1,280 bytes and pump's ceiling is 1,232.",
      "Sending is never automatic here. Sponsored sending is double-gated on TREASURY_LIVE=true and live:true.",
    ],
  },
  {
    method: "POST",
    path: "/api/launch/prepare",
    routeFile: "src/app/api/launch/prepare/route.ts",
    purpose: "The lower-level create path: build a create_v2 transaction for a given mint and simulate it, with no metadata or split handling.",
    body: { mint: "<mint>", name: "…", symbol: "…", uri: "https://…", creator: "<wallet>", user: "<wallet>" },
    returns: "{ ok, mode: \"prepare-only\", built, simulation }",
    notes: [
      "Never sends and never sees a private key.",
      "A stale blockhash is returned with the transaction so the caller can rebuild instead of signing something expired.",
    ],
  },
  {
    method: "POST",
    path: "/api/launch/sponsored",
    routeFile: "src/app/api/launch/sponsored/route.ts",
    purpose: "Platform-sponsored launch: the treasury is the creator and payer, and the caller supplies only the fee wallet.",
    body: { name: "…", symbol: "…", uri: "https://…", feeReceiver: "<wallet>", live: false },
    returns: "{ ok, mode: \"sponsored\", live, sent, treasury, mint, create, feeSharing, links, warnings }",
    notes: [
      "Sends only when TREASURY_LIVE=true AND live:true; otherwise it returns a fully simulated plan.",
      "Omit feeReceiver and the treasury keeps 10000 bps, because the program rejects an empty shareholder list.",
    ],
  },
  {
    method: "POST",
    path: "/api/pin",
    routeFile: "src/app/api/pin/route.ts",
    purpose: "Pin a token image (fetched from a URL) and its metadata JSON to IPFS via Pinata, returning the URI create_v2 needs.",
    body: { name: "…", symbol: "…", description: "…", imageUrl: "https://…" },
    returns: "{ ok, image: { cid, uri }, metadata: { cid, uri, ipfsUri } }",
    notes: ["pump.fun no longer accepts direct metadata uploads, so this step is mandatory before a launch.", "Gateway URLs default to gateway.pinata.cloud — the plain ipfs.io gateway serves a browser-only SW notice."],
  },
  {
    method: "GET",
    path: "/api/registry",
    routeFile: "src/app/api/registry/route.ts",
    purpose: "Every launch recorded through this platform, newest first, each with its links.",
    returns: "{ ok, configured, total, count, error, launches[] }",
    notes: ["Backed by Upstash Redis (plb:launch:<mint> hash + plb:launches zset).", "When the store is unconfigured it says so rather than returning an empty board."],
  },
  {
    method: "POST",
    path: "/api/registry",
    routeFile: "src/app/api/registry/route.ts",
    purpose: "Record a launch. Called after the transactions confirm, never for a plan.",
    body: { mint: "<mint>", name: "…", symbol: "…", metadataUri: "https://…", mode: "self", payer: "<wallet>", creator: "<wallet>", userBps: 7000, platformBps: 3000, signatures: [], sourceMint: null },
    returns: "{ ok, recorded: <mint>, links }",
    notes: ["Re-recording the same mint keeps its original createdAt, so the board does not reorder on updates."],
  },
  {
    method: "GET",
    path: "/api/treasury",
    routeFile: "src/app/api/treasury/route.ts",
    purpose: "Treasury status: the address, its live balance, what one sponsored launch costs and how many are affordable.",
    returns: "{ configured, address, decryptable, balanceSol, balanceLamports, rentPerLaunchLamports, launchesAffordable }",
    notes: ["Never returns key material — only the public address and derived numbers."],
  },
  {
    method: "POST",
    path: "/api/agent/chat",
    routeFile: "src/app/api/agent/chat/route.ts",
    purpose: "The platform bot. A tool-calling loop against the same server functions the dashboard uses.",
    body: { message: "How much SOL is in the vault?", history: [] },
    returns: "{ ok, reply, steps: [{ tool, args, result }], model, usage }",
    notes: [
      "Every answer carries its tool trail, so an answer can be audited instead of trusted.",
      "The bot shares the dashboard's authority — it cannot sign or send anything the UI cannot.",
    ],
  },
  {
    method: "GET",
    path: "/api/agent/knowledge",
    routeFile: "src/app/api/agent/knowledge/route.ts",
    purpose: "The project knowledge the bot is grounded in, as data.",
    returns: "{ ok, knowledge }",
    notes: ["Useful for checking what the bot believes about fees, treasury gating and the launch order."],
  },
];

export type CliCommand = {
  command: string;
  what: string;
  /** A real run, so the page shows measured numbers rather than a hopeful sample. */
  measured: string;
};

export const CLI: CliCommand[] = [
  {
    command: "npm run grind -- --start A --end p --count 2 --json",
    what: "Grind two mints that start with A and end with p, printing the keypairs as JSON.",
    measured: "2 keys · 706 attempts · 349 ms · 2,023 keypairs/s",
  },
  {
    command: "npm run grind -- --end p --count 2 --out ./keys --quiet",
    what: "Write standard 64-byte Solana keypair JSON files (mode 600) into ./keys, and print no secrets.",
    measured: "2 files written, each 64 bytes, both mints ending in p",
  },
  {
    command: "npm run grind -- --start moon --end pump",
    what: "Both ends at once. Note the cost before you run it: 58^6 ≈ 3.8e10 keypairs, so this is a background job, not a foreground one.",
    measured: "the CLI prints the expected attempt count before it starts",
  },
  {
    command: "node scripts/grind.ts --help",
    what: "The full flag list.",
    measured: "start, end, ignore-case, count, out, max, json, quiet",
  },
];

export const SNIPPETS: { title: string; language: string; code: string; note: string }[] = [
  {
    title: "Grind a mint, then create the coin with it",
    language: "ts",
    note: "The same grindVanity the Grinder tab calls — the browser and the CLI share one implementation.",
    code: `import { grindVanity, keypairFromResult, encodeBase58 } from "@/lib/vanity/grind";

const result = await grindVanity({ prefix: "moon", suffix: "pump", maxAttempts: 20_000_000 });
if (!result) throw new Error("no match inside the attempt budget");

const mintKeypair = keypairFromResult(result);   // also re-checks pubkey == its own secret
console.log(result.publicKey, encodeBase58(result.secretKey));`,
  },
  {
    title: "Read a token, then plan its relaunch",
    language: "ts",
    note: "Two routes, in the order the Shield tab calls them.",
    code: `const token = await (await fetch(\`/api/token/\${mint}\`)).json();

const plan = await (await fetch("/api/recreate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mint: token.token.mint, withImage: true }),
})).json();
// plan.plan.name, plan.plan.symbol, plan.image.url (already pinned to IPFS)`,
  },
  {
    title: "Build the launch, then sign it yourself",
    language: "ts",
    note: "Self mode: your wallet is the payer, the creator and the fee recipient. Three separate transactions, in this order.",
    code: `const prep = await (await fetch("/api/shield/launch", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name, symbol, description,
    imageUri: plan.image.url,
    mode: "self",
    user: wallet.publicKey.toBase58(),
    feeWallet: wallet.publicKey.toBase58(),
  }),
})).json();

// 1 create_v2  → 2 create_fee_sharing_config  → 3 update_fee_shares_v2
// Packing them into one transaction is ~1,280 bytes against pump's 1,232-byte ceiling.`,
  },
];

export const FACTS: { label: string; value: string }[] = [
  { label: "pump.fun create program", value: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" },
  { label: "fee-sharing program", value: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ" },
  { label: "Transaction size ceiling", value: "1,232 bytes" },
  { label: "Default split", value: "7000 bps launcher / 3000 bps treasury" },
  { label: "Max shareholders", value: "10, and update_fee_shares_v2 runs once — it revokes the admin" },
  { label: "Image model", value: "black-forest-labs/flux.1-schnell" },
  { label: "Metadata store", value: "IPFS via Pinata, gateway.pinata.cloud" },
  { label: "Registry store", value: "Upstash Redis over its REST API" },
  { label: "Bot model", value: "River, OpenAI-compatible, real tool calling verified" },
];
