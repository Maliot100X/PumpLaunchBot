import { Suspense } from "react";
import { Alert, PageHeader, Skeleton } from "@/components/ui";
import { SplitsStudio } from "./splits-client";

/**
 * /splits — Creator rewards.
 *
 * A server shell, so the title and the permanence warning are part of the prerendered page and paint
 * before any JavaScript runs. `SplitsStudio` reads the share link out of the query string with
 * `useSearchParams`, which Next refuses to prerender outside a <Suspense> boundary
 * ("useSearchParams() should be wrapped in a suspense boundary at page /splits") — and wrapping it
 * is also the honest shape: the static copy is immediate, the interactive studio hydrates into it.
 * That is the whole reason this page is not `export const dynamic` (which cacheComponents rejects).
 */
function StudioFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  );
}

export default function SplitsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="Creator rewards">
        Split fees without the spreadsheet. Up to 10 shareholders, validated addresses, exact basis
        points. Export the JSON or send the link to your team.
      </PageHeader>

      <div className="mt-6">
        <Alert tone="warn" title="A split is permanent the moment it is sent">
          <span className="font-mono text-[11px]">update_fee_shares_v2</span> sets the final shareholder
          list and revokes the admin in the same call, so the recipients and their exact basis points
          are fixed on-chain the first time. It has to be right before it is signed.
        </Alert>
      </div>

      <div className="mt-6">
        <Suspense fallback={<StudioFallback />}>
          <SplitsStudio />
        </Suspense>
      </div>
    </div>
  );
}
