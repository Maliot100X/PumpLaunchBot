import { NextResponse } from "next/server";
import { z } from "zod";
import { isConfigured, listLaunches, recordLaunch } from "@/lib/registry";
import { tokenLinks } from "@/lib/links";

/**
 * GET  /api/registry — every launch recorded through this platform, newest first.
 * POST /api/registry — record one launch.
 *
 * The write side is called by the client after a self launch has actually confirmed (only the user's
 * wallet can know that) and by the sponsored route after it sends. A launch that was only planned is
 * never recorded, so the board cannot claim a coin that does not exist.
 */

const Record = z.object({
  mint: z.string().trim().min(32).max(44),
  name: z.string().trim().min(1).max(64),
  symbol: z.string().trim().min(1).max(16),
  metadataUri: z.string().trim().min(1),
  imageUri: z.string().trim().url().nullish(),
  mode: z.enum(["self", "sponsored"]),
  payer: z.string().trim().min(32).max(44),
  creator: z.string().trim().min(32).max(44),
  feeWallet: z.string().trim().min(32).max(44).nullish(),
  userBps: z.number().int().min(0).max(10_000),
  platformBps: z.number().int().min(0).max(10_000),
  signatures: z.array(z.string().trim().min(1)).max(5).default([]),
  sourceMint: z.string().trim().min(32).max(44).nullish(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
  const result = await listLaunches(limit);
  return NextResponse.json({
    ok: result.error === null || !result.configured,
    configured: result.configured,
    total: result.total,
    count: result.launches.length,
    error: result.error,
    launches: result.launches.map((l) => ({ ...l, links: tokenLinks(l.mint) })),
  });
}

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, error: "registry_unconfigured", detail: "UPSTASH_REDIS_REST_URL / TOKEN are not set" },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = Record.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_body",
        detail: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const entry = {
    ...parsed.data,
    imageUri: parsed.data.imageUri ?? null,
    feeWallet: parsed.data.feeWallet ?? null,
    sourceMint: parsed.data.sourceMint ?? null,
    createdAt: Date.now(),
  };

  try {
    await recordLaunch(entry);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "registry_write_failed",
        detail: err instanceof Error ? err.message : "unknown error",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, recorded: entry.mint, links: tokenLinks(entry.mint) });
}
