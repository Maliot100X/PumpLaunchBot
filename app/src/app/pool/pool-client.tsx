"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { absoluteUrl } from "@/lib/links";
import { Alert, Badge, Button, Card, EmptyState, Field, SectionTitle, inputClass } from "@/components/ui";

/**
 * Team Grind Pool — the interactive half of /pool.
 *
 * What this build really is, stated in the UI as well as here: a coordinator, not a service. The link
 * carries the pattern, the case rule, the count and a pool id in its query string; contributions live in
 * this component's state. Nothing is uploaded, nothing is encrypted, and a reload clears the pool.
 *
 * The reveal gate is therefore described honestly everywhere it appears: it masks imported addresses on
 * screen so they are not sitting in plain view during a shared screen, and the key is a local string
 * comparison. It is not cryptography, and the word "encrypted" is deliberately not used anywhere on
 * this page — the addresses are in this tab's state either way.
 */

/** Row ids are React keys only. */
let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `c${rowSeq}`;
}

/** Pool and reveal ids get read aloud and re-typed by hand, so the alphabet drops 0/O, 1/l and I. */
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

const DEFAULT_COUNT = 3;
const MAX_COUNT = 64;

function parseCount(raw: string | null): number {
  const n = Number((raw ?? "").trim());
  if (!Number.isFinite(n)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, Math.round(n)));
}

/**
 * ui.tsx's inputClass carries `outline-none`, which sets `outline-style: none` — and the app's ring is
 * the base-layer `:focus-visible { outline: 2px solid #828fff }` in globals.css. Utilities beat the base
 * layer, so the ring never showed on an input. Verified against the installed Tailwind (v4.3.3) by
 * compiling both; `focus-visible:outline-solid!` re-asserts the style with !important, which wins
 * regardless of the order Tailwind emits the utilities in.
 */
const input = `${inputClass} focus-visible:outline-solid!`;
const monoInput = `${input} font-mono text-xs`;

/** Absolute for sharing, relative when the deployment has no NEXT_PUBLIC_APP_URL (local dev). */
function shareableLink(path: string): string {
  const configured = absoluteUrl(path);
  if (configured.startsWith("http")) return configured;
  return typeof window === "undefined" ? configured : new URL(path, window.location.origin).toString();
}

type Contribution = {
  id: string;
  who: string;
  address: string;
  note: string;
  /** True when this browser typed it — your own entries are never hidden from you. */
  mine: boolean;
};

/** The line a contributor hands back. Plain text on purpose: `who|address|note`. */
function encodeContribution(c: Contribution): string {
  return `${c.who}|${c.address}|${c.note}`;
}

function decodeContribution(line: string): Contribution | null {
  const [who = "", address = "", ...rest] = line.split("|");
  if (address.trim() === "") return null;
  return {
    id: nextRowId(),
    who: who.trim() || "anonymous",
    address: address.trim(),
    note: rest.join("|").trim(),
    mine: false,
  };
}

