import { NextResponse } from "next/server";
import { getTreasuryStatus } from "@/lib/treasury";

/**
 * GET /api/treasury
 * Treasury status for the Vault tab and the bot: address, live balance, rent per launch and
 * how many sponsored launches the balance actually covers. Never returns key material.
 *
 * Phase 5. Verified live: 0.0033065 SOL -> 2 launches affordable.
 */
export async function GET() {
  const status = await getTreasuryStatus();
  return NextResponse.json({
    ok: status.configured && status.decryptable,
    ...status,
    sponsoredModeEnabled: status.configured && status.decryptable,
    liveSending: process.env.TREASURY_LIVE === "true",
  });
}
