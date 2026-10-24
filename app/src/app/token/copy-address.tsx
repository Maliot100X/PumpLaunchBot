"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * "Copy address" for the contract gate on /token — the only interactive control on the page.
 *
 * It copies the exact string it was handed and then reports what actually happened. The async
 * clipboard API needs a secure context, and a browser that refuses it gets "select it and copy by
 * hand" rather than a cheerful "Copied" — this page exists to tell people where the real address is,
 * so a button that claims a copy it did not perform is the exact failure this tab is here to prevent.
 *
 * It only ever renders when a published contract address exists; while the token is unpublished
 * the gate renders a disabled <Button> in its place and this component is not mounted at all.
 */
export function CopyAddress({ address }: { address: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      if (!navigator.clipboard || !window.isSecureContext) {
        setState("failed");
      } else {
        await navigator.clipboard.writeText(address);
        setState("copied");
      }
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={() => void copy()}>
        {state === "copied" ? "Copied" : "Copy address"}
      </Button>
      <span role="status" aria-live="polite" className="max-w-full text-[11px] leading-snug text-white/45">
        {state === "copied"
          ? "Copied from this page. Check both ends and the middle in Vamp Shield before you paste it anywhere else."
          : state === "failed"
            ? "This browser refused clipboard access. Select the address and copy it by hand."
            : ""}
      </span>
    </span>
  );
}
