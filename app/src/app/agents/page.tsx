import { AgentChat } from "./agent-chat";

/**
 * Agents / Bot tab — Phase 7. The chat surface runs on /api/agent/chat, which calls the SAME
 * server functions the dashboard uses, so the bot cannot do anything the UI cannot.
 */
export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
      <p className="mt-2 text-sm text-white/60">
        The platform brain. It reads the vault, explains fee logic, looks tokens up, pins metadata and
        prepares sponsored launches — through the same server code the dashboard uses, so nothing can
        drift, and every answer carries its tool trail.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Vault + launch", "Read the treasury, then prepare a sponsored launch — sending stays gated."],
          ["Fee logic", "Explain who receives what, in bps, and what is permanent about it."],
          ["Knowledge", "Answers come from the bundled project knowledge, not from guesses."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="text-sm font-medium">{t}</div>
            <p className="mt-1 text-xs leading-relaxed text-white/55">{b}</p>
          </div>
        ))}
      </div>

      <AgentChat />
    </div>
  );
}
