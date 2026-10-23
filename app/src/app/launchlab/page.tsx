import { Suspense } from "react";
import { LaunchBoard } from "./board";
import { PageHeader, Skeleton } from "@/components/ui";

/**
 * /launchlab — the platform's own launch board.
 *
 * The shell is synchronous so the page paints immediately; the board itself is a Suspense child that
 * awaits `connection()` internally, which is the only pattern that works with cacheComponents on.
 */

export const metadata = {
  title: "Launch lab · PumpLaunchBot",
  description: "Every coin launched through PumpLaunchBot, with its fee split and live market data.",
};

export default function LaunchLabPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <PageHeader title="Launch lab">
        Every coin launched through PumpLaunchBot, with its fee split and live market data. Only coins
        launched through this platform appear here — each entry was recorded after its transaction
        confirmed, so nothing is listed from a plan alone. The bonding-curve simulator lives on the
        Launch&nbsp;Lab tab; this is the board of what we actually launched.
      </PageHeader>

      <Suspense
        fallback={
          <div className="mt-5 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        <LaunchBoard />
      </Suspense>
    </div>
  );
}
