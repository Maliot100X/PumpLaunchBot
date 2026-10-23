import { connection } from "next/server";
import { lifecycleFeed, type SolanaTrackerToken } from "@/lib/tokens/solanatracker";
import { tokenLinks } from "@/lib/links";

/**
 * Launched tab — Phase 7.
 *  - The platform's own launches will list here once the tracker persists them (Neon + a polling
 *    watermark in Upstash); there is nothing to show yet and the page says so instead of faking rows.
 *  - The market feed below is LIVE: SolanaTracker's lifecycle buckets (newest, graduating, graduated),
 *    which is the near-real-time view of what is actually launching on pump.fun right now.
 *
 * Live data on every request via `await connection()` — no frozen prerender (and `export const
 * dynamic` is not permitted with this build's cacheComponents setting).
 */
export default async function LaunchedPage() {
  await connection();
  const feed = await lifecycleFeed();

  const rows: { label: string; list: SolanaTrackerToken[] }[] = [
    { label: "Newest", list: feed.latest.slice(0, 12) },
    { label: "Graduating", list: feed.graduating.slice(0, 8) },
    { label: "Graduated", list: feed.graduated.slice(0, 8) },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Launched tokens</h1>
      <p className="mt-2 text-sm text-white/60">
        Coins this platform created will be listed here, read back from the chain rather than from our own
        writes: mint, mode (user-signed or sponsored), fee shareholders, curve progress, age.
      </p>

      <div className="mt-6 rounded-lg border border-dashed border-white/15 p-6 text-center">
        <p className="text-sm text-white/50">No platform launches recorded yet.</p>
        <p className="mt-1 text-xs text-white/35">
          The record is written on a confirmed launch, never before — so this stays empty until a real
          coin is created.
        </p>
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Live market feed</h2>
          <span className="font-mono text-[11px] text-white/35">
            solanatracker · {feed.latest.length + feed.graduating.length + feed.graduated.length} coins tracked
          </span>
        </div>

        {feed.latest.length === 0 && feed.graduating.length === 0 ? (
          <p className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200">
            The tracker returned nothing. Either the API is down or SOLANATRACKER_API_KEY is missing — the
            page will not invent rows to fill the gap.
          </p>
        ) : (
          <div className="mt-3 space-y-6">
            {rows.map(({ label, list }) =>
              list.length === 0 ? null : (
                <div key={label}>
                  <h3 className="text-xs uppercase tracking-wide text-white/40">{label}</h3>
                  <ul className="mt-2 divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
                    {list.map((t) => {
                      const links = tokenLinks(t.mint);
                      return (
                        <li key={`${label}-${t.mint}`} className="flex items-center gap-3 p-3">
                          {t.image ? (
                            // eslint-disable-next-line @next/next/no-img-element -- remote token art from the tracker
                            <img src={t.image} alt="" className="h-8 w-8 shrink-0 rounded border border-white/10 object-cover" />
                          ) : (
                            <span className="h-8 w-8 shrink-0 rounded border border-white/10 bg-white/[0.03]" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">
                              {t.name ?? "unknown"}{" "}
                              <span className="text-white/45">${t.symbol ?? "?"}</span>
                            </p>
                            <p className="truncate font-mono text-[11px] text-white/35">{t.mint}</p>
                          </div>
                          <div className="flex shrink-0 gap-2 text-[11px]">
                            <a
                              href={links.pumpFun}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded border border-white/10 px-2 py-1 text-white/60 hover:border-white/25 hover:text-white"
                            >
                              pump.fun
                            </a>
                            <a
                              href={links.dexScreener}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hidden rounded border border-white/10 px-2 py-1 text-white/60 hover:border-white/25 hover:text-white sm:block"
                            >
                              chart
                            </a>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
