"use client";

import { useState } from "react";

type Token = {
  mint: string;
  name: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  dexId: string | null;
  socials: { url: string; type?: string }[];
  websites: { url: string; label?: string }[];
  metadataUri: string | null;
};

function usd(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v < 0.01) return `$${v.toExponential(3)}`;
  return `$${v.toFixed(4)}`;
}

export default function ExplorePage() {
  const [mint, setMint] = useState("");
  const [token, setToken] = useState<Token | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const value = mint.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setToken(null);
    try {
      const res = await fetch(`/api/token/${encodeURIComponent(value)}`);
      const body = (await res.json()) as { ok?: boolean; token?: Token; error?: string; detail?: string };
      if (!res.ok || !body.token) {
        setError(body.detail ?? body.error ?? `lookup failed (${res.status})`);
      } else {
        setToken(body.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Explore a token</h1>
      <p className="mt-2 text-sm text-white/60">
        Paste any Solana mint. Metadata comes from the chain (Helius), market numbers from
        DexScreener. This is the same lookup the Launch tab uses as its starting point.
      </p>

      <form onSubmit={lookup} className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          placeholder="mint address, e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs outline-none placeholder:text-white/30 focus:border-[#5e6ad2]"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[#5e6ad2] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#4f59b8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#828fff] disabled:opacity-50"
        >
          {busy ? "Looking up…" : "Look up"}
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {token ? (
        <article className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-start gap-4">
            {token.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote token art, arbitrary hosts
              <img
                src={token.imageUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-md border border-white/10 object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <h2 className="truncate text-base font-medium">
                {token.name} <span className="text-white/50">${token.symbol}</span>
              </h2>
              <p className="mt-1 font-mono text-[11px] text-white/40">{token.mint}</p>
              {token.description ? (
                <p className="mt-2 text-sm leading-relaxed text-white/70">{token.description}</p>
              ) : (
                <p className="mt-2 text-xs text-white/40">no on-chain description</p>
              )}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            {[
              ["Price", usd(token.priceUsd)],
              ["Market cap", usd(token.marketCap)],
              ["Liquidity", usd(token.liquidityUsd)],
              ["DEX", token.dexId ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-white/10 bg-white/[0.02] p-2.5">
                <dt className="text-white/40">{k}</dt>
                <dd className="mt-1 font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          {token.socials.length + token.websites.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {[...token.websites, ...token.socials].map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white"
                >
                  {"label" in l && l.label ? l.label : l.url.replace(/^https?:\/\//, "").slice(0, 28)}
                </a>
              ))}
            </div>
          ) : null}

          <p className="mt-4 text-[11px] text-white/35">
            metadata: {token.metadataUri ? token.metadataUri.slice(0, 60) : "none"} · data layer
            phase 1-2 (DexScreener + Helius DAS)
          </p>
        </article>
      ) : null}
    </div>
  );
}
