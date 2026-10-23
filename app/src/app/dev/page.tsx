"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, SectionTitle } from "@/components/ui";

/**
 * Dev tab — the CLI and Core API reference for THIS project.
 *
 * Written against the real surface, not against a copied marketing page: every command below is a
 * script in package.json or a file in src/app/api, and every field in a request/response body is the
 * zod schema the route actually validates with. If a route is deleted, this page is wrong on purpose
 * and the build's tests will not save it — so treat a mismatch as a bug in /dev.
 *
 * Two honest markers are used throughout:
 *   SELF-SIGNED  the caller's wallet signs and pays; the server never sees a private key
 *   SPONSORED    the treasury pays and signs; double-gated behind TREASURY_LIVE=true AND live:true
 */

type Endpoint = {
  method: "GET" | "POST";
  path: string;
  what: string;
  request?: string;
  response: string;
  curl: string;
  gate?: "self" | "sponsored" | "none";
};

const ENDPOINTS: Endpoint[] = [
  {
    method: "POST",
    path: "/api/pin",
    what:
      "Pins the token image (fetched from a URL) and then the metadata JSON to IPFS via Pinata, and returns the uri that goes into create_v2. Mandatory: pump.fun no longer accepts direct metadata uploads. Touches no wallet and no chain.",
    request: `{
  name: string (1..32), symbol: string (1..13),
  description?: string (<=2000), imageUrl: string (url),
  twitter? telegram? website? discord?: url
}`,
    response: `{ ok: true, imageUri, metadataUri, uri }`,
    curl: `curl -sX POST $APP/api/pin -H 'content-type: application/json' \\
  -d '{"name":"Moon","symbol":"MOON","imageUrl":"https://example.com/moon.png"}'`,
    gate: "none",
  },
  {
    method: "POST",
    path: "/api/launch/prepare",
    what:
      "Builds the create_v2 transaction and SIMULATES it. Never sends, never sees a private key. The blockhash is returned with the transaction so a stale one is visible instead of signed blindly.",
    request: `{
  mint, name, symbol, uri, creator, user: base58 (32..44),
  mayhemMode?: boolean
}`,
    response: `{ ok, transaction (base64), blockhash, simulation }  |  400 { error, detail[] }`,
    curl: `curl -sX POST $APP/api/launch/prepare -H 'content-type: application/json' \\
  -d '{"mint":"<mint>","name":"Moon","symbol":"MOON","uri":"<uri>","creator":"<wallet>","user":"<wallet>"}'`,
    gate: "self",
  },
  {
    method: "POST",
    path: "/api/launch/sponsored",
    what:
      "The treasury pays and signs; the caller only names the wallet that receives its share. Double-gated: TREASURY_LIVE=true in the environment AND live:true in the body. Without both it returns a fully simulated plan and sends nothing.",
    request: `{
  name (1..32), symbol (1..13), uri (1..200),
  feeReceiver?: base58, mint?: base58, live?: boolean
}`,
    response: `{ ok, mode: "sponsored", sent, signatures[], plan }  |  { ok, mode: "dry-run", plan }`,
    curl: `curl -sX POST $APP/api/launch/sponsored -H 'content-type: application/json' \\
  -d '{"name":"Moon","symbol":"MOON","uri":"<uri>","feeReceiver":"<wallet>","live":false}'`,
    gate: "sponsored",
  },
  {
    method: "POST",
    path: "/api/shield/launch",
    what:
      "The Shield tab's whole launch: optional sourceMint, the split, the mode, and the three signed transactions. mode self = the user's wallet signs; mode sponsored = the treasury signs. Records the launch in the registry only after confirmation.",
    request: `{
  name, symbol, description?, imageUri: url,
  mode: "self" | "sponsored",
  sourceMint?, user?, feeWallet?, mint?: base58,
  socials?: { twitter?, telegram?, website?: url }
}`,
    response: `{ ok: true, mint, mode, signatures[], feeShare }  |  422 { ok:false, error:"invalid_launch_input", issues[] }`,
    curl: `curl -sX POST $APP/api/shield/launch -H 'content-type: application/json' \\
  -d '{"name":"Moon","symbol":"MOON","imageUri":"<uri>","mode":"self","user":"<wallet>"}'`,
    gate: "self",
  },
  {
    method: "POST",
    path: "/api/recreate",
    what:
      "The brain behind the Shield tab. Reads a real token, proposes an optimised relaunch, renders artwork with Pollinations (flux.1-schnell, server-side so the key never reaches the browser), pins that artwork to IPFS and states the fee split. Deliberately does not pin metadata, sign or send.",
    request: `{ mint: base58 (32..44), withImage?: boolean }   // withImage:false = plan only, no image spend`,
    response: `{ ok: true, plan, imageUri?, split }`,
    curl: `curl -sX POST $APP/api/recreate -H 'content-type: application/json' \\
  -d '{"mint":"<existing mint>","withImage":false}'`,
    gate: "none",
  },
  {
    method: "GET",
    path: "/api/registry",
    what:
      "Every launch recorded through this platform, newest first. The write side is called only after a launch has actually confirmed, so the board can never list a coin that was merely planned.",
    request: `?limit=1..200  (default 100)`,
    response: `{ ok, configured, total, count, launches[], links }`,
    curl: `curl -s "$APP/api/registry?limit=10"`,
    gate: "none",
  },
  {
    method: "POST",
    path: "/api/registry",
    what: "Records one launch. Called by the client after a self launch confirms, and by the sponsored route after it sends.",
    request: `{
  mint, name, symbol, metadataUri,
  mode: "self" | "sponsored",
  payer, creator, feeWallet?, sourceMint?: base58,
  userBps: int 0..10000, platformBps: int 0..10000,
  imageUri?: url, signatures: string[] (<=5)
}`,
    response: `{ ok: true, total }`,
    curl: `curl -sX POST $APP/api/registry -H 'content-type: application/json' \\
  -d '{"mint":"<mint>","name":"Moon","symbol":"MOON","metadataUri":"<uri>","mode":"self","payer":"<w>","creator":"<w>","userBps":7000,"platformBps":3000}'`,
    gate: "none",
  },
  {
    method: "GET",
    path: "/api/token/[mint]",
    what: "Full snapshot of one token: on-chain state, market data and links. Powers the Explore lookup and the per-token previews.",
    request: `path param: mint`,
    response: `{ ok: true, token: { mint, name, symbol, supply, holders, market, links } }`,
    curl: `curl -s "$APP/api/token/<mint>"`,
    gate: "none",
  },
  {
    method: "GET",
    path: "/api/treasury",
    what: "Treasury address, balance and live flag — read-only. The keypair is never returned, only the public address and its balance.",
    response: `{ ok, address, balanceSol, live }`,
    curl: `curl -s "$APP/api/treasury"`,
    gate: "none",
  },
  {
    method: "POST",
    path: "/api/agent/chat",
    what: "The platform agent. Takes the conversation so far and answers with the project's own brain: launch flows, fee sharing, treasury controls.",
    request: `{ message (1..2000), history?: { role: "user"|"assistant", content (<=4000) }[] }`,
    response: `{ ok: true, reply, tools? }`,
    curl: `curl -sX POST $APP/api/agent/chat -H 'content-type: application/json' \\
  -d '{"message":"what is the default fee split?"}'`,
    gate: "none",
  },
  {
    method: "GET",
    path: "/api/agent/knowledge",
    what: "The knowledge the agent was built from: launch flows, fee-sharing rules, treasury controls. This is what makes /agents answer about THIS project instead of in generalities.",
    response: `{ ok, entries, knowledge }`,
    curl: `curl -s "$APP/api/agent/knowledge"`,
    gate: "none",
  },
];

