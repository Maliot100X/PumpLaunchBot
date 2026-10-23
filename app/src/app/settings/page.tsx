/**
 * Settings tab — the values that must be right before a real launch.
 * Phase 4/8 wire these to the server (env-driven defaults shown read-only for now).
 */
export default function SettingsPage() {
  const rows: [string, string][] = [
    ["Default fee split", "7000 bps user / 3000 bps platform (must sum to 10000, max 10 wallets)"],
    ["Default launch mode", "user-signed (sponsored requires a funded treasury)"],
    ["Metadata pinning", "Pinata v3 files API, gateway gateway.pinata.cloud"],
    ["Image generation", "Pollinations — black-forest-labs/flux.1-schnell"],
    ["RPC", "Helius mainnet (NEXT_PUBLIC_SOLANA_RPC_URL)"],
    ["Tracking store", "Neon Postgres + Upstash Redis (watermarks)"],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-white/60">
        Server-side configuration. Values are read from the environment; nothing secret is editable
        from the browser.
      </p>
      <dl className="mt-6 divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-sm">{k}</dt>
            <dd className="font-mono text-xs text-white/55">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-xs text-white/40">
        Editing these in the UI (with validation against the 10000-bps rule) lands in Phase 4, once
        the fee-sharing transaction exists to apply them.
      </p>
    </div>
  );
}
