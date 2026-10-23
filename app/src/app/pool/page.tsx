"use client";

import { Suspense } from "react";
import { Alert, PageHeader, Skeleton } from "@/components/ui";
import { PoolStudio } from "./pool-client";

/**
 * /pool — Team Grind Pool.
 *
 * A client page for the same reason as /splits: the studio reads the pool link out of the query string
 * with `useSearchParams`, and Next will not prerender that outside a <Suspense> boundary.
 *
 * The honesty notice below is part of the deliverable, not decoration. There is no pool service in this
 * build: the link carries the pattern and the count, contributions live in this tab, nothing is
 * uploaded and nothing is encrypted. Saying so where the feature is used is cheaper than a user
 * assuming their teammates' results are safe somewhere.
 */
function PoolFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-52" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

export default function PoolPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="Team Grind Pool">
        Grind together on one pattern. The pool link carries the target and the count, each contributor
        adds the address their machine found, and the results list stays masked until the reveal key is
        entered.
      </PageHeader>

      <div className="mt-6">
        <Alert tone="info" title="Local coordination only — there is no pool server in this build">
          A pool link is a URL: it carries the pattern, the case rule, the count and a pool id, nothing
          more. Results you add live in this tab&apos;s state — they are never uploaded, and a reload
          clears them. Nothing here is encrypted either: the reveal key masks imported addresses on
          screen so they are not on display, while the addresses themselves stay in the page&apos;s state.
          Handing a result to a teammate means sending them its plain-text result code by hand.
        </Alert>
      </div>

      <div className="mt-6">
        <Suspense fallback={<PoolFallback />}>
          <PoolStudio />
        </Suspense>
      </div>
    </div>
  );
}
