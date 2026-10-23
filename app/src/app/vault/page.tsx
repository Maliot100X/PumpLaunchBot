import { connection } from "next/server";
import { getTreasuryStatus, RENT_PER_LAUNCH_LAMPORTS, PAYER_RESERVE_LAMPORTS } from "@/lib/treasury";
import { getPimlicoStatus } from "@/lib/pimlico";
import { accountLink } from "@/lib/links";

/**
 * Vault / Treasury tab — Phase 7, wired to the live server code (no client fetch, no placeholders).
 * It reads the treasury through the same module that signs sponsored launches, so the numbers here
 * are the numbers the launch path will use.
 *
 * `export const dynamic = "force-dynamic"` is NOT allowed with this build's cacheComponents setting
 * (measured: "Route segment config dynamic is not compatible with nextConfig.cacheComponents").
 * `await connection()` is the supported way to opt a page out of prerendering.
 */
function sol(lamports: number | null): string {
  if (lamports === null) return "—";
  return `${(lamports / 1_000_000_000).toFixed(7)} SOL`;
}

export default async function VaultPage() {
  await connection(); // live balance on every request, never a frozen prerender
  const [treasury, pimlico] = await Promise.all([getTreasuryStatus(), getPimlicoStatus()]);
  const shortfall =
    treasury.balanceLamports !== null ? Math.max(0, RENT_PER_LAUNCH_LAMPORTS - treasury.balanceLamports) : null;

  const cards: [string, string, string?][] = [
    ["Treasury address", treasury.address ?? "not configured", treasury.address ? accountLink(treasury.address) : undefined],
    ["Live balance", sol(treasury.balanceLamports)],
    ["Rent per sponsored launch", `${RENT_PER_LAUNCH_LAMPORTS.toLocaleString()} lamports`],
    ["Launches the balance covers", treasury.launchesAffordable === null ? "—" : String(treasury.launchesAffordable)],
    ["Payer reserve (kept by the wallet)", `${PAYER_RESERVE_LAMPORTS.toLocaleString()} lamports`],
    ["Shortfall for one launch", shortfall === null ? "—" : `${shortfall.toLocaleString()} lamports`],
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Vault</h1>
      <p className="mt-2 text-sm text-white/60">
        The wallet that sponsors launches. Its key is never in the repo: it is stored encrypted
        (AES-256-GCM + scrypt) in the environment, decrypted in memory for a single signature, and only
        the public address is ever displayed.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([k, v, href]) => (
          <div key={k} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs text-white/40">{k}</dt>
            <dd className="mt-1 break-all font-mono text-sm">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 hover:text-white">
                  {v}
                </a>
              ) : (
                v
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-sm font-medium">Sponsored mode</h2>
          <p className={`mt-1 text-xs ${treasury.configured && treasury.decryptable ? "text-emerald-300" : "text-amber-300"}`}>
            {treasury.configured && treasury.decryptable
              ? "keypair decrypts — sponsored launches are available"
              : (treasury.error ?? "treasury keypair is not configured")}
          </p>
          <p className="mt-2 text-[11px] text-white/45">
            Sending is {process.env.TREASURY_LIVE === "true" ? "ENABLED" : "disabled"} in this environment.
            Even funded, nothing is sent unless the environment and the request both ask for it.
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-sm font-medium">Gas sponsorship (Pimlico, Solana)</h2>
          <p className={`mt-1 text-xs ${pimlico.reachable ? "text-emerald-300" : "text-amber-300"}`}>
            {pimlico.reachable
              ? `paymaster live · fee payer ${pimlico.payerSigner?.slice(0, 8)}… · ${pimlico.supportedFeeTokens.length} fee tokens`
              : (pimlico.error ?? "unavailable")}
          </p>
          <p className="mt-2 text-[11px] text-white/45">
            Sponsors the transaction fee only — account rent (the number above) still comes from the
            treasury.
          </p>
        </div>
      </div>

      <p className="mt-6 text-xs text-white/40">
        Watched numbers, not vibes: every figure on this page comes from a live RPC read taken while
        rendering it.
      </p>
    </div>
  );
}
