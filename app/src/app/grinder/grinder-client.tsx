"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Field, SectionTitle, Stat, inputClass } from "@/components/ui";
import {
  BASE58_SIZE,
  VanityError,
  expectedAttempts,
  grindVanity,
  keypairFromResult,
  validatePattern,
  type GrindResult,
} from "@/lib/vanity/grind";
import { ExpectationsTable } from "./expectations-table";
import { baselineRate, humanTime, rateLabel, verdictFor } from "./expectations";

/**
 * Grinder — the browser vanity-address search, wired to the real engine in src/lib/vanity/grind.ts.
 *
 * Honest about what it is:
 *  - the engine searches ONE prefix/suffix pair per run; the count selector just runs it that many
 *    times, sequentially. There is no `#`/`*` wildcard support and no multi-thread claim here, because
 *    the engine does not do those yet — the UI says so instead of implying otherwise.
 *  - keys are generated in this tab, matched here, and never uploaded. The secret key is shown once
 *    and is never stored anywhere.
 *  - the speed shown is measured on this device (attempts ÷ elapsed), and the time estimate uses that
 *    measured rate — not a marketing number. Before the first run there is no measurement yet, so the
 *    estimate falls back to the engine's own documented baseline rate and says so in the label.
 *
 * The pre-run verdicts and the expectations table both come from ./expectations, which computes them
 * with expectedAttempts() — the same function this component's progress budget uses, so the table and
 * a real run cannot disagree.
 */

type Found = {
  address: string;
  secretKeyBase58: string;
  attempts: number;
  elapsedMs: number;
  json: string;
};

export function GrinderClient() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [count, setCount] = useState(1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ attempts: number; rate: number; expected: number } | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [measuredRate, setMeasuredRate] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const expected = useMemo(() => {
    try {
      validatePattern(start, end);
      return expectedAttempts(start, end, ignoreCase);
    } catch {
      return null;
    }
  }, [start, end, ignoreCase]);

  const patternOk = expected !== null;

  // The rate the estimate divides by: this device's own measurement once a run has produced one,
  // otherwise the engine's documented baseline (labelled in the UI so nobody mistakes it for a
  // measurement of their machine).
  const { rate: rateUsed, measured: rateIsMeasured } = baselineRate(measuredRate);

  const run = useCallback(async () => {
    setError(null);
    setFound([]);
    try {
      validatePattern(start, end);
    } catch (err) {
      setError(err instanceof VanityError ? err.message : "invalid pattern");
      return;
    }

    setRunning(true);
    abort.current = new AbortController();
    const results: Found[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const result: GrindResult | null = await grindVanity({
          prefix: start,
          suffix: end,
          ignoreCase,
          signal: abort.current.signal,
          onProgress: (p) => {
            setProgress({ attempts: p.attempts, rate: p.rate, expected: p.expectedAttempts });
            if (p.rate > 0) setMeasuredRate(p.rate);
          },
        });
        if (!result) break;
        const kp = keypairFromResult(result);
        results.push({
          address: result.publicKey,
          secretKeyBase58: JSON.stringify(Array.from(kp.secretKey)),
          attempts: result.attempts,
          elapsedMs: result.elapsedMs,
          json: JSON.stringify(Array.from(kp.secretKey)),
        });
        setFound([...results]);
      }
      if (results.length === 0) setError("stopped without a match");
    } catch (err) {
      setError(err instanceof Error ? err.message : "grind failed");
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }, [start, end, ignoreCase, count]);

  function stop() {
    abort.current?.abort();
  }

  function download(result: Found) {
    const blob = new Blob([result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.address}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("clipboard blocked by the browser — select and copy manually");
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <Alert tone="warn" title="Keys never leave this tab">
        The keypair is generated in your browser and matched here. Nothing is uploaded, nothing is
        stored, and the secret key is shown once — save it or download it, or it is gone. Grinding runs
        on this tab&apos;s main thread, so the speed shown is this device&apos;s real speed; the engine
        currently searches one prefix/suffix pair at a time (no <span className="font-mono">#</span> or{" "}
        <span className="font-mono">*</span> wildcards yet, and no multi-thread claim).
      </Alert>

      <Card className="p-4">
        <SectionTitle>Pattern</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Starts with" id="g-start" hint="base58 only — no 0, O, I or l">
            <input
              id="g-start"
              name="start"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              value={start}
              onChange={(e) => setStart(e.target.value.trim())}
              placeholder="e.g. moon"
              className={`font-mono text-xs ${inputClass}`}
            />
          </Field>
          <Field label="Ends with" id="g-end" hint="the familiar launch suffix is pump">
            <input
              id="g-end"
              name="end"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              value={end}
              onChange={(e) => setEnd(e.target.value.trim())}
              placeholder="e.g. pump"
              className={`font-mono text-xs ${inputClass}`}
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-white/55">
            <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
            ignore case
          </label>
          <label className="flex items-center gap-2 text-xs text-white/55">
            count
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white"
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={10}>10</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {running ? (
            <Button variant="secondary" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button onClick={() => void run()} disabled={!patternOk}>
              Start grinding
            </Button>
          )}
          <Badge tone={patternOk ? "ok" : "warn"}>
            {patternOk ? `${BASE58_SIZE}ⁿ combinations` : "pick a prefix or a suffix"}
          </Badge>
        </div>
        {error ? (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Average keys"
          value={expected === null ? "—" : expected.toLocaleString()}
          hint="the estimated number of keypairs for this pattern"
        />
        <Stat
          label="Verdict"
          value={expected === null ? "—" : verdictFor(expected)}
          hint="Instant ≤ 100K · Easy ≤ 10M · Medium ≤ 10B · above that is GPU territory"
        />
        <Stat
          label="Time on this device"
          value={expected === null ? "—" : humanTime(expected, rateUsed)}
          hint={`${rateLabel(rateUsed, rateIsMeasured)}${
            rateIsMeasured ? "" : " — start a grind and it switches to this device's own rate"
          }`}
        />
      </div>

      {progress ? (
        <Card className="p-4">
          <p className="font-mono text-xs text-white/55 tabular">
            {progress.attempts.toLocaleString()} attempts · {progress.rate.toLocaleString()}/s · budget ~
            {progress.expected.toLocaleString()}
          </p>
        </Card>
      ) : null}

      {found.length > 0 ? (
        <Card className="p-4">
          <SectionTitle aside={`${found.length} found`}>Results</SectionTitle>
          <ul className="mt-3 space-y-3">
            {found.map((f) => (
              <li key={f.address} className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                <p className="break-all font-mono text-sm">{f.address}</p>
                <p className="mt-1 text-[11px] text-white/40 tabular">
                  {f.attempts.toLocaleString()} attempts · {f.elapsedMs} ms
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void copy(f.address)}>
                    Copy address
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => download(f)}>
                    Download keypair JSON
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  The download is the standard 64-byte Solana keypair array — any wallet or{" "}
                  <span className="font-mono">solana-keygen</span> can import it. Use it as the mint when
                  you launch; it must sign the create transaction.
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ExpectationsTable rate={rateUsed} measured={rateIsMeasured} />
    </div>
  );
}
