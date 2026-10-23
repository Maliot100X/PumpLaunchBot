import { Suspense } from "react";
import { connection } from "next/server";
import { lifecycleFeed, type SolanaTrackerToken } from "@/lib/tokens/solanatracker";
import { tokenLinks } from "@/lib/links";
import { Alert, EmptyState, LinkButton, PageHeader, SectionTitle, Skeleton } from "@/components/ui";

/**
 * Launched tab — Phase 7.
 *  - This platform's own launches list here once the tracker persists them (Neon plus a polling
 *    watermark in Upstash). There is nothing yet and the page says so instead of faking rows.
 *  - The market feed below is LIVE: SolanaTracker's lifecycle buckets (newest, graduating, graduated),
 *    the near-real-time view of what is actually launching on pump.fun right now.
 *
 * Live data on every request via `await connection()` inside a <Suspense> boundary — no frozen
 * prerender (and `export const dynamic` is not permitted with this build's cacheComponents setting).
 */
export default function LaunchedPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Launched tokens">
        Coins this platform created, read back from the chain rather than from our own writes: mint,
        mode (user-signed or sponsored), fee shareholders, curve progress, age.
      </PageHeader>

      <div className="mt-6">
        <EmptyState title="No platform launches recorded yet.">
          The record is written on a confirmed launch, never before — so this stays empty until a real
          coin is created.
        </EmptyState>
      </div>

      <Suspense fallback={<FeedSkeleton />}>
        <LiveFeed />
      </Suspense>
    </div>
  );
}

async function LiveFeed() {
  await connection();
  const feed = await lifecycleFeed();

  const rows: { label: string; list: SolanaTrackerToken[] }[] = [
    { label: "Newest", list: feed.latest.slice(0, 12) },
    { label: "Graduating", list: feed.graduating.slice(0, 8) },
    { label: "Graduated", list: feed.graduated.slice(0, 8) },
  ];
  const tracked = feed.latest.length + feed.graduating.length + feed.graduated.length;

  return (
    <section className="mt-8">
      <SectionTitle aside={`solanatracker · ${tracked} coins tracked`}>Live market feed</SectionTitle>

      {tracked === 0 ? (
        <div className="mt-3">
          <Alert tone="warn" title="The tracker returned nothing">
            Either the API is down or SOLANATRACKER_API_KEY is missing. This page will not invent rows to
            fill the gap.
          </Alert>
        </div>
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
                      <li key={`${label}-${t.mint}`} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
                        {t.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote token art from the tracker
                          <img
                            src={t.image}
                            alt=""
                            loading="lazy"
                            className="h-8 w-8 shrink-0 rounded border border-white/10 object-cover"
                          />
                        ) : (
                          <span aria-hidden className="h-8 w-8 shrink-0 rounded border border-white/10 bg-white/[0.03]" />
                        )}
                        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                          <p className="truncate text-sm">
                            {t.name ?? "unknown"} <span className="text-white/45">${t.symbol ?? "?"}</span>
                          </p>
                          <p className="truncate font-mono text-[11px] text-white/35">{t.mint}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <LinkButton href={links.pumpFun} size="sm" external>
                            pump.fun
                          </LinkButton>
                          <LinkButton
                            href={links.dexScreener}
                            size="sm"
                            external
                            className="hidden sm:inline-flex"
                          >
                            chart
                          </LinkButton>
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
  );
}

function FeedSkeleton() {
  return (
    <div className="mt-8 space-y-3">
      <Skeleton className="h-4 w-40 border-0 bg-white/[0.07]" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}
