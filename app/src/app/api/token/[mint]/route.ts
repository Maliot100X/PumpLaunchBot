import { NextResponse } from "next/server";
import { z } from "zod";
import { getFullTokenSnapshot } from "@/lib/tokens/snapshot";

/**
 * GET /api/token/{mint}
 * Phase 1 + Phase 2 deliverable: the data layer.
 *   Phase 1 — DexScreener market data (price, liquidity, image, socials).
 *   Phase 2 — on-chain metadata merged in (Helius DAS): real name/symbol/description,
 *             plus the off-chain json_uri links (twitter/telegram/website/discord).
 *
 * Verified with a live mint in both phases (see RESEARCH.md).
 */

const MintParam = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "not a base58 Solana address");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const parsed = MintParam.safeParse(mint);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_mint", detail: parsed.error.issues[0]?.message ?? "bad mint" },
      { status: 400 },
    );
  }

  try {
    const snapshot = await getFullTokenSnapshot(parsed.data);
    return NextResponse.json({ ok: true, token: snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    const notFound = /no data for mint|no pair found/.test(message);
    const config = /not configured/i.test(message);
    return NextResponse.json(
      {
        error: notFound ? "token_not_found" : config ? "server_misconfigured" : "upstream_error",
        detail: message,
      },
      { status: notFound ? 404 : config ? 500 : 502 },
    );
  }
}
