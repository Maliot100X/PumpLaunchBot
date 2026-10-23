import { NextResponse } from "next/server";
import { z } from "zod";
import { getFullTokenSnapshot } from "@/lib/tokens/snapshot";
import { buildRecreatePlan } from "@/lib/agent/recreate";
import { generateImage, imageModel, isConfigured as imagesConfigured } from "@/lib/media/pollinations";
import { pinFile } from "@/lib/pinata";
import { resolveSplit } from "@/lib/pump/fee-sharing";
import { treasuryAddress } from "@/lib/treasury";

/**
 * POST /api/recreate — the brain behind the Shield tab.
 *
 * Read a real token, propose an optimised relaunch, render its artwork with Pollinations
 * (flux.1-schnell, server-side so the key never reaches the browser), pin that artwork to IPFS so the
 * URL is durable, and state the fee split the launch will use.
 *
 * It deliberately does NOT pin metadata, sign, or send anything: the user edits the plan first, and
 * the launch path owns everything after that. Nothing here can create a coin by itself.
 */
const bodySchema = z.object({
  mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "not a valid Solana mint address"),
  /** When false, only the plan is produced (no image spend). Defaults to true. */
  withImage: z.boolean().optional(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsedBody.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { mint, withImage = true } = parsedBody.data;
  const warnings: string[] = [];

  let snapshot;
  try {
    snapshot = await getFullTokenSnapshot(mint);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "token_not_found", detail: err instanceof Error ? err.message : "unknown" },
      { status: 404 },
    );
  }

  const outcome = await buildRecreatePlan(snapshot);
  if (outcome.fallback) {
    warnings.push(
      "the model could not be used for this request, so the plan was derived from the token's own metadata instead of rewritten",
    );
  }

  // Artwork: generated server-side (key stays here), then pinned so the URL is durable for the launch.
  let imageUrl: string | null = null;
  let imageCid: string | null = null;
  if (withImage) {
    if (!imagesConfigured()) {
      warnings.push("POLLINATIONS_API_KEY is not configured, so no artwork was generated");
    } else {
      try {
        const image = await generateImage(outcome.plan.imagePrompt, { width: 1024, height: 1024 });
        const pinned = await pinFile(image.bytes, "token-image.jpg", image.contentType);
        imageUrl = pinned.uri; // gateway URL — what the metadata `image` field takes
        imageCid = pinned.cid;
      } catch (err) {
        warnings.push(`artwork generation failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }

  // The split the launch will write on chain. Derived from the same code the fee-sharing builder uses.
  let feeSplit: { userBps: number; platformBps: number; mode: string } | null = null;
  const treasury = treasuryAddress()?.toBase58() ?? null;
  try {
    if (!treasury) throw new Error("PLATFORM_TREASURY_PUBKEY is not configured");
    const resolved = resolveSplit({ feeReceiver: null, platformTreasury: treasury });
    feeSplit = {
      userBps: resolved.shares.find((s) => s.address !== treasury)?.bps ?? 0,
      platformBps: resolved.shares.find((s) => s.address === treasury)?.bps ?? 10_000,
      mode: resolved.mode,
    };
  } catch (err) {
    warnings.push(`fee split unavailable: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return NextResponse.json({
    ok: true,
    source: { mint: snapshot.mint, name: snapshot.name, symbol: snapshot.symbol },
    plan: outcome.plan,
    image: { url: imageUrl, cid: imageCid, model: imageModel() },
    feeSplit,
    treasury,
    model: outcome.model,
    fallback: outcome.fallback,
    warnings,
  });
}
