import { NextResponse } from "next/server";
import { z } from "zod";
import { runSponsoredLaunch, sendSponsored } from "@/lib/pump/sponsored";

/**
 * POST /api/launch/sponsored
 * Phase 5. The treasury pays and signs; the caller only names the wallet that receives their
 * share. Double-gated: TREASURY_LIVE=true in the environment AND live:true in the body.
 * Without both, this endpoint returns a fully simulated plan and sends nothing.
 */

const Body = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(13),
  uri: z.string().trim().min(1).max(200),
  /** Omitted => no split: the treasury keeps 100% of the creator fees. */
  feeReceiver: z.string().trim().min(32).max(44).optional(),
  mint: z.string().trim().min(32).max(44).optional(),
  live: z.boolean().optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  try {
    const plan = await runSponsoredLaunch(parsed.data);
    if (plan.live && plan.create.simulation.ok) {
      const sent = await sendSponsored(plan);
      return NextResponse.json({ ok: true, ...plan, sent, live: true });
    }
    return NextResponse.json({ ok: true, ...plan });
  } catch (err) {
    return NextResponse.json(
      { error: "sponsored_launch_failed", detail: err instanceof Error ? err.message : "unknown error" },
      { status: 502 },
    );
  }
}
