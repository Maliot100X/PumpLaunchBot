import { NextResponse } from "next/server";
import { PROJECT_KNOWLEDGE, opsSummary } from "@/lib/agent/knowledge";
import { aiConfig } from "@/lib/agent/brain";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";

/**
 * GET /api/agent/knowledge
 * Phase 6. What the in-repo bot knows and what it can do — the same text the model receives as its
 * system prompt, plus the live environment summary and the tool list. Useful for the Agents tab
 * and for judging the bot without reading its code.
 */
export async function GET() {
  const { baseUrl, model, apiKey } = aiConfig();
  return NextResponse.json({
    ok: true,
    model: { endpoint: baseUrl, name: model, keyConfigured: apiKey !== null },
    knowledge: PROJECT_KNOWLEDGE,
    environment: opsSummary(),
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.function.name,
      description: t.function.description,
    })),
  });
}
