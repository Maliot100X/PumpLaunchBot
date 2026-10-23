/**
 * Phase 6 — the bot brain.
 *
 * A real tool-calling loop against an OpenAI-compatible endpoint. Verified before writing this
 * file: River (https://api.river.ai/v1, model deepseek-ai/DeepSeek-V4.1-Flash) returns
 * finish_reason "tool_calls" for a tools[] request, so the model can genuinely choose a tool,
 * read its result and answer from it.
 *
 * The bot's authority is exactly the dashboard's authority: it calls the same server functions
 * through src/lib/agent/tools.ts. It has no separate key, no separate signing path, and no way to
 * send a transaction that the UI could not send.
 */

import { PROJECT_KNOWLEDGE, opsSummary } from "./knowledge";
import { TOOL_DEFINITIONS, runTool, type ToolResult } from "./tools";

export type AgentStep = {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResult;
};

export type AgentReply = {
  reply: string;
  steps: AgentStep[];
  model: string;
  usage: { promptTokens: number | null; completionTokens: number | null } | null;
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const MAX_STEPS = 5;

export function aiConfig(): { baseUrl: string; apiKey: string | null; model: string } {
  const baseUrl = process.env.AI_BASE_URL?.trim() || "https://api.river.ai/v1";
  const apiKey =
    process.env.AI_API_KEY?.trim() || process.env.HERMES_CUSTOM_API_RIVER_AI_API_KEY?.trim() || null;
  const model = process.env.AI_MODEL?.trim() || "deepseek-ai/DeepSeek-V4.1-Flash";
  return { baseUrl, apiKey, model };
}

function systemPrompt(): string {
  return [
    "You are the PumpLaunchBot agent — the operations brain of this launch platform.",
    "Answer ONLY from the project knowledge below and from tool results. If a tool fails, say",
    "which tool failed and what it returned; never invent a number, a balance, a link or a signature.",
    "Keep answers short, concrete and blunt. Put real values (SOL, bps, addresses, URLs) in the answer.",
    "Never reveal or echo a private key, passphrase or API key value, and never promise to move funds.",
    "",
    "## Project knowledge",
    PROJECT_KNOWLEDGE,
    "",
    "## Environment right now",
    opsSummary(),
  ].join("\n");
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/**
 * Run one turn of the bot: model -> (optional tool calls) -> model -> answer.
 * Never throws for an upstream failure: the error text is returned as the reply so the UI shows
 * something true instead of a blank screen.
 */
export async function askAgent(question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<AgentReply> {
  const { baseUrl, apiKey, model } = aiConfig();
  const steps: AgentStep[] = [];

  if (!apiKey) {
    return {
      reply:
        "The bot has no model key configured (AI_API_KEY or HERMES_CUSTOM_API_RIVER_AI_API_KEY). " +
        "Everything else works; set the key and I can answer.",
      steps,
      model,
      usage: null,
    };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    { role: "user", content: question },
  ];

  let usage: AgentReply["usage"] = null;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.2,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        reply: `The model endpoint returned ${res.status}: ${text.slice(0, 200)}`,
        steps,
        model,
        usage,
      };
    }

    const body = (await res.json()) as ChatCompletion;
    if (body.error?.message) {
      return { reply: `Model error: ${body.error.message}`, steps, model, usage };
    }
    if (body.usage) {
      usage = {
        promptTokens: body.usage.prompt_tokens ?? null,
        completionTokens: body.usage.completion_tokens ?? null,
      };
    }

    const message = body.choices?.[0]?.message;
    if (!message) return { reply: "The model returned no message.", steps, model, usage };

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      return { reply: message.content?.trim() || "(no answer)", steps, model, usage };
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      const result = await runTool(call.function.name, args);
      steps.push({ tool: call.function.name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  return {
    reply:
      "I hit the tool-call limit for one question without reaching an answer. Ask me to do one thing at a time.",
    steps,
    model,
    usage,
  };
}
