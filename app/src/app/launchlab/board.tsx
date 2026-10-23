import Link from "next/link";
import { connection } from "next/server";
import { getFullTokenSnapshot } from "@/lib/tokens/snapshot";
import { listLaunches, type LaunchRecord } from "@/lib/registry";
import { tokenLinks } from "@/lib/links";
import { Alert, Badge, Card, EmptyState, SectionTitle } from "@/components/ui";

/**
 * /launchlab — the board of coins launched THROUGH THIS PLATFORM, and the leaderboard over them.
 *
 * Two honest boundaries, stated on the page rather than hidden:
 *  - only launches that actually confirmed are here, because the registry is written after a send;
 *  - a coin minutes old usually has no DexScreener pair yet, so the market columns say "no pair yet"
 *    instead of showing a zero that would read like a real number.
 *
 * `await connection()` is inside the Suspense child: with cacheComponents on, a blocking prerender is
 * an error, and the sync shell is what lets the rest of the page paint immediately.
 */

type Row = {
  record: LaunchRecord;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  dexId: string | null;
  imageUrl: string | null;
};

function usd(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v < 0.01) return `$${v.toExponential(3)}`;
  return `$${v.toFixed(4)}`;
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Live market data for our own launches. Bounded: the newest 12 get enriched, the rest keep —. */
async function enrich(records: LaunchRecord[]): Promise<Row[]> {
  const live = records.slice(0, 12);
  const settled = await Promise.allSettled(
    live.map(async (record) => {
      const snap = await getFullTokenSnapshot(record.mint);
      return { record, snap };
    }),
  );

  const rows: Row[] = [];
  settled.forEach((outcome, i) => {
    const record = live[i];
    if (outcome.status === "fulfilled") {
      const { snap } = outcome.value;
      rows.push({
        record,
        priceUsd: snap.priceUsd,
        marketCap: snap.marketCap,
        liquidityUsd: snap.liquidityUsd,
        dexId: snap.dexId,
        imageUrl: snap.imageUrl ?? record.imageUri,
      });
    } else {
      rows.push({ record, priceUsd: null, marketCap: null, liquidityUsd: null, dexId: null, imageUrl: record.imageUri });
    }
  });

  for (const record of records.slice(12)) {
    rows.push({ record, priceUsd: null, marketCap: null, liquidityUsd: null, dexId: null, imageUrl: record.imageUri });
  }
  return rows;
}