const CLIS: { cmd: string; what: string }[] = [
  { cmd: "npm run dev", what: "Next dev server on http://localhost:3000" },
  { cmd: "npm run build", what: "production build — the same command Vercel runs" },
  { cmd: "npm start", what: "serve the production build (PORT=<n> to move it)" },
  { cmd: "npm run lint", what: "eslint, must be exit 0 before any commit" },
  { cmd: "npm test", what: "node --test over tests/*.test.ts" },
  { cmd: "npm run grind", what: "the vanity mint grinder, same engine as the Grinder tab" },
];

const GRIND: { cmd: string; what: string }[] = [
  { cmd: "npm run grind -- --start moon --end pump", what: "mint starting with 'moon' and ending with 'pump'" },
  { cmd: "npm run grind -- --end pump --ignore-case --count 3 --out ./keys", what: "three keypairs, case-insensitive, written as standard 64-byte keypair JSON (solana-keygen / Phantom importable)" },
  { cmd: "npm run grind -- --start A --json", what: "machine-readable, includes the secret key" },
  { cmd: "npm run grind -- --start moon --end pump --max 20000000 --json", what: "raise the per-keypair attempt ceiling" },
];

const ENV_GROUPS: { name: string; vars: string; note: string }[] = [
  { name: "Solana RPC", vars: "SOLANA_RPC_URL · NEXT_PUBLIC_SOLANA_RPC_URL · NEXT_PUBLIC_SOLANA_CLUSTER", note: "the private RPC is server-only: shipping an API key to the browser is how keys leak" },
  { name: "IPFS / Pinata", vars: "PINATA_JWT · PINATA_API_KEY · PINATA_API_SECRET · PINATA_GATEWAY", note: "metadata and artwork pinning" },
  { name: "Treasury", vars: "TREASURY_KEYPAIR_ENCRYPTED · TREASURY_KEYPAIR_PASSPHRASE · PLATFORM_TREASURY_PUBKEY · NEXT_PUBLIC_PLATFORM_TREASURY_PUBKEY · TREASURY_LIVE", note: "the keypair is stored encrypted and never returned by any route" },
  { name: "Fee split", vars: "FEE_SHARE_USER_BPS · FEE_SHARE_PLATFORM_BPS", note: "defaults 7000 / 3000 (70% / 30%)" },
  { name: "Registry", vars: "UPSTASH_REDIS_REST_URL · UPSTASH_REDIS_REST_TOKEN", note: "the board's store; pipelining goes to /pipeline, not the base URL" },
  { name: "Market data", vars: "SOLANATRACKER_API_KEY · SOLSCAN_API_KEY", note: "live lifecycle feed and token lookups" },
  { name: "Agent", vars: "AI_BASE_URL · AI_API_KEY · AI_MODEL", note: "the platform agent's model — River, OpenAI-compatible" },
  { name: "Images", vars: "POLLINATIONS_API_KEY · POLLINATIONS_IMAGE_MODEL · POLLINATIONS_EDIT_MODEL", note: "generated server-side; the key never reaches the browser" },
  { name: "App", vars: "NEXT_PUBLIC_APP_URL · NEXT_PUBLIC_ENABLE_SEND", note: "NEXT_PUBLIC_APP_URL must be inlined at build time; NEXT_PUBLIC_ENABLE_SEND is the client-side send switch" },
];

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
      className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-white/30 hover:text-white"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function Block({ code, label }: { code: string; label: string }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-white/30">{label}</span>
        <Copy text={code} />
      </div>
      <pre className="mt-1 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-3 text-[12px] leading-relaxed text-white/80">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Gate({ gate }: { gate?: Endpoint["gate"] }) {
  if (gate === "self") return <Badge tone="neutral">self-signed</Badge>;
  if (gate === "sponsored") return <Badge tone="warn">sponsored · double-gated</Badge>;
  return <Badge tone="neutral">no wallet</Badge>;
}

