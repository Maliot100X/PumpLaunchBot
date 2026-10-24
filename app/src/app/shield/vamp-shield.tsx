"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Field, SectionTitle, inputClass } from "@/components/ui";
import { analyseAntiVamp, compareAddresses, formatKeys } from "@/lib/shield/antivamp";

/**
 * Vamp Shield — the anti-vamp block on the Shield tab, rebuilt to the spec captured from
 * grindcore.fun's own #/shield view (_research/TAB-SPECS.md):
 *
 *   "Your contract address" input · compared characters highlighted · a score badge (72 · Solid) ·
 *   "a vamp needs ~128T keys" · the attacker cost table (laptop 10K/s → 406 y, one GPU 30M/s →
 *   49.4 d, farm 2B/s → 17.8 h) · "check a suspect address" · Vamp Radar with per-row evidence.
 *
 * All the arithmetic lives in lib/shield/antivamp.ts and is unit-tested against THEIR published
 * figures, so the badge here cannot drift from the reasoning behind it.
 */

type RadarRow = {
  mint: string;
  name: string;
  ticker: string;
  imageUrl: string | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  priceUsd: number | null;
  sameTicker: boolean;
  sameName: boolean;
  leadMatches: number;
  tailMatches: number;
  verdict: "Likely vamp" | "Suspicious";
  reasons: string[];
  links: { dexScreener: string; pumpFun: string; platformExplore: string };
};

type RadarResponse = {
  ok?: boolean;
  error?: string;
  detail?: string;
  watched?: { mint: string; ticker: string | null; name: string | null; compared: { lead: number; tail: number } };
  searchedTerms?: string[];
  count?: number;
  flagged?: number;
  suspicious?: number;
  rows?: RadarRow[];
  coverageNote?: string;
};

