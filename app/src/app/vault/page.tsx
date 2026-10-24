import { Suspense } from "react";
import { connection } from "next/server";
import { getTreasuryStatus, RENT_PER_LAUNCH_LAMPORTS, PAYER_RESERVE_LAMPORTS } from "@/lib/treasury";
import { getPimlicoStatus } from "@/lib/pimlico";
import { accountLink } from "@/lib/links";
import { Alert, PageHeader, Panel, SectionTitle, Skeleton, Stat } from "@/components/ui";
import { LocalVault } from "./local-vault";

/**
 * Vault tab — two things that must never be confused with each other, so the page puts them in two
 * separately headed sections and says out loud which is which:
 *
 *  1. "Platform treasury" — the SERVER-side wallet that pays for sponsored launches. Its keypair is
 *     encrypted at rest in the environment (AES-256-GCM under a scrypt-derived key, see
 *     src/lib/treasury.ts), decrypted in memory for a single signature, and only the public address,
 *     live balance and cost per launch are ever rendered here. This section reads the live RPC.
 *
 *  2. "Your keys, in this browser" — the user's OWN grinded mint keypairs, encrypted with a
 *     passphrase in this browser (WebCrypto PBKDF2-SHA256 + AES-256-GCM). Nothing in it touches the
 *     server or the treasury, and the passphrase is never stored anywhere.
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

async function TreasuryLive() {
  await connection(); // live balance on every request, never a frozen prerender
  const [treasury, pimlico] = await Promise.all([getTreasuryStatus(), getPimlicoStatus()]);
  const shortfall =
    treasury.balanceLamports !== null ? Math.max(0, RENT_PER_LAUNCH_LAMPORTS - treasury.balanceLamports) : null;

  const cards: { label: string; value: string; href?: string; hint?: string }[] = [
    {
      label: "Treasury address",
      value: treasury.address ?? "not configured",
      href: treasury.address ? accountLink(treasury.address) : undefined,
      hint: "public address only — the key that controls it never reaches the browser",
    },
    { label: "Live balance", value: sol(treasury.balanceLamports) },
    { label: "Rent per sponsored launch", value: `${RENT_PER_LAUNCH_LAMPORTS.toLocaleString()} lamports` },
    {
      label: "Launches the balance covers",
      value: treasury.launchesAffordable === null ? "—" : String(treasury.launchesAffordable),
    },
    { label: "Payer reserve (kept by the wallet)", value: `${PAYER_RESERVE_LAMPORTS.toLocaleString()} lamports` },
    {
      label: "Shortfall for one launch",
      value: shortfall === null ? "—" : `${shortfall.toLocaleString()} lamports`,
      hint: shortfall === 0 ? "the balance covers one launch" : "top up to sponsor a launch",
    },
  ];

  return (
    <>
      {shortfall !== null && shortfall > 0 ? (
        <div className="mt-4">
          <Alert tone="warn" title="The treasury cannot cover a sponsored launch yet">
            It is {shortfall.toLocaleString()} lamports short of the {RENT_PER_LAUNCH_LAMPORTS.toLocaleString()}{" "}
            a create needs. Nothing is broken — sponsored mode simply stays unavailable until the wallet is
            funded, and the user-signed path is unaffected.
          </Alert>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Stat key={c.label} {...c} />
        ))}
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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

      <p className="mt-4 text-xs text-white/40">
        Watched numbers, not vibes: every figure above comes from a live RPC read taken while rendering
        this page.
      </p>
    </>
  );
}

function TreasurySkeleton() {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[4.5rem]" />
      ))}
    </div>
  );
}

export default function VaultPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Vault">
        Two different kinds of key live behind this tab, and they are kept apart on purpose. The{" "}
        <span className="text-white/85">platform treasury</span> is the server-side wallet that sponsors
        launches — its key is stored encrypted on the server (AES-256-GCM + scrypt), decrypted in memory
        for a single signature, and only its public address is ever shown.{" "}
        <span className="text-white/85">Your keys</span> are the mint keypairs you grind yourself: they
        are encrypted with a passphrase in this browser, and the server never sees them at all.
      </PageHeader>

      <section className="mt-8" aria-labelledby="platform-treasury">
        <SectionTitle aside="server-side · key never sent to the browser">Platform treasury</SectionTitle>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/45">
          The wallet this platform signs sponsored launches with. The keypair is stored encrypted
          (AES-256-GCM, key derived with scrypt from a server passphrase), is never written to disk in the
          clear and is never logged. This section is a read-only report: address, live balance, what one
          sponsored launch costs, and whether sending is enabled in this environment.
        </p>

        <Suspense fallback={<TreasurySkeleton />}>
          <TreasuryLive />
        </Suspense>
      </section>

      <section className="mt-12" aria-labelledby="your-keys">
        <SectionTitle aside="this browser only · never uploaded">Your keys, in this browser</SectionTitle>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/45">
          A separate vault for the ground mint keys you generate for your own launches. It is encrypted
          here, in this tab, with a passphrase only you know — the server has no copy, no recovery path and
          no way to read it. Nothing in this section touches the treasury above.
        </p>

        <LocalVault />
      </section>
    </div>
  );
}
