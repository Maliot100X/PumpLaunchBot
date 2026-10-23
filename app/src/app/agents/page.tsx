import { AgentChat } from "./agent-chat";
import { Card, PageHeader } from "@/components/ui";

/**
 * Agents / Bot tab — Phase 7. The chat surface runs on /api/agent/chat, which calls the SAME
 * server functions the dashboard uses, so the bot cannot do anything the UI cannot.
 */
export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Agents">
        The platform brain. It reads the vault, explains fee logic, looks tokens up, pins metadata and
        prepares sponsored launches — through the same server code the dashboard uses, so nothing can
        drift, and every answer carries its tool trail.
      </PageHeader>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Vault + launch", "Read the treasury, then prepare a sponsored launch — sending stays gated."],
          ["Fee logic", "Explain who receives what, in bps, and what is permanent about it."],
          ["Knowledge", "Answers come from the bundled project knowledge, not from guesses."],
        ].map(([t, b]) => (
          <Card key={t} className="p-4">
            <div className="text-sm font-medium">{t}</div>
            <p className="mt-1 text-xs leading-relaxed text-white/55">{b}</p>
          </Card>
        ))}
      </div>

      <AgentChat />
    </div>
  );
}