/** Ends only: enough to tell two results apart, not enough to copy the address off a shared screen. */
function maskAddress(address: string): string {
  if (address.length <= 8) return "••••••";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type PoolSeed = {
  start: string;
  end: string;
  exactCase: boolean;
  wanted: number;
  poolId: string;
  /** A link was opened or created, so there is a pool in this tab. */
  ready: boolean;
};

function seedFromParams(params: URLSearchParams): PoolSeed {
  return {
    start: params.get("start")?.trim() ?? "",
    end: params.get("end")?.trim() ?? "",
    exactCase: params.get("cs") === "1",
    wanted: parseCount(params.get("n")),
    poolId: params.get("id")?.trim() ?? "",
    ready: params.has("start") || params.has("end"),
  };
}

export function PoolStudio() {
  const params = useSearchParams();

  // Seed the state once, from the query string, in lazy initializers — never in an effect: a pool link
  // opens straight into a live pool in the same render that first paints this subtree. (Recomputing
  // `seed` on later renders is harmless: every initializer above reads it exactly once.)
  const seeded = seedFromParams(params);
  const [start, setStart] = useState(() => seeded.start);
  const [end, setEnd] = useState(() => seeded.end);
  const [exactCase, setExactCase] = useState(() => seeded.exactCase);
  const [wanted, setWanted] = useState(() => seeded.wanted);
  const [poolId, setPoolId] = useState(() => seeded.poolId);
  const [ready, setReady] = useState(() => seeded.ready);
  const [revealKey, setRevealKey] = useState("");
  const [revealInput, setRevealInput] = useState("");
  const [contributions, setContributions] = useState<Contribution[]>([]);

  const [who, setWho] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [codeText, setCodeText] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const revealed = revealKey !== "" && revealInput.trim() === revealKey;
  const collected = contributions.length;
  const hidden = contributions.filter((c) => !c.mine && !revealed).length;
  const hasPattern = start.trim() !== "" || end.trim() !== "";

  const poolPath = useMemo(() => {
    const query = new URLSearchParams();
    if (start.trim()) query.set("start", start.trim());
    if (end.trim()) query.set("end", end.trim());
    query.set("cs", exactCase ? "1" : "0");
    query.set("n", String(wanted));
    if (poolId) query.set("id", poolId);
    return `/pool?${query.toString()}`;
  }, [start, end, exactCase, wanted, poolId]);

  function flash(key: string) {
    setCopied(key);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 2000);
  }

  async function copy(text: string, key: string) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      flash(key);
    } catch {
      setCopyError("This browser refused clipboard access — the value is on screen and selectable, copy it by hand.");
    }
  }

  function createPool() {
    setPoolId(randomId(6));
    setRevealKey(randomId(12));
    setRevealInput("");
    setReady(true);
    setContributions([]);
    setStatus("Pool created in this tab. The reveal key is below — copy it now, it is not in the link and not stored anywhere.");
  }

  function loadPool(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setLinkError("Paste the pool link your team lead sent you.");
      return;
    }
    let url: URL;
    try {
      url = new URL(trimmed, window.location.origin);
    } catch {
      setLinkError("That is not a URL this browser can read. Paste the whole link, including https://.");
      return;
    }
    const p = url.searchParams;
    if (!p.has("start") && !p.has("end")) {
      setLinkError("That link carries no pattern — a pool link has start= and/or end= in it.");
      return;
    }
    setStart(p.get("start")?.trim() ?? "");
    setEnd(p.get("end")?.trim() ?? "");
    setExactCase(p.get("cs") === "1");
    setWanted(parseCount(p.get("n")));
    setPoolId(p.get("id")?.trim() ?? "");
    setRevealKey(""); // the reveal key is deliberately not in the link
    setRevealInput("");
    setContributions([]); // results belong to one pool at a time
    setReady(true);
    setLinkError(null);
    setStatus("Pool loaded. Add your result below, then copy its result code back to your team lead.");
  }

  function addContribution() {
    const trimmedAddress = address.trim();
    if (trimmedAddress === "") {
      setStatus("Paste the address your machine ground before adding it.");
      return;
    }
    setContributions((rows) => [
      ...rows,
      { id: nextRowId(), who: who.trim() || "you", address: trimmedAddress, note: note.trim(), mine: true },
    ]);
    setAddress("");
    setNote("");
    setStatus("Added to this tab's list and nowhere else. Copy its result code and send that line to your team lead.");
  }

  function addCodes() {
    const lines = codeText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      setStatus("Paste one result code per line first.");
      return;
    }
    const parsed: Contribution[] = [];
    let rejected = 0;
    for (const line of lines) {
      const decoded = decodeContribution(line);
      if (decoded) parsed.push(decoded);
      else rejected += 1;
    }
    if (parsed.length > 0) setContributions((rows) => [...rows, ...parsed]);
    setCodeText("");
    setStatus(
      `Added ${parsed.length} result code${parsed.length === 1 ? "" : "s"}.` +
        (rejected > 0
          ? ` ${rejected} line${rejected === 1 ? "" : "s"} could not be read — a code is contributor|address|note.`
          : ""),
    );
  }

  function removeContribution(id: string) {
    setContributions((rows) => rows.filter((c) => c.id !== id));
  }

  const collectedShare = wanted > 0 ? Math.min(100, (collected / wanted) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <SectionTitle aside={poolId ? `pool ${poolId}` : "no pool yet"}>Create a pool</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          The pattern and the count go into the link, so everyone who opens it grinds the same target.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="pool-start" label="Starts with" hint="Empty means any start.">
            <input
              id="pool-start"
              name="start"
              autoComplete="off"
              spellCheck={false}
              maxLength={8}
              className={monoInput}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="e.g. moon"
            />
          </Field>
          <Field id="pool-end" label="Ends with" hint="Empty means any end.">
            <input
              id="pool-end"
              name="end"
              autoComplete="off"
              spellCheck={false}
              maxLength={8}
              className={monoInput}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="e.g. pump"
            />
          </Field>
          <Field id="pool-count" label="Results wanted (count)" hint={`Encoded in the link as n=. 1–${MAX_COUNT}.`}>
            <input
              id="pool-count"
              name="count"
              inputMode="numeric"
              autoComplete="off"
              className={`${input} tabular`}
              value={wanted}
              onChange={(e) => setWanted(parseCount(e.target.value))}
            />
          </Field>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 text-xs text-white/60" htmlFor="pool-case">
              <input
                id="pool-case"
                type="checkbox"
                checked={exactCase}
                onChange={(e) => setExactCase(e.target.checked)}
              />
              Match exact case
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={createPool}
            disabled={!hasPattern}
            title={hasPattern ? "Create the pool link and a reveal key for this tab" : "A pool needs at least one end of the pattern"}
          >
            {ready ? "Recreate pool link" : "Create pool link"}
          </Button>
          <span className="text-[11px] text-white/40">
            {hasPattern
              ? "Creating a new pool clears the results list below."
              : "Type a start or an end pattern first."}
          </span>
        </div>

        {ready ? (
          <div className="mt-4 rounded-md border border-white/10 bg-white/[0.015] p-3">
            <p className="text-xs font-medium text-white/70">Share this link with your team</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id="pool-link"
                aria-label="Pool link"
                readOnly
                spellCheck={false}
                className={`${monoInput} sm:min-w-0 sm:flex-1`}
                value={poolPath}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void copy(shareableLink(poolPath), "link")}
              >
                {copied === "link" ? "Copied" : "Copy link"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              The link carries the pattern, the case rule, the count and the pool id — nothing else. It
              points at a relative path, and Copy link writes the absolute URL for this deployment.
            </p>

            {revealKey ? (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-xs font-medium text-white/70">Reveal key (this tab only)</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    id="pool-reveal-key"
                    aria-label="Reveal key"
                    readOnly
                    spellCheck={false}
                    className={`${monoInput} sm:min-w-0 sm:flex-1`}
                    value={revealKey}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copy(revealKey, "key")}>
                    {copied === "key" ? "Copied" : "Copy key"}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  Shown once, held in this tab&apos;s state: reload and both the key and the results are
                  gone. It is not in the link, so send it separately if a teammate should be able to read
                  imported codes. Nothing is encrypted — the key masks addresses on screen, and they sit in
                  the page&apos;s state either way.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[11px] leading-relaxed text-white/40">
                This pool came from a link, so the reveal key belongs to whoever created it. Imported
                codes stay masked here until it is entered.
              </p>
            )}
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <SectionTitle>Contribute to a pool</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Open a pool link from your team lead, or paste it here.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field id="pool-load" label="Pool link" error={linkError}>
              <input
                id="pool-load"
                name="pool-link"
                autoComplete="off"
                spellCheck={false}
                className={monoInput}
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://…/pool?start=moon&n=3&id=…"
              />
            </Field>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => loadPool(linkInput)}>
            Load pool
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Loading a pool replaces the pattern and clears the results list — one pool at a time in this tab.
        </p>

        {ready ? (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-xs font-medium text-white/70">Add your result</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field id="contrib-who" label="Your name or handle">
                <input
                  id="contrib-who"
                  name="who"
                  autoComplete="off"
                  className={input}
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  placeholder="e.g. kai"
                />
              </Field>
              <Field id="contrib-address" label="Address you ground" hint="Whatever the grinder found: a mint or a wallet.">
                <input
                  id="contrib-address"
                  name="address"
                  autoComplete="off"
                  spellCheck={false}
                  className={monoInput}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="paste the address"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field id="contrib-note" label="Note (optional)" hint="Anything the lead should know — pattern hit, machine, when.">
                  <input
                    id="contrib-note"
                    name="note"
                    autoComplete="off"
                    className={input}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="hit the end pattern after 2 minutes on 8 threads"
                  />
                </Field>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={addContribution} disabled={address.trim() === ""} title={address.trim() === "" ? "Paste an address first" : "Add it to this tab's results"}>
                + Add my result
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Adding keeps the result in this tab. To hand it over, copy its result code from the list below
              — the code is plain text, in the form{" "}
              <span className="font-mono text-[11px]">contributor|address|note</span>.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/40">Create a pool above or load a link before contributing.</p>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle
          aside={
            <span className="tabular">
              {collected} / {wanted} collected
            </span>
          }
        >
          Results
        </SectionTitle>

        <div
          role="progressbar"
          aria-label="Results collected"
          aria-valuemin={0}
          aria-valuemax={wanted}
          aria-valuenow={Math.min(collected, wanted)}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
        >
          <div
            className={`h-full transition-[width] ${collected >= wanted ? "bg-emerald-400/70" : "bg-[#5e6ad2]"}`}
            style={{ width: `${collectedShare}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-white/40">
          {collected === 0
            ? "Nothing collected yet."
            : collected >= wanted
              ? `Target reached — ${collected} of ${wanted}.`
              : `${wanted - collected} more to reach the count in the link.`}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_auto] sm:items-end">
          <Field
            id="pool-reveal-input"
            label="Reveal key"
            hint={
              revealKey
                ? "Type or paste the key shown above to unmask imported results."
                : "Imported results stay masked until the pool creator's key is entered."
            }
          >
            <input
              id="pool-reveal-input"
              name="reveal"
              autoComplete="off"
              spellCheck={false}
              className={monoInput}
              value={revealInput}
              onChange={(e) => setRevealInput(e.target.value)}
              placeholder="paste the reveal key"
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRevealInput("")}
            disabled={revealInput === ""}
            title="Clear the key and mask the imported results again"
          >
            Hide again
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          {hidden > 0 ? `${hidden} of ${collected} masked. ` : collected > 0 ? "Nothing is masked. " : ""}
          Masking is presentational — the addresses are in this page&apos;s state either way, and the key is
          a local comparison, not cryptography.
        </p>

        <div className="mt-4">
          <Field
            id="pool-codes"
            label="Paste result codes (one per line)"
            hint="Format: contributor|address|note. Unreadable lines are reported back rather than dropped silently."
          >
            <textarea
              id="pool-codes"
              name="codes"
              rows={3}
              spellCheck={false}
              className={monoInput}
              value={codeText}
              onChange={(e) => setCodeText(e.target.value)}
              placeholder={"kai|Hf4G…9f2e|hit the end pattern on 8 threads"}
            />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={addCodes} disabled={codeText.trim() === ""}>
              Add codes
            </Button>
          </div>
        </div>

        {status ? (
          <p aria-live="polite" className="mt-3 text-[11px] leading-relaxed text-white/50">
            {status}
          </p>
        ) : null}

        {copyError ? (
          <div className="mt-3">
            <Alert tone="warn" title="Clipboard unavailable">
              {copyError}
            </Alert>
          </div>
        ) : null}

        {contributions.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No results yet">
              Add what your grinder found, or paste the codes your team sent back. Nothing is uploaded —
              this list lives in this tab.
            </EmptyState>
          </div>
        ) : (
          <ol className="mt-4 space-y-2">
            {contributions.map((c) => {
              const shown = c.mine || revealed;
              return (
                <li key={c.id} className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                      <span className="font-mono text-[11px]">{c.who}</span>
                      <Badge tone={c.mine ? "ok" : "neutral"}>{c.mine ? "yours" : "imported"}</Badge>
                      {shown ? null : <Badge tone="warn">masked</Badge>}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void copy(encodeContribution(c), c.id)}
                      >
                        {copied === c.id ? "Copied" : "Copy code"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeContribution(c.id)}
                        title={`Remove ${c.who}'s entry`}
                      >
                        Remove
                      </Button>
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] tabular text-white/75">
                    {shown ? c.address : maskAddress(c.address)}
                    {shown ? null : <span className="ml-2 text-white/35">ends only</span>}
                  </p>
                  {c.note ? <p className="mt-1 text-[11px] leading-relaxed text-white/40">{c.note}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
