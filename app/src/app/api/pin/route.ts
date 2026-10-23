import { NextResponse } from "next/server";
import { z } from "zod";
import { pinImageFromUrl, pinTokenMetadata } from "@/lib/pinata";

/**
 * POST /api/pin
 * Pins the token image (fetched from a URL) and the metadata JSON to IPFS via Pinata,
 * returning the `uri` that goes into create_v2.
 *
 * pump.fun no longer accepts direct metadata uploads, so this step is mandatory before a
 * launch can be prepared. Nothing here touches a wallet or the chain.
 */

const Body = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(13),
  description: z.string().trim().max(2000).default(""),
  imageUrl: z.string().trim().url(),
  twitter: z.string().trim().url().optional(),
  telegram: z.string().trim().url().optional(),
  website: z.string().trim().url().optional(),
  discord: z.string().trim().url().optional(),
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

  try {
    const image = await pinImageFromUrl(parsed.data.imageUrl);
    const metadata = await pinTokenMetadata({
      name: parsed.data.name,
      symbol: parsed.data.symbol,
      description: parsed.data.description,
      imageUri: image.uri,
      twitter: parsed.data.twitter,
      telegram: parsed.data.telegram,
      website: parsed.data.website,
      discord: parsed.data.discord,
    });
    return NextResponse.json({
      ok: true,
      image: { cid: image.cid, uri: image.uri },
      metadata: { cid: metadata.cid, uri: metadata.uri, ipfsUri: metadata.ipfsUri },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "pin_failed", detail: err instanceof Error ? err.message : "unknown error" },
      { status: 502 },
    );
  }
}