function usd(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

const VERDICT_TONE = { Weak: "warn", Solid: "neutral", Fortified: "ok" } as const;

export function VampShield({ initialMint = "" }: { initialMint?: string }) {
  const [address, setAddress] = useState(initialMint);
  const [lead, setLead] = useState(4);
  const [tail, setTail] = useState(4);
  const [compareCase, setCompareCase] = useState(false);
  const [suspect, setSuspect] = useState("");

  const analysis = useMemo(() => analyseAntiVamp(lead, tail, address.trim() || undefined), [lead, tail, address]);
  const trimmed = address.trim();
  const comparison = suspect.trim() && trimmed.length >= 8 ? compareAddresses(trimmed, suspect.trim(), lead, tail, compareCase) : null;

  /* ---------------------------------------------------------------- radar */

  const [radar, setRadar] = useState<RadarResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const scan = useCallback(
    async (mint: string, ticker?: string, name?: string) => {
      setScanning(true);
      setRadarError(null);
      try {
        const params = new URLSearchParams({ mint, lead: String(lead), tail: String(tail) });
        if (ticker) params.set("ticker", ticker);
        if (name) params.set("name", name);
        const res = await fetch(`/api/shield/radar?${params.toString()}`);
        const body = (await res.json()) as RadarResponse;
        if (!res.ok || body.ok === false) {
          setRadarError(body.detail ?? body.error ?? `radar failed (${res.status})`);
          return;
        }
        setRadar(body);
        setLastScan(Date.now());
      } catch (err) {
        setRadarError(err instanceof Error ? err.message : "network error");
      } finally {
        setScanning(false);
      }
    },
    [lead, tail],
  );

  // Their note: "Watchlist rescans every 5 min while this tab is open ... it does not run when the
  // tab is closed." Implemented as an interval that is cleared on unmount, which is that same claim.
  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (watching && trimmed) {
      timer.current = setInterval(() => void scan(trimmed, radar?.watched?.ticker ?? undefined, radar?.watched?.name ?? undefined), 5 * 60 * 1000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [watching, trimmed, scan, radar?.watched?.ticker, radar?.watched?.name]);

  /* ------------------------------------------------------------- rendering */

  const leadChars = trimmed.slice(0, lead);
  const tailChars = trimmed.length > lead ? trimmed.slice(-tail) : "";
  const middle = trimmed.length > lead + tail ? trimmed.slice(lead, -tail) : "";

  return (
    <section className="mt-8">
      <SectionTitle aside="anti-vamp analysis">How cheap is it to clone your CA?</SectionTitle>

      <Card className="mt-3 p-4">
        <p className="text-sm leading-relaxed text-white/60">
          Copies imitate the first and last characters of an address, because that is what holders
          actually compare. Everything below is arithmetic over that window: how much work a copy has
          to do, and how long it takes at three real attacker speeds.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Your contract address" id="vamp-address">
            <input
              id="vamp-address"
              name="vampAddress"
              autoComplete="off"
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="paste your CA"
              className={`font-mono text-xs ${inputClass}`}
            />
          </Field>

          <div className="flex items-end gap-3">
            <Field label="At each end" id="vamp-lead">
              <input
                id="vamp-lead"
                name="vampLead"
                type="number"
                min={1}
                max={8}
                inputMode="numeric"
                value={lead}
                onChange={(e) => {
                  // Their page shows ONE number: "Characters people actually compare at each end: 4".
                  // So this control moves both ends together rather than leaving a hidden asymmetry.
                  const n = Math.max(1, Math.min(8, Number(e.target.value) || 1));
                  setLead(n);
                  setTail(n);
                }}
                className={`w-16 tabular ${inputClass}`}
              />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-xs text-white/55">
              <input type="checkbox" checked={compareCase} onChange={(e) => setCompareCase(e.target.checked)} />
              exact case
            </label>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-white/40">
          Characters people actually compare at each end: <span className="tabular">{lead}</span> — the
          same window used against a suspect below and by the radar.
        </p>

        {trimmed.length >= 8 ? (
          <>
            <div className="mt-4 rounded-md border border-white/10 bg-black/30 p-3">
              <p className="text-[11px] text-white/40">The characters holders compare are highlighted here.</p>
              <p className="mt-2 break-all font-mono text-sm">
                <span className="rounded bg-amber-400/20 px-0.5 text-amber-200">{leadChars}</span>
                <span className="text-white/40">{middle}</span>
                <span className="rounded bg-amber-400/20 px-0.5 text-amber-200">{tailChars}</span>
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="tabular text-2xl text-white/85">{analysis.score}</span>
              <Badge tone={VERDICT_TONE[analysis.verdict]}>{analysis.verdict}</Badge>
              <span className="text-xs text-white/50">{analysis.headline}</span>
            </div>

            <table className="mt-4 w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs text-white/40">
                <tr>
                  <th className="py-2 font-normal">Attacker</th>
                  <th className="py-2 font-normal">Speed</th>
                  <th className="py-2 text-right font-normal">Time to clone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {analysis.costs.map((c) => (
                  <tr key={c.name}>
                    <td className="py-2">{c.name}</td>
                    <td className="tabular py-2 text-white/55">
                      {c.keysPerSecond >= 1e9
                        ? `${c.keysPerSecond / 1e9}B/s`
                        : c.keysPerSecond >= 1e6
                          ? `${c.keysPerSecond / 1e6}M/s`
                          : `${c.keysPerSecond / 1e3}K/s`}
                    </td>
                    <td className="tabular py-2 text-right">{c.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Attacker speeds are assumptions, not measurements of your attacker: laptop browser ≈10K/s,
              one GPU ≈30M/s, 8-GPU farm ≈2B/s. Raise the cost{" "}
              <span className="text-white/60">{analysis.nextCharMultiplier}×</span> per character — going
              from {lead}+{tail} to {lead + 1}+{tail} compared characters multiplies a copy&apos;s work by{" "}
              {analysis.nextCharMultiplier} ({formatKeys(analysis.keysNeeded * analysis.nextCharMultiplier)}{" "}
              keys). Teach holders to check both ends — and grind a pattern on both sides yourself.
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs text-white/40">
            Paste at least 8 characters of an address to render the comparison window and the cost table.
          </p>
        )}
      </Card>

      {/* ------------------------------------------------ suspect checker */}

      <Card className="mt-4 p-4">
        <h3 className="text-sm">Check a suspect address</h3>
        <p className="mt-1 text-xs text-white/45">
          Paste a lookalike you spotted in a chat or on a screener. Only the compared window above is
          examined, which is exactly what a reader can check by eye.
        </p>

        <div className="mt-3">
          <Field label="Suspect address" id="vamp-suspect">
            <input
              id="vamp-suspect"
              name="vampSuspect"
              autoComplete="off"
              spellCheck={false}
              value={suspect}
              onChange={(e) => setSuspect(e.target.value)}
              placeholder="paste the address you were sent"
              className={`font-mono text-xs ${inputClass}`}
              disabled={trimmed.length < 8}
            />
          </Field>
        </div>

        {comparison ? (
          <div className="mt-3" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={comparison.identical ? "neutral" : comparison.looksLikeACopy ? "warn" : "ok"}>
                {comparison.identical
                  ? "same address"
                  : comparison.looksLikeACopy
                    ? "same ends, different middle — a copy"
                    : "differs"}
              </Badge>
              <span className="tabular text-xs text-white/50">
                {comparison.matched} of {comparison.compared} compared characters match
              </span>
            </div>
            <p className="mt-2 break-all font-mono text-xs">
              {comparison.chars.map((c, i) => (
                <span
                  key={`${c.side}-${i}`}
                  className={c.matches ? "rounded bg-emerald-400/20 px-0.5 text-emerald-200" : "rounded bg-red-400/20 px-0.5 text-red-200"}
                >
                  {c.char}
                </span>
              ))}
            </p>
            <p className="mt-1 text-[11px] text-white/40">
              Read left to right: the {lead} leading characters, then the {tail} trailing ones.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/40">
            {trimmed.length < 8
              ? "Enter your own contract address first — the comparison needs a window to compare against."
              : "Paste a suspect address to compare its ends with yours."}
          </p>
        )}
      </Card>

      {/* ------------------------------------------------------ vamp radar */}

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm">
            Vamp Radar <Badge tone="neutral">new</Badge>
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void scan(trimmed)}
              disabled={scanning || trimmed.length < 32}
            >
              {scanning ? "Scanning…" : "Scan now"}
            </Button>
            <Button
              type="button"
              onClick={() => setWatching((w) => !w)}
              disabled={trimmed.length < 32}
            >
              {watching ? "Stop watchlist" : "Add to watchlist"}
            </Button>
          </div>
        </div>

        <p className="mt-1 text-xs leading-relaxed text-white/45">
          Watch the market for tokens that copy your ticker, your name, or the ends of your address.
          {watching ? " Watching: this tab rescans every 5 minutes while it is open." : ""}
        </p>

        <div aria-live="polite">
          {radarError ? (
            <div className="mt-3">
              <Alert tone="error" title="Radar failed">
                {radarError}
              </Alert>
            </div>
          ) : null}
        </div>

        {radar?.ok ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
              <span className="tabular">
                {radar.flagged ?? 0} likely vamp{(radar.flagged ?? 0) === 1 ? "" : "s"} ·{" "}
                {radar.suspicious ?? 0} suspicious · {radar.count ?? 0} flagged
              </span>
              {lastScan ? <span>· {new Date(lastScan).toLocaleTimeString()}</span> : null}
              <span className="break-all font-mono text-[10px] text-white/35">
                searched: {(radar.searchedTerms ?? []).join(", ")}
              </span>
            </div>

            {(radar.rows ?? []).length === 0 ? (
              <p className="mt-3 text-xs text-white/45">
                Nothing on the market matched this ticker, name or address ends in the pairs searched.
                That is a partial answer, not a clean bill of health.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-white/10">
                {(radar.rows ?? []).map((row) => (
                  <li key={row.mint} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-[11px] text-white/70">{row.mint}</p>
                        <p className="mt-0.5 text-xs text-white/50">
                          <span className={row.verdict === "Likely vamp" ? "text-amber-300" : "text-white/45"}>
                            {row.verdict}
                          </span>
                          {row.ticker ? ` · ${row.ticker}` : ""}
                          {row.sameTicker ? " · same ticker" : ""}
                          {row.sameName ? ` · ${row.name}` : ""}
                          {` · ${row.leadMatches}+${row.tailMatches} matching ends`}
                          {` · liq ${usd(row.liquidityUsd)} · mc ${usd(row.marketCap)}`}
                        </p>
                      </div>
                      <a
                        href={row.links.dexScreener}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[11px] text-[#8f9bff] hover:underline"
                      >
                        Chart ↗
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 text-[11px] leading-relaxed text-white/40">{radar.coverageNote}</p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/40">
            {trimmed.length < 32
              ? "Paste a full contract address to scan for copies of it."
              : "Press Scan now to search the market for tokens imitating this one."}
          </p>
        )}
      </Card>
    </section>
  );
}
