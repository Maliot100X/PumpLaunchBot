import { aiConfig } from "./brain.ts";
import { METADATA_LIMITS } from "@/lib/pump/create";
import type { FullTokenSnapshot } from "@/lib/tokens/snapshot";

/**
 * The recreate brain: read a real token, then propose an optimised version of it — name, ticker,
 * description and an image prompt — that a launch can actually accept.
 *
 * Design rules, all deliberate:
 *  - the model is asked for a strict JSON object and the reply is parsed defensively (River and any
 *    OpenAI-compatible endpoint sometimes wrap JSON in prose or a code fence).
 *  - every field is clamped to the REAL on-chain limits from METADATA_LIMITS, measured in BYTES not
 *    characters, because pump.fun counts bytes and an emoji is four of them. Without this the plan
 *    would be rejected at launch time instead of here.
 *  - if the model is unavailable or answers nonsense, a deterministic fallback is built from the
 *    original token so the user still gets something coherent — never a fabricated coin out of nowhere.
 */

export type RecreatePlan = {
  name: string;
  symbol: string;
  description: string;
  imagePrompt: string;
  rationale: string;
};

export type RecreateOutcome = {
  plan: RecreatePlan;
  model: string;
  /** true when the model could not be used and the plan was derived deterministically. */
  fallback: boolean;
};

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Cut a string to a byte budget without splitting a multi-byte character. */
function clampBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  let out = "";
  for (const ch of value) {
    if (byteLength(out + ch) > maxBytes) break;
    out += ch;
  }
  return out.trim();
}

function sanitizeSymbol(value: string): string {
  // Tickers are symbols, not sentences: strip anything that is not a letter, digit or $
  return clampBytes(value.replace(/[^A-Za-z0-9$]/g, "").replace(/^\$+/, ""), METADATA_LIMITS.symbol);
}

function sanitizePlan(raw: Partial<RecreatePlan>): RecreatePlan | null {
  const name = clampBytes((raw.name ?? "").trim(), METADATA_LIMITS.name);
  const symbol = sanitizeSymbol((raw.symbol ?? "").trim());
  const description = (raw.description ?? "").trim();
  const imagePrompt = (raw.imagePrompt ?? "").trim();
  if (name.length < 2 || symbol.length < 2 || description.length < 8) return null;
  return {
    name,
    symbol,
    description,
    imagePrompt:
      imagePrompt ||
      `a bold, high-contrast token logo for a Solana meme coin called ${name}, centered emblem, dark background, crypto poster art`,
    rationale: (raw.rationale ?? "").trim(),
  };
}

/** Deterministic plan derived from the source token — used when the model cannot be reached. */
export function fallbackPlan(snapshot: FullTokenSnapshot): RecreatePlan {
  const baseName = (snapshot.name || "New Coin").trim();
  const name = clampBytes(`${baseName} Reloaded`, METADATA_LIMITS.name);
  const symbol = sanitizeSymbol(snapshot.symbol || baseName || "COIN");
  const description =
    (snapshot.description ?? "").trim() ||
    `${baseName} relaunched on pump.fun through PumpLaunchBot, with the creator fee split set on chain before the first trade.`;
  return {
    name,
    symbol,
    description,
    imagePrompt: `a bold, high-contrast token logo for a Solana meme coin called ${name}, centered emblem, dark background, crypto poster art`,
    rationale: "model unavailable — plan derived directly from the source token's own metadata",
  };
}

function parseJsonLoose(text: string): Partial<RecreatePlan> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1), text];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c.trim()) as Partial<RecreatePlan>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function buildRecreatePlan(snapshot: FullTokenSnapshot): Promise<RecreateOutcome> {
  const { baseUrl, apiKey, model } = aiConfig();
  if (!apiKey) return { plan: fallbackPlan(snapshot), model: "none", fallback: true };

  const facts = [
    `name: ${snapshot.name}`,
    `ticker: ${snapshot.symbol}`,
    `description: ${snapshot.description ?? "(none on chain)"}`,
    `mint: ${snapshot.mint}`,
    `price usd: ${snapshot.priceUsd ?? "unknown"}`,
    `market cap usd: ${snapshot.marketCap ?? "unknown"}`,
    `liquidity usd: ${snapshot.liquidityUsd ?? "unknown"}`,
    `dex: ${snapshot.dexId ?? "unknown"}`,
    `links: ${[...snapshot.websites.map((w) => w.url), ...snapshot.socials.map((s) => s.url)].join(", ") || "(none)"}`,
  ].join("\n");

  const instruction = [
    "You are preparing a RELAUNCH of an existing Solana pump.fun token.",
    "Study the token below and produce a stronger version of it: a sharper name, a memorable ticker,",
    "a punchier description, and an image prompt for a token logo.",
    "",
    "Hard limits you MUST respect:",
    `- name: at most ${METADATA_LIMITS.name} BYTES (an emoji costs 4)`,
    `- ticker: at most ${METADATA_LIMITS.symbol} bytes, letters and digits only`,
    "- description: at most 600 characters, no emoji spam, do not promise returns or financial gains",
    "",
    "Answer with ONE JSON object and nothing else, exactly these keys:",
    '{"name":"...","symbol":"...","description":"...","imagePrompt":"...","rationale":"one sentence on what you changed and why"}',
    "",
    "TOKEN:",
    facts,
  ].join("\n");

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages: [
          { role: "system", content: "You output only valid JSON. No prose, no markdown." },
          { role: "user", content: instruction },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return { plan: fallbackPlan(snapshot), model, fallback: true };

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonLoose(text);
    const clean = parsed ? sanitizePlan(parsed) : null;
    if (!clean) return { plan: fallbackPlan(snapshot), model, fallback: true };
    return { plan: clean, model, fallback: false };
  } catch {
    return { plan: fallbackPlan(snapshot), model, fallback: true };
  }
}
