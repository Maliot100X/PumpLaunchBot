"use client";

import { Suspense } from "react";
import { Alert, PageHeader, Skeleton } from "@/components/ui";
import { SplitsStudio } from "./splits-client";

/**
 * /splits — Fee Splits Studio.
 *
 * The page is a client component because the studio reads the share link's query string with
 * `useSearchParams`, which Next refuses to prerender outside a <Suspense> boundary
 * ("useSearchParams() should be wrapped in a suspense boundary at page /splits"). The boundary is
 * also the honest behaviour: the title and the permanence warning paint immediately, and the
 * interactive studio hydrates into the shell.
 */
function SplitsFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-56" />
      <Skeleton className="h-44" />
    </div>
  );
}

export default function SplitsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="Fee Splits Studio">
        Build a creator-fee split with the program&apos;s own rules checked as you type — at most ten
        shareholders, a valid address each, no duplicates, every share above zero, and a total of exactly
        10,000 basis points. Then export the JSON or send the split as a link.
      </PageHeader>

      <div className="mt-6">
        <Alert tone="warn" title="This split is permanent the moment it is sent">
          <span className="font-mono text-[11px]">update_fee_shares_v2</span> sets the final shareholder
          list and revokes the admin in the same call, so a split sent from here can never be edited,
          corrected or reversed afterwards. The recipients and their exact basis points are permanent
          on-chain — it has to be right before it is signed.
        </Alert>
      </div>

      <div className="mt-6">
        <Suspense fallback={<SplitsFallback />}>
          <SplitsStudio />
        </Suspense>
      </div>
    </div>
  );
}
