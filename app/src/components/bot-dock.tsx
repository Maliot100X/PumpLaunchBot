"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The floating bot dock — available on every page, not buried in a tab.
 *
 * It talks to /api/agent/chat, which is the SAME tool-calling brain the Agents tab uses, so the dock
 * can do exactly what the tab can do and nothing more. Each answer shows its tool trail, because an
 * agent answer nobody can audit is a liability.
 *
 * Behaviour:
 *  - closed by default; a floating button bottom-right opens it (bottom-right, above mobile safe area)
 *  - desktop: a 380px panel anchored bottom-right. Mobile: a full-width sheet.
 *  - Escape closes it; the trigger reports aria-expanded; the transcript is aria-live.
 *  - one-question-at-a-time prompts, because that is how the platform we cloned guides a launch.
 */

type Step = { tool: string; args: Record<string, unknown>; result: { ok: boolean } };
type Turn = { question: string; reply: string; steps: Step[] };

const QUICK = [
  "How much SOL does the treasury hold right now?",
  "Look up this mint and tell me what it is: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "Explain the 70/30 creator fee split and what is permanent about it.",
  "What does one sponsored launch cost in lamports?",
];

export function BotDock() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
          error?: string;
          detail?: string;
        };
        if (!res.ok) throw new Error(body.detail ?? body.error ?? `bot failed (${res.status})`);
        setTurns((t) => [...t, { question, reply: body.reply ?? "(no answer)", steps: body.steps ?? [] }]);
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
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="bot-dock"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-[#5e6ad2] px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-[#4f59b8] active:bg-[#4650a8]"
      >
        <span aria-hidden className="text-base leading-none">
          {open ? "▾" : "✦"}
        </span>
        <span className="hidden sm:inline">{open ? "Hide bot" : "Ask the bot"}</span>
        <span className="sr-only">{open ? "Hide the platform bot" : "Open the platform bot"}</span>
      </button>

      {open ? (
        <section
          id="bot-dock"
          aria-label="Platform bot"
          className="fixed inset-x-2 bottom-20 z-50 flex max-h-[75vh] flex-col rounded-lg border border-white/10 bg-[#0b0c0e] shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[380px]"
        >
          <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Platform bot</p>
              <p className="font-mono text-[10px] text-white/35">same brain as the Agents tab</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
            >
              close
            </button>
          </header>

          <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {turns.length === 0 ? (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-white/50">
                  Ask about the vault, a token, the fee logic, or tell it to prepare a launch. It reads the
                  same server code the dashboard uses, and it cannot send a transaction — that stays gated.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      disabled={busy}
                      className="rounded border border-white/10 px-2 py-1 text-left text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {turns.map((turn, i) => (
              <div key={i} className="space-y-1.5">
                <p className="text-xs text-white/75">
                  <span className="text-white/35">you · </span>
                  {turn.question}
                </p>
                <div className="rounded-md border border-white/10 bg-black/30 p-2.5">
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/85">{turn.reply}</p>
                  {turn.steps.length > 0 ? (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[10px] text-white/40">
                        {turn.steps.length} tool call{turn.steps.length > 1 ? "s" : ""} · audit trail
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {turn.steps.map((s, j) => (
                          <li key={j} className="font-mono text-[10px] text-white/45">
                            <span className={s.result.ok ? "text-emerald-300/80" : "text-red-300/80"}>
                              {s.result.ok ? "ok" : "fail"}
                            </span>{" "}
                            {s.tool}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </div>
            ))}

            {busy ? <p className="text-[11px] text-white/40">thinking…</p> : null}
            {error ? (
              <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">
                {error}
              </p>
            ) : null}
            <div ref={endRef} />
          </div>

          <form
            className="flex gap-2 border-t border-white/10 p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void send(message);
            }}
          >
            <label htmlFor="bot-dock-input" className="sr-only">
              Message for the platform bot
            </label>
            <input
              id="bot-dock-input"
              name="message"
              autoComplete="off"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="ask the bot…"
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs outline-none transition-colors placeholder:text-white/30 hover:border-white/20 focus:border-[#5e6ad2]"
            />
            <button
              type="submit"
              disabled={busy || !message.trim()}
              className="rounded-md bg-[#5e6ad2] px-3 py-2 text-xs font-medium transition-colors hover:bg-[#4f59b8] active:bg-[#4650a8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
