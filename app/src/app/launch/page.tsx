import Link from "next/link";
import { LaunchForm } from "./launch-form";

/**
 * Launch tab. Phase 3 wires the real form: pin metadata → build create_v2 → simulate.
 * Every step is wired: metadata pinning, the create_v2 build, the fee-sharing transactions and the
 * vanity mint grinder. Only the final submit is gated (NEXT_PUBLIC_ENABLE_SEND), so this page can be
 * exercised end to end without spending anything.
 */
export default function LaunchPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Launch</h1>
      <p className="mt-2 text-sm text-white/60">
        Three ways in: recreate an existing token, write a new one, or talk to the brain. Then pick
        who signs — your wallet, or the platform treasury.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Recreate", "Paste a mint → optimised name, ticker, art, description."],
          ["Compose", "Type the idea → the brain drafts the whole listing."],
          ["Chat", "Describe it conversationally; the bot fills the form."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="text-sm font-medium">{title}</div>
            <p className="mt-1 text-xs leading-relaxed text-white/55">{body}</p>
          </div>
        ))}
      </div>

      <LaunchForm />

      <section className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-medium">Launch mode</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-white/10 p-3">
            <div className="text-sm">Your wallet signs</div>
            <p className="mt-1 text-xs text-white/55">
              You pay rent and fees, your wallet is the creator, the fee split still applies.
            </p>
          </div>
          <div className="rounded-md border border-white/10 p-3">
            <div className="flex items-center gap-2 text-sm">
              Sponsored
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                treasury key required
              </span>
            </div>
            <p className="mt-1 text-xs text-white/55">
              The platform treasury pays the ~0.03 SOL and signs; you only supply the wallet that
              receives your share.
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-white/40">
          Creator fees: 70% to the wallet you name, 30% to the platform — set on chain through
          pump.fun&apos;s fee-sharing config, and permanent once written.
        </p>
      </section>

      <p className="mt-6 text-xs leading-relaxed text-white/40">
        What runs here today: metadata is pinned to IPFS, the create transaction is built against the real
        pump.fun program and simulated against mainnet, the creator fee split is validated against the
        10000-bps rule, and the vanity grinder produces the mint keypair in this browser. What does not
        run: the submit itself — that needs <code className="font-mono">NEXT_PUBLIC_ENABLE_SEND=true</code>.{" "}
        <Link href="/explore" className="underline hover:text-white/70">
          Look a token up first
        </Link>
        .
      </p>
    </div>
  );
}
