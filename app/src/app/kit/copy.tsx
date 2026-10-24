"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Clipboard writes that report the real outcome (same rule as src/app/dev/copy-button.tsx):
 * `navigator.clipboard` only exists in a secure context, and a browser can refuse the write even
 * then — so this hook keeps three states and never renders a "copied" label for a call that threw.
 *
 * A failure is kept on screen (not auto-cleared) because "select it by hand" is the instruction the
 * user needs; a success clears itself so the button goes back to its resting label.
 */

export type CopyState = "idle" | "copied" | "failed";

export function useClipboard(resetMs = 1800) {
  const [state, setState] = useState<CopyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }

      if (text.trim() === "") {
        setState("failed");
        setError("nothing to copy — the field or template this comes from is empty");
        return false;
      }

      try {
        if (typeof navigator === "undefined" || !navigator.clipboard || !window.isSecureContext) {
          setState("failed");
          setError("the clipboard API is unavailable here (it needs a secure context) — select the text and copy it by hand");
          return false;
        }
        await navigator.clipboard.writeText(text);
        setState("copied");
        setError(null);
        timer.current = window.setTimeout(() => setState("idle"), resetMs);
        return true;
      } catch (err) {
        setState("failed");
        setError(
          err instanceof Error
            ? `the browser refused the clipboard write: ${err.message}`
            : "the browser refused the clipboard write",
        );
        return false;
      }
    },
    [resetMs],
  );

  return { state, error, copy };
}

/** A copy control whose label is the outcome: copy → copied, or copy blocked + the reason. */
export function CopyButton({
  text,
  label = "copy",
  title,
  disabled = false,
  className = "",
}: {
  text: string;
  label?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { state, error, copy } = useClipboard();

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => void copy(text)}
        className={`inline-flex items-center justify-center rounded-md border border-white/15 px-2.5 py-1 text-[12px] text-white/85 transition-colors hover:border-white/30 hover:bg-white/5 active:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/35 ${className}`}
      >
        {state === "copied" ? "copied" : state === "failed" ? "copy blocked" : label}
      </button>
      {state === "failed" && error ? (
        <span aria-live="polite" className="text-[11px] text-amber-300">
          {error}
        </span>
      ) : null}
      {state === "copied" ? (
        <span aria-live="polite" className="sr-only">
          copied to the clipboard
        </span>
      ) : null}
    </span>
  );
}