export async function LaunchBoard() {
  await connection(); // live board on every request, never a frozen prerender

  const result = await listLaunches(100);

  if (!result.configured) {
    return (
      <div className="mt-5">
        <Alert tone="warn" title="The launch registry is not configured">
          {result.error}. Every launch this platform sends is recorded to Upstash Redis; with the store
          unset, this board can only say that it has nowhere to look — it will not show an empty board,
          because an empty board and an unconfigured one are not the same claim.
        </Alert>
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="mt-5">
        <Alert tone="error" title="Reading the registry failed">
          {result.error}
        </Alert>
      </div>
    );
  }

  if (result.launches.length === 0) {
    return (
      <div className="mt-5">
        <EmptyState title="No launches recorded yet">
          The registry is connected and answers, and it is empty: no coin has been launched through this
          platform so far. The first recorded launch appears here the moment its transaction confirms.
        </EmptyState>
      </div>
    );
  }

  const rows = await enrich(result.launches);
  const priced = rows.filter((r) => r.marketCap !== null).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const unpriced = rows.filter((r) => r.marketCap === null);
  const split = rows.filter((r) => r.record.userBps > 0).length;
  const sponsored = rows.filter((r) => r.record.mode === "sponsored").length;

  return (
    <div className="mt-5 space-y-8">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Recorded launches", String(result.total)],
            ["With a live pair", String(priced.length)],
            ["70/30 splits written", String(split)],
            ["Sponsored by treasury", String(sponsored)],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <dt className="text-xs text-white/40">{k}</dt>
            <dd className="tabular mt-1 text-lg">{v}</dd>
          </div>
        ))}
      </dl>

      {priced.length > 0 ? (
        <section>
          <SectionTitle aside="ranked by market cap, live from DexScreener">Leaderboard</SectionTitle>
          <Card className="mt-3 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs text-white/40">
                <tr>
                  <th className="px-3 py-2 font-normal">#</th>
                  <th className="px-3 py-2 font-normal">Coin</th>
                  <th className="px-3 py-2 text-right font-normal">Market cap</th>
                  <th className="px-3 py-2 text-right font-normal">Liquidity</th>
                  <th className="px-3 py-2 text-right font-normal">Price</th>
                  <th className="px-3 py-2 font-normal">Split</th>
                  <th className="px-3 py-2 font-normal">Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {priced.map((row, i) => {
                  const links = tokenLinks(row.record.mint);
                  return (
                    <tr key={row.record.mint}>
                      <td className="tabular px-3 py-2 text-white/45">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {row.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- token art, arbitrary host
                            <img
                              src={row.imageUrl}
                              alt=""
                              width={28}
                              height={28}
                              loading="lazy"
                              className="h-7 w-7 rounded border border-white/10 object-cover"
                            />
                          ) : (
                            <span className="h-7 w-7 rounded border border-dashed border-white/15" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate">{row.record.name}</span>
                            <span className="block truncate font-mono text-[10px] text-white/40">
                              ${row.record.symbol}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="tabular px-3 py-2 text-right">{usd(row.marketCap)}</td>
                      <td className="tabular px-3 py-2 text-right">{usd(row.liquidityUsd)}</td>
                      <td className="tabular px-3 py-2 text-right">{usd(row.priceUsd)}</td>
                      <td className="tabular px-3 py-2 text-xs text-white/55">
                        {row.record.userBps > 0 ? `${row.record.userBps / 100}% / ${row.record.platformBps / 100}%` : "treasury 100%"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex gap-2">
                          <a href={links.pumpFun} target="_blank" rel="noopener noreferrer" className="text-[#8f9bff] hover:underline">
                            pump.fun
                          </a>
                          <Link href={links.platformExplore} className="text-[#8f9bff] hover:underline">
                            explore
                          </Link>
                          <a href={links.dexScreener} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:underline">
                            dex
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle aside={`${result.launches.length} shown of ${result.total}`}>Every launch, newest first</SectionTitle>
        <Card className="mt-3 divide-y divide-white/10 p-0">
          {rows.map((row) => {
            const links = tokenLinks(row.record.mint);
            return (
              <article key={row.record.mint} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm">{row.record.name}</h3>
                      <span className="font-mono text-xs text-white/45">${row.record.symbol}</span>
                      <Badge tone={row.record.mode === "sponsored" ? "neutral" : "ok"}>
                        {row.record.mode === "sponsored" ? "treasury paid" : "self launched"}
                      </Badge>
                      {row.record.sourceMint ? <Badge tone="neutral">recreated</Badge> : null}
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-white/40">{row.record.mint}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {ago(row.record.createdAt)} · creator {row.record.creator.slice(0, 4)}…
                      {row.record.creator.slice(-4)}
                      {row.record.feeWallet ? ` · fees to ${row.record.feeWallet.slice(0, 4)}…${row.record.feeWallet.slice(-4)}` : " · no fee wallet given"}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-right text-xs">
                    <div>
                      <dt className="text-white/40">Market cap</dt>
                      <dd className="tabular mt-0.5">{usd(row.marketCap)}</dd>
                    </div>
                    <div>
                      <dt className="text-white/40">Liquidity</dt>
                      <dd className="tabular mt-0.5">{usd(row.liquidityUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-white/40">DEX</dt>
                      <dd className="mt-0.5">{row.dexId ?? "no pair yet"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <a href={links.pumpFun} target="_blank" rel="noopener noreferrer" className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white">
                    pump.fun
                  </a>
                  <Link href={links.platformExplore} className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white">
                    our explore view
                  </Link>
                  <a href={links.explorer} target="_blank" rel="noopener noreferrer" className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white">
                    solscan
                  </a>
                  {row.record.signatures.map((sig) => (
                    <a key={sig} href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener noreferrer" className="rounded border border-white/10 px-2 py-1 font-mono text-white/55 hover:border-white/25 hover:text-white">
                      tx {sig.slice(0, 6)}…{sig.slice(-4)}
                    </a>
                  ))}
                </div>
              </article>
            );
          })}
        </Card>
      </section>

      {unpriced.length > 0 ? (
        <p className="text-xs leading-relaxed text-white/40">
          {unpriced.length} launch{unpriced.length === 1 ? "" : "es"} above have no DexScreener pair yet, so their
          market cap, liquidity and price are shown as — rather than zero. They rank on the leaderboard as soon as a
          pool exists.
        </p>
      ) : null}
    </div>
  );
}
