import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { KitClient } from "./kit-client";

export const metadata: Metadata = {
  title: "Launch Kit · PumpLaunchBot",
  description:
    "Build the pump.fun metadata JSON with live byte counts, export it, and work a launch checklist wired to the grinder, the fee splits and the send gate.",
};

/**
 * Launch Kit — the shell. The tab is a client surface (live byte counts against the program's own
 * limits, clipboard, Blob download, wallet state), so this page stays a static shell: no request-time
 * data, no <Suspense> boundary, no network call.
 */
export default function KitPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="Launch Kit">
        Everything to ship, in one place: fill the coin in once and get the metadata file that gets
        pinned, the exact byte limits the program enforces, and a checklist wired to the tab that does
        each remaining step. Template-based — no AI, and nothing leaves this page until you copy or
        download it.
      </PageHeader>

      <KitClient />
    </div>
  );
}
