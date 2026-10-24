"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard for the code blocks on /dev.
 *
 * Uses the async clipboard API when the page is on a secure origin (which it is: HTTPS in
 * production, localhost in development) and falls back to selecting the text so the block is still
 * copyable by hand when the API is unavailable. It reports the real outcome instead of always
 * claiming success.
 */
export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setState("copied");
      } else {
        setState("failed");
      }
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded border border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/50 transition-colors hover:border-white/25 hover:text-white"
    >
      {state === "copied" ? "copied" : state === "failed" ? "select it" : label}
    </button>
  );
}
