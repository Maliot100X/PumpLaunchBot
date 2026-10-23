"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary (App Router convention).
 * Shows what broke instead of a blank page, and keeps the failure copyable — a launch platform
 * that hides its errors is worse than one that shows them.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server logs keep the full trace; this is only for the browser console.
    console.error("PumpLaunchBot route error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-lg font-semibold tracking-tight">Something in this tab failed</h1>
      <p className="mt-2 text-sm text-white/60">
        Nothing was sent and no coins were created by this failure — the launch path only ever sends after
        an explicit, gated confirmation.
      </p>
      <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-red-500/25 bg-red-500/5 p-3 font-mono text-[11px] text-red-200">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5"
      >
        Try again
      </button>
    </div>
  );
}
