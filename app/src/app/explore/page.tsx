import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { ExploreLookup } from "./explore-lookup";

/**
 * Explore tab — a server shell around the lookup surface.
 *
 * The query param is read HERE and handed down as a plain string, which is why the links this app
 * generates (`/explore?mint=…`, from the sponsored plan and from the bot's token tool) now resolve
 * to a looked-up token instead of an empty box.
 *
 * `await searchParams` is a request-time read, so it sits in a <Suspense>-wrapped child: with
 * cacheComponents, awaiting request data at the top of a page is a blocking-prerender error.
 */
type ExploreSearchParams = { mint?: string | string[] };

async function ExploreWithParam({ searchParams }: { searchParams: Promise<ExploreSearchParams> }) {
  const params = await searchParams;
  const raw = params.mint;
  const initialMint = typeof raw === "string" ? raw.trim() : "";
  return <ExploreLookup initialMint={initialMint} />;
}

export default function ExplorePage({ searchParams }: { searchParams: Promise<ExploreSearchParams> }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Explore a token">
        Paste any Solana mint. Metadata comes from the chain (Helius DAS), market numbers from
        DexScreener. This is the same lookup the Launch tab uses as its starting point.
      </PageHeader>

      <Suspense
        fallback={
          <div className="mt-5">
            <Skeleton className="h-10" />
          </div>
        }
      >
        <ExploreWithParam searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
