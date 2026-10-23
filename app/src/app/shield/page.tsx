"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, Skeleton } from "@/components/ui";
import { ShieldClient } from "./shield-client";

/**
 * Shield tab — a client page that keeps the ?mint= deep link working.
 *
 * This page is a client component on purpose (the whole tab is interactive), so the query param is
 * read with `useSearchParams()` here rather than awaited as a server `searchParams`. Under this
 * build's cacheComponents setting a `useSearchParams()` read must sit inside a <Suspense> boundary,
 * otherwise the route errors out during prerender — so the reading part is its own child and the
 * boundary lives in this same file, exactly as the spec allows. Keeping the read here (rather than
 * dropping the deep link) means /shield?mint=… opens with the token already scanned.
 */
function ShieldWithParam() {
  const searchParams = useSearchParams();
  const initialMint = (searchParams.get("mint") ?? "").trim();
  return <ShieldClient initialMint={initialMint} />;
}

export default function ShieldPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Shield">
        Paste any Solana mint to see what the chain and the market actually return for it, then read a
        clone-risk verdict computed only from those returned values — every number printed next to the
        reasoning that produced it. From there, a recreate plan can be generated for the same token.
      </PageHeader>

      <Suspense
        fallback={
          <div className="mt-5">
            <Skeleton className="h-10" />
          </div>
        }
      >
        <ShieldWithParam />
      </Suspense>
    </div>
  );
}
