import { Suspense } from "react";
import { connection } from "next/server";
import { getTreasuryStatus, RENT_PER_LAUNCH_LAMPORTS, PAYER_RESERVE_LAMPORTS } from "@/lib/treasury";
import { getPimlicoStatus } from "@/lib/pimlico";
import { accountLink } from "@/lib/links";

/**
 * Vault / Treasury tab — Phase 7, wired to the live server code (no client fetch, no placeholders).
 * It reads the treasury through the same module that signs sponsored launches, so the numbers here
 * are the numbers the launch path will use.
 *
 * Two build rules learned the hard way and left here so nobody re-learns them:
 *  - `export const dynamic = "force-dynamic"` is NOT allowed with this build's cacheComponents
 *    setting ("Route segment config dynamic is not compatible with nextConfig.cacheComponents").
 *  - `connection()` must sit inside a <Suspense> boundary, otherwise Next logs a blocking-prerender
 *    warning ("fetch(...) or connection() accessed outside of <Suspense>"). The boundary is also a
 *    real win: the page streams its shell immediately and the live numbers follow.
 */
function sol(lamports: number | null): string {
  if (lamports === null) return "—";
  return `${(lamports / 1_000_000_000).toFixed(7)} SOL`;
}

function Card({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <dt className="text-xs text-white/40">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 hover:text-white">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Panel({ title, tone, line, note }: { title: string; tone: "ok" | "warn"; line: string; note: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className={`mt-1 text-xs ${tone === "ok" ? "text-emerald-300" : "text-amber-300"}`}>{line}</p>
      <p className="mt-2 text-[11px] text-white/45">{note}</p>
    </div>
  );
}

function VaultSkeleton() {
  return (
    <div aria-hidden className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[4.5rem] animate-pulse rounded-lg border border-white/10 bg-white/[0.02]" />
      ))}
    </div>
  );
}

async function VaultLive() {
  await connection(); // live balance on every request, never a frozen prerender
  const [treasury, pimlico] = await Promise.all([getTreasuryStatus(), getPimlicoStatus()]);
  const shortfall =
    treasury.balanceLamports !== null ? Math.max(0, RENT_PER_LAUNCH_LAMPORTS - treasury.balanceLamports) : null;

  const cards: { label: string; value: string; href?: string }[] = [
    {
      label: "Treasury address",
      value: treasury.address ?? "not configured",
      href: treasury.address ? accountLink(treasury.address) : undefined,
    },
    { label: "Live balance", value: sol(treasury.balanceLamports) },
    { label: "Rent per sponsored launch", value: `${RENT_PER_LAUNCH_LAMPORTS.toLocaleString()} lamports` },
    {
      label: "Launches the balance covers",
      value: treasury.launchesAffordable === null ? "—" : String(treasury.launchesAffordable),
    },
    { label: "Payer reserve (kept by the wallet)", value: `${PAYER_RESERVE_LAMPORTS.toLocaleString()} lamports` },
    { label: "Shortfall for one launch", value: shortfall === null ? "—" : `${shortfall.toLocaleString()} lamports` },
  ];

  return (
    <>
      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} {...c} />
        ))}
      </dl>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Panel
          title="Sponsored mode"
          tone={treasury.configured && treasury.decryptable ? "ok" : "warn"}
          line={
            treasury.configured && treasury.decryptable
              ? "keypair decrypts — sponsored launches are available"
              : (treasury.error ?? "treasury keypair is not configured")
          }
          note={`Sending is ${process.env.TREASURY_LIVE === "true" ? "ENABLED" : "disabled"} in this environment. Even funded, nothing is sent unless the environment and the request both ask for it.`}
        />
        <Panel
          title="Gas sponsorship (Pimlico, Solana)"
          tone={pimlico.reachable ? "ok" : "warn"}
          line={
            pimlico.reachable
              ? `paymaster live · fee payer ${pimlico.payerSigner?.slice(0, 8)}… · ${pimlico.supportedFeeTokens.length} fee tokens`
              : (pimlico.error ?? "unavailable")
          }
          note="Sponsors the transaction fee only — account rent (the number above) still comes from the treasury."
        />
      </div>

      <p className="mt-6 text-xs text-white/40">
        Watched numbers, not vibes: every figure above comes from a live RPC read taken while rendering
        this page.
      </p>
    </>
  );
}

export default function VaultPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Vault</h1>
      <p className="mt-2 text-sm text-white/60">
        The wallet that sponsors launches. Its key is never in the repo: it is stored encrypted
        (AES-256-GCM + scrypt) in the environment, decrypted in memory for a single signature, and only
        the public address is ever displayed.
      </p>

      <Suspense fallback={<VaultSkeleton />}>
        <VaultLive />
      </Suspense>
    </div>
  );
}
