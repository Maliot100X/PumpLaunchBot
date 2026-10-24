"use client";

import { Suspense } from "react";
import { Alert, PageHeader, Skeleton } from "@/components/ui";
import { PoolStudio } from "./pool-client";

/**
 * /pool — Team Grind Pool.
 *
 * A client page for the same reason as /splits: the studio seeds itself from the pool link's query
 * string with `useSearchParams`, which Next will not prerender outside a <Suspense> boundary. The
 * boundary is also the honest behaviour — the title, the trust note and the "no server" note paint
 * immediately while the interactive studio hydrates into the shell.
 *
 * The two notices below are part of the deliverable, not decoration. One states who can open a sealed
 * result and why that is the truth of a link-only design; the other states that there is no pool
 * server, so a contribution travels back to the lead as a file the contributor sends by hand. Saying
 * that where the feature is used is cheaper than a user assuming a coordinator exists.
 */
function PoolFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-56" />
      <Skeleton className="h-48" />
      <Skeleton className="h-40" />
    </div>
  );
}

export default function PoolPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="Team Grind Pool">
        Grind together, seal the result. Send your team a link: every browser that opens it grinds the
        same pattern — each on its own machine, in parallel and uncoordinated — and hands back a result
        sealed with AES-256-GCM that opens with the pool key and nothing else.
      </PageHeader>

      <div className="mt-6 space-y-3">
        <Alert tone="warn" title="Read this before you send the link">
          The pool key is generated in a browser, never on a server, so it sits on machines your team
          controls before anything is sealed. Whoever holds it can open every result sealed for that
          pool — a contributor sees it before they seal anything. Only invite people who trust that key,
          and send the key yourself: it is deliberately not in the link. Your copy is stored in this
          browser.
        </Alert>

        <Alert tone="info" title="No pool server in this build — contributions come back as files">
          A pool link is a URL. It carries the pattern, the pool id, the KDF salt, the iteration count and
          one sealed witness, and nothing is uploaded from this page. That is why a contribution is
          returned by hand: the contributor copies or downloads the sealed result and sends it to you,
          and you paste it back in. No browser is counted as a contributor here until its sealed file is
          actually opened in this tab.
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
