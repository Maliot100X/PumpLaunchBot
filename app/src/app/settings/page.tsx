import { PageHeader, Panel, Alert, SectionTitle, Badge } from "@/components/ui";

/**
 * Settings tab — Phase 7/rework: reads the REAL environment instead of describing it.
 *
 * Presence, never values: this page answers "is this configured on the server I am talking to?"
 * for every switch that matters before a launch, and it says so plainly when something is missing.
 * Nothing here is secret — keys are reported as configured/not configured, never printed.
 */
function configured(...names: string[]): boolean {
  return names.every((n) => (process.env[n] ?? "").trim().length > 0);
}

function rpcHost(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (!url) return "not set — falling back to the public cluster (heavily rate limited)";
  try {
    return new URL(url).host;
  } catch {
    return "set, but not a parseable URL";
  }
}

export default function SettingsPage() {
  const sendGate = process.env.NEXT_PUBLIC_ENABLE_SEND === "true";
  const treasuryLive = process.env.TREASURY_LIVE === "true";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="Settings">
        Server-side configuration, read live from the environment of the running deployment. Nothing
        secret is editable from the browser, and no value is ever printed here — only whether it is
        present.
      </PageHeader>

      <div className="mt-6 space-y-3">
        <Alert tone={sendGate ? "warn" : "info"} title={sendGate ? "Sending is ENABLED" : "Sending is disabled"}>
          {sendGate
            ? "NEXT_PUBLIC_ENABLE_SEND=true — the user-signed launch path will submit transactions."
            : "NEXT_PUBLIC_ENABLE_SEND is not true: the launch path builds and simulates, and never submits."}{" "}
          Sponsored sending additionally requires TREASURY_LIVE=true and {'"live": true'} in the request
          (currently {treasuryLive ? "on" : "off"}).
        </Alert>
      </div>

      <section className="mt-8">
        <SectionTitle>Launch path</SectionTitle>
        <dl className="mt-3 divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
          {(
            [
              ["Default fee split", `${process.env.FEE_SHARE_USER_BPS ?? "7000"} bps creator / ${process.env.FEE_SHARE_PLATFORM_BPS ?? "3000"} bps platform · must sum to 10000, max 10 wallets`],
              ["Metadata pinning", configured("PINATA_JWT") ? `Pinata v3 uploads API · gateway ${process.env.PINATA_GATEWAY?.trim() || "gateway.pinata.cloud"}` : "PINATA_JWT is not set — pinning will fail"],
              ["Image generation", `Pollinations · ${process.env.POLLINATIONS_IMAGE_MODEL ?? "black-forest-labs/flux.1-schnell"}${configured("POLLINATIONS_API_KEY") ? "" : " (no POLLINATIONS_API_KEY)"}`],
              ["Solana RPC", rpcHost()],
              ["Treasury", configured("PLATFORM_TREASURY_PUBKEY", "TREASURY_KEYPAIR_ENCRYPTED", "TREASURY_KEYPAIR_PASSPHRASE") ? "encrypted keypair present — sponsored mode available" : "not configured — sponsored mode unavailable"],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <dt className="shrink-0 text-sm">{k}</dt>
              <dd className="font-mono text-xs leading-relaxed text-white/55 sm:text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8">
        <SectionTitle>Integrations</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Panel
            title="Bot brain"
            tone={configured("AI_API_KEY") || configured("HERMES_CUSTOM_API_RIVER_AI_API_KEY") ? "ok" : "warn"}
            line={configured("AI_API_KEY") || configured("HERMES_CUSTOM_API_RIVER_AI_API_KEY") ? "model key present" : "no model key — the Agents tab will refuse to answer"}
            note={`Endpoint ${process.env.AI_BASE_URL?.trim() || "https://api.river.ai/v1"} · model ${process.env.AI_MODEL?.trim() || process.env.AI_MODEL_DEFAULT || "deepseek-ai/DeepSeek-V4.1-Flash"}`}
          />
          <Panel
            title="Market feed"
            tone={configured("SOLANATRACKER_API_KEY") ? "ok" : "warn"}
            line={configured("SOLANATRACKER_API_KEY") ? "SolanaTracker key present" : "no key — the Launched feed shows its empty notice"}
            note="Fresh mints the DexScreener index has not picked up yet."
          />
          <Panel
            title="Gas sponsorship"
            tone={configured("PIMLICO_API_KEY") ? "ok" : "neutral"}
            line={configured("PIMLICO_API_KEY") ? "Pimlico key present (transaction fee only)" : "not configured — the treasury pays the fee itself"}
            note="Never covers account rent; that always comes from the treasury."
          />
          <Panel
            title="Persistence"
            tone={configured("DATABASE_URL") ? "ok" : "neutral"}
            line={configured("DATABASE_URL") ? "Neon Postgres configured" : "no DATABASE_URL — launch records are not persisted"}
            note={configured("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN") ? "Upstash Redis configured for cache + polling watermarks." : "No Upstash configured."}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>Deployment</SectionTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={process.env.NEXT_PUBLIC_APP_URL ? "ok" : "neutral"}>
            app url {process.env.NEXT_PUBLIC_APP_URL?.trim() || "local"}
          </Badge>
          <Badge>cluster {process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || "mainnet-beta"}</Badge>
          <Badge tone="neutral">sending {sendGate ? "on" : "off"}</Badge>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          Values come from the environment your deployment runs with. On Vercel they are set per
          environment (Production / Preview / Development) and changes only apply to new deployments.
        </p>
      </section>
    </div>
  );
}