export default function DevPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="CLI & Core API">
        The command surface this project actually has. Every command is a script in package.json and
        every endpoint below is a route in <code className="text-white/80">src/app/api</code>, with the
        fields its zod schema really validates. Nothing here is illustrative.
      </PageHeader>

      <div className="mt-8">
        <SectionTitle>How a launch is wired</SectionTitle>
        <Card>
          <ol className="space-y-2 text-sm text-white/70">
            <li>
              <span className="text-white">1 · pin</span> — artwork and metadata to IPFS. No wallet, no chain.
            </li>
            <li>
              <span className="text-white">2 · prepare</span> — build and simulate create_v2. Nothing is sent.
            </li>
            <li>
              <span className="text-white">3 · sign</span> — three transactions: create, fee-share config, then
              updateFeeSharesV2 with the split (7000/3000 by default, permanent once set, max 10 shareholders).
            </li>
            <li>
              <span className="text-white">4 · record</span> — only after confirmation. A planned coin is never
              listed on the board.
            </li>
          </ol>
        </Card>
      </div>

      <div className="mt-8">
        <SectionTitle>CLI</SectionTitle>
        <div className="space-y-2">
          {CLIS.map((c) => (
            <Card key={c.cmd}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <code className="text-[13px] text-white">{c.cmd}</code>
                  <p className="mt-1 text-sm text-white/60">{c.what}</p>
                </div>
                <Copy text={c.cmd} />
              </div>
            </Card>
          ))}
        </div>

        <SectionTitle aside={<Badge tone="neutral">same engine as the Grinder tab</Badge>}>
          Vanity mint grinder
        </SectionTitle>
        <div className="space-y-2">
          {GRIND.map((g) => (
            <Card key={g.cmd}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <code className="text-[13px] text-white">{g.cmd}</code>
                  <p className="mt-1 text-sm text-white/60">{g.what}</p>
                </div>
                <Copy text={g.cmd} />
              </div>
            </Card>
          ))}
        </div>
        <Card className="mt-2">
          <p className="text-sm text-white/60">
            base58 has no <code>0</code>, <code>O</code>, <code>I</code> or <code>l</code>. A pattern
            longer than six characters is refused rather than run: 58<sup>7</sup> ≈ 2.2e12 combinations is
            not a foreground job. Without <code>--json</code> the secret key is never printed.
          </p>
        </Card>
      </div>

      <div className="mt-10">
        <SectionTitle>Core API</SectionTitle>
        <div className="space-y-3">
          {ENDPOINTS.map((e) => (
            <Card key={`${e.method} ${e.path}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={e.method === "GET" ? "neutral" : "ok"}>{e.method}</Badge>
                <code className="text-[13px] text-white">{e.path}</code>
                <span className="ml-auto">
                  <Gate gate={e.gate} />
                </span>
              </div>
              <p className="mt-2 text-sm text-white/70">{e.what}</p>
              {e.request ? <Block label="request" code={e.request} /> : null}
              <Block label="response" code={e.response} />
              <Block label="try it" code={e.curl} />
            </Card>
          ))}
        </div>
        <Card className="mt-3">
          <p className="text-sm text-white/60">
            <code>$APP</code> is your deployment origin —{" "}
            <code>https://pumplaunchbot.vercel.app</code> in production. Routes marked{" "}
            <span className="text-white/80">self-signed</span> return an unsigned transaction for a wallet to
            sign; <span className="text-white/80">sponsored</span> routes are refused unless{" "}
            <code>TREASURY_LIVE=true</code> and the body says <code>live:true</code>.
          </p>
        </Card>
      </div>

      <div className="mt-10">
        <SectionTitle>Environment</SectionTitle>
        <div className="space-y-2">
          {ENV_GROUPS.map((g) => (
            <Card key={g.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-white">{g.name}</span>
              </div>
              <p className="mt-1 font-mono text-[12px] break-words text-white/50">{g.vars}</p>
              <p className="mt-1 text-sm text-white/60">{g.note}</p>
            </Card>
          ))}
        </div>
        <Card className="mt-2">
          <p className="text-sm text-white/60">
            <code>.env.example</code> in the repo is the full list. Secrets stay in environment variables or
            encrypted storage; nothing in this project writes a key to a page, a log line or a client bundle.
          </p>
        </Card>
      </div>
    </div>
  );
}
