import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildCreateTransaction,
  simulateCreate,
  validateLaunchInput,
  type CreateLaunchInput,
} from "@/lib/pump/create";

/**
 * POST /api/launch/prepare
 * Phase 3 deliverable: build the create_v2 transaction and SIMULATE it.
 * This route never sends anything and never sees a private key.
 *
 * Body: { mint, name, symbol, uri, creator, user, mayhemMode? }
 * Returns the unsigned transaction (base64) + the simulation result, or the exact
 * validation issues. A stale blockhash is the caller's problem to notice: it is returned
 * with the transaction so the UI can rebuild instead of signing something expired.
 */

const Body = z.object({
  mint: z.string().trim().min(32).max(44),
  name: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  creator: z.string().trim().min(32).max(44),
  user: z.string().trim().min(32).max(44),
  mayhemMode: z.boolean().optional(),
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
      {
        error: "invalid_body",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const input: CreateLaunchInput = parsed.data;

  const issues = validateLaunchInput(input);
  if (issues.length > 0) {
    return NextResponse.json({ error: "invalid_launch_input", issues }, { status: 422 });
  }

  try {
    const built = await buildCreateTransaction(input);
    const simulation = await simulateCreate(built.transaction);
    return NextResponse.json({
      ok: true,
      mode: "prepare-only",
      note: "nothing was sent; the transaction is unsigned and must be signed by the caller",
      built,
      simulation,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "build_failed", detail: err instanceof Error ? err.message : "unknown error" },
      { status: 502 },
    );
  }
}
