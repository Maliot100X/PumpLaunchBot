/**
 * Phase 1-6 audit suite (api-testing skill: contract tests with real HTTP, schema validation with
 * zod 4, happy path + error path for every endpoint, header assertions, and no mocks).
 *
 * Runs against a locally running dev server (default http://127.0.0.1:3300).
 *   node --test tests/api.test.ts
 *
 * Nothing here sends a transaction, pins nothing it cannot verify, and never calls a mutating
 * endpoint without asserting both the success and the refusal.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3300";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const TokenSnapshot = z.object({
  mint: z.string(),
  name: z.string(),
  symbol: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceUsd: z.number().nullable(),
  marketCap: z.number().nullable(),
  liquidityUsd: z.number().nullable(),
  socials: z.array(z.object({ url: z.string() })),
  websites: z.array(z.object({ url: z.string() })),
  sources: z.object({ dexscreener: z.string(), onchain: z.string() }),
  fetchedAt: z.string(),
});

const Treasury = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  address: z.string().nullable(),
  decryptable: z.boolean(),
  balanceLamports: z.number().nullable(),
  rentPerLaunchLamports: z.number(),
  launchesAffordable: z.number().nullable(),
  liveSending: z.boolean(),
});

const Knowledge = z.object({
  ok: z.boolean(),
  model: z.object({ endpoint: z.string(), name: z.string(), keyConfigured: z.boolean() }),
  tools: z.array(z.object({ name: z.string(), description: z.string() })).min(5),
});

async function get(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200, `dev server must answer on ${BASE}`);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
});

test("every dashboard route renders with an HTML content-type", async () => {
  for (const path of ["/", "/launch", "/explore", "/launched", "/agents", "/vault", "/settings"]) {
    const res = await fetch(`${BASE}${path}`);
    assert.equal(res.status, 200, `${path} status`);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/, `${path} content-type`);
    const html = await res.text();
    assert.match(html, /PumpLaunchBot/, `${path} must contain the app shell`);
  }
});

test("GET /api/token/{mint} returns a valid snapshot (happy path)", async () => {
  const res = await get(`/api/token/${BONK}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const parsed = TokenSnapshot.safeParse(((await res.json()) as { token?: unknown }).token);
  assert.ok(parsed.success, `schema mismatch: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
  assert.equal(parsed.data.symbol.toLowerCase(), "bonk");
  assert.ok((parsed.data.description ?? "").length > 0, "on-chain description must be present");
});

test("GET /api/token/{mint} rejects a malformed mint with 400", async () => {
  const res = await get("/api/token/not-a-mint");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "invalid_mint");
});

test("GET /api/token/{mint} returns 404 for an unknown-but-valid mint", async () => {
  const res = await get("/api/token/So11111111111111111111111111111111111111113");
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "token_not_found");
});

test("GET /api/treasury reports the measured rent model and never leaks a key", async () => {
  const res = await get("/api/treasury");
  assert.equal(res.status, 200);
  const body = await res.json();
  const parsed = Treasury.safeParse(body);
  assert.ok(parsed.success, `schema mismatch: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
  assert.equal(parsed.data.rentPerLaunchLamports, 3_342_480, "the measured cost per create");
  const raw = JSON.stringify(body);
  assert.ok(!/private|secret|passphrase|TREASURY_KEYPAIR/i.test(raw), "no key material in the response");
});

test("GET /api/agent/knowledge exposes the tools and the model, not the key", async () => {
  const res = await get("/api/agent/knowledge");
  assert.equal(res.status, 200);
  const body = await res.json();
  const parsed = Knowledge.safeParse(body);
  assert.ok(parsed.success, `schema mismatch: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
  const names = parsed.data.tools.map((t) => t.name);
  for (const required of ["get_vault_status", "get_fee_logic", "prepare_sponsored_launch"]) {
    assert.ok(names.includes(required), `tool ${required} missing`);
  }
});

test("POST /api/launch/prepare builds and simulates, and refuses bad metadata (422)", async () => {
  const mint = "3DassYSbsZaBg9MaK4yMTWdzRnKC9JzsaSnmUyKmEnST";
  const user = "YxbGArmaf1iFPmfqo7VtutW6QyMo957pkNeP7WiA6Db";
  const uri = "https://gateway.pinata.cloud/ipfs/bafkreign3fd4apuuihgmsgpzalscncaiy5f2pxaz6wqffma5omcw3ayzye";

  const okRes = await post("/api/launch/prepare", { mint, name: "Audit Coin", symbol: "AUDT", uri, creator: user, user });
  assert.equal(okRes.status, 200, "prepare must build for valid input");
  const ok = (await okRes.json()) as { built?: { instructions?: number }; simulation?: { unitsConsumed?: number } };
  assert.equal(ok.built?.instructions, 1);
  assert.ok((ok.simulation?.unitsConsumed ?? 0) > 0, "the transaction must have been simulated");

  const badRes = await post("/api/launch/prepare", { mint, name: "x".repeat(33), symbol: "AUDT", uri, creator: user, user });
  assert.equal(badRes.status, 422);
  const bad = (await badRes.json()) as { error?: string; issues?: { field: string }[] };
  assert.equal(bad.error, "invalid_launch_input");
  assert.ok(bad.issues?.some((i) => i.field === "name"));

  const malformed = await post("/api/launch/prepare", { mint, name: "", symbol: "", uri: "", creator: "x", user: "y" });
  assert.equal(malformed.status, 400);
});

test("POST /api/launch/sponsored returns a plan with links, shares and a simulation — and never sends", async () => {
  const res = await post("/api/launch/sponsored", {
    name: "Audit Sponsored",
    symbol: "AUDSPON",
    uri: "https://gateway.pinata.cloud/ipfs/bafkreign3fd4apuuihgmsgpzalscncaiy5f2pxaz6wqffma5omcw3ayzye",
  });
  assert.equal(res.status, 200);
  const plan = (await res.json()) as {
    live?: boolean;
    sent?: unknown;
    links?: { pumpFun?: string; dexScreener?: string; platformExplore?: string };
    feeSharing?: { shares?: { bps: number }[]; splitMode?: string };
    create?: { simulation?: { unitsConsumed?: number } };
  };
  assert.equal(plan.live, false, "sending is gated off in this build");
  assert.equal(plan.sent, false, "nothing may be sent by an audit");
  assert.equal(plan.feeSharing?.splitMode, "treasury-only", "no fee receiver => treasury keeps 100%");
  assert.deepEqual((plan.feeSharing?.shares ?? []).map((s) => s.bps), [10_000]);
  assert.match(plan.links?.pumpFun ?? "", /^https:\/\/pump\.fun\/coin\//);
  assert.match(plan.links?.dexScreener ?? "", /^https:\/\/dexscreener\.com\/solana\//);
  assert.match(plan.links?.platformExplore ?? "", /^\/explore\?mint=/);
});

test("POST /api/agent/chat answers a vault question from a real tool call", async () => {
  const res = await post("/api/agent/chat", {
    message: "In one short sentence: how many sponsored launches can the treasury pay for right now?",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok?: boolean;
    reply?: string;
    steps?: { tool: string; result?: { ok?: boolean } }[];
  };
  assert.equal(body.ok, true);
  assert.ok((body.reply ?? "").length > 10, "the bot must actually answer");
  assert.ok(
    (body.steps ?? []).some((s) => s.tool === "get_vault_status" && s.result?.ok === true),
    "the answer must come from a successful get_vault_status call",
  );
});

test("POST /api/agent/chat rejects an empty message with 400", async () => {
  const res = await post("/api/agent/chat", { message: "" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "invalid_body");
});
