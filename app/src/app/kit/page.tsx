import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { KitClient } from "./kit-client";

export const metadata: Metadata = {
  title: "Launch Kit · PumpLaunchBot",
  description:
    "Everything to ship, in one place: fill your coin in once and get the pump.fun metadata file, a template launch thread and a nine-step checklist wired to the tab that does each step.",
};

/**
 * Launch Kit — the shell.
 *
 * The tab is a client surface end to end (byte counters, clipboard, Blob download, a read-back of
 * the pinned JSON and a read of the launch registry), so this page stays synchronous: no
 * `await connection()`, no <Suspense> boundary, no request-time data, and nothing to freeze into a
 * prerender. `export const dynamic = "force-dynamic"` is not an option here — it fails the build
 * under next.config.ts's cacheComponents setting, and it is not needed for work the client does.
 */
export default function KitPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Launch Kit">
        Everything to ship, in one place. Fill in your coin once: get the metadata file, a launch
        thread and a checklist wired to the other tools. Template-based, no AI.
      </PageHeader>

      <KitClient />
    </div>
  );
}
