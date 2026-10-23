import { NextResponse } from "next/server";
import { z } from "zod";
import { askAgent } from "@/lib/agent/brain";

/**
 * POST /api/agent/chat
 * Phase 6. The project bot: tool-calling loop over the same server functions the dashboard uses.
 * Returns the answer plus the tool steps it took, so the UI (and the owner) can see exactly what
 * the bot looked at. It can read the vault, explain fee logic, look tokens up, pin metadata and
 * PREPARE a sponsored launch — sending still needs the environment gate and live:true.
 */

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
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
    const result = await askAgent(parsed.data.message, parsed.data.history ?? []);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: "agent_failed", detail: err instanceof Error ? err.message : "unknown error" },
      { status: 502 },
    );
  }
}
