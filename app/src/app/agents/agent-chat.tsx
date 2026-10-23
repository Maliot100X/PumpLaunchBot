"use client";

import { useCallback, useRef, useState } from "react";

type Step = { tool: string; args: Record<string, unknown>; result: { ok: boolean; data?: unknown; error?: string } };
type Turn = {
  question: string;
  reply: string;
  steps: Step[];
  usage?: { promptTokens: number | null; completionTokens: number | null } | null;
  model?: string;
};

const SUGGESTIONS = [
  "How much SOL does the treasury hold, and can it pay for a sponsored launch?",
  "Explain the creator fee split and what is permanent about it.",
  "What does a sponsored launch cost in rent, exactly?",
  "Show me the newest tokens in the lifecycle feed.",
];

/**
 * The Agents tab chat. Phase 7.
 * Every answer shows the tool calls behind it, because an agent answer nobody can audit is a
 * liability — the steps come straight from /api/agent/chat.
 */
export function AgentChat() {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      setBusy(true);
      setError(null);
      setMessage("");
      try {
        const history = turns.flatMap((t) => [
          { role: "user" as const, content: t.question },
          { role: "assistant" as const, content: t.reply },
        ]);
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: question, history }),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          reply?: string;
          steps?: Step[];
          usage?: Turn["usage"];
          model?: string;
          error?: string;
          detail?: string;
        };
        if (!res.ok) throw new Error(body.detail ?? body.error ?? `chat failed (${res.status})`);
        setTurns((t) => [
          ...t,
          { question, reply: body.reply ?? "(no answer)", steps: body.steps ?? [], usage: body.usage, model: body.model },
        ]);
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "unknown error");
      } finally {
        setBusy(false);
      }
    },
    [busy, turns],
  );

  return (
    <section className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Ask the bot</h2>
        <span className="font-mono text-[11px] text-white/35">
          {turns[0]?.model ?? "river"} · tool-calling loop
        </span>
      </div>

      <div className="mt-3 max-h-[26rem] space-y-4 overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <p className="text-xs text-white/45">
            The bot has the project knowledge and live tools. It can read the vault, explain fee logic,
            look tokens up and prepare a sponsored launch (it cannot send one — that is gated).
          </p>
        ) : null}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-2">
            <p className="text-sm text-white/80">
              <span className="text-white/40">you · </span>
              {turn.question}
            </p>
            <div className="rounded-md border border-white/10 bg-black/30 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{turn.reply}</p>
              {turn.steps.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-white/40">
                    {turn.steps.length} tool call{turn.steps.length > 1 ? "s" : ""} · audit trail
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {turn.steps.map((s, j) => (
                      <li key={j} className="font-mono text-[11px] text-white/50">
                        <span className={s.result.ok ? "text-emerald-300/80" : "text-red-300/80"}>
                          {s.result.ok ? "ok" : "fail"}
                        </span>{" "}
                        {s.tool}({Object.keys(s.args).length ? JSON.stringify(s.args).slice(0, 80) : ""})
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
      ) : null}

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void send(message);
        }}
      >
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="ask the platform bot…"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-[#5e6ad2]"
        />
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="rounded-md bg-[#5e6ad2] px-4 py-2 text-sm font-medium hover:bg-[#4f59b8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#828fff] disabled:opacity-50"
        >
          {busy ? "thinking…" : "Send"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void send(s)}
            disabled={busy}
            className="rounded border border-white/10 px-2 py-1 text-[11px] text-white/55 hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
