"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { absoluteUrl } from "@/lib/links";
import { Alert, Badge, Button, Card, Field, SectionTitle, inputClass } from "@/components/ui";
import { MAX_SHAREHOLDERS, TOTAL_BPS, validateShares, type ShareSpec } from "@/lib/pump/fee-sharing";

/**
 * Creator rewards studio — the interactive half of /splits.
 *
 * The rules on this screen are NOT re-implemented here. Every complaint the user reads comes out of
 * `validateShares()` in src/lib/pump/fee-sharing.ts — the same function `buildFeeSharingTransactions()`
 * refuses to build a transaction without, which mirrors what `update_fee_shares_v2` enforces on-chain
 * (non-empty, <= 10 entries, no duplicates, every bps > 0, sum == 10_000). Two implementations of that
 * list would drift; there is one, and it is imported.
 *
 * The consequence, and the point of this screen: a total of exactly 100.00% is NEVER blessed on its
 * own. The tick and the emerald total appear only when `validateShares` returns zero issues, because a
 * wrong split is rejected by the program on chain — the UI must refuse to encourage one.
 *
 * The import drags the pump SDK + web3.js into this chunk. That is deliberate: nothing in that module
 * runs on load (its RPC and transaction builders only execute when called), and the alternative — a
 * hand-written copy of the rules in the browser — is exactly the bug this file exists to avoid.
 */

/** Row ids are React keys and input ids only. They are never exported and never sent anywhere. */
let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `r${rowSeq}`;
}

type Recipient = {
  id: string;
  address: string;
  label: string;
  /** The raw string the user typed, so the real validator can complain about "" and "abc" alike. */
  bps: string;
};

/** The documented starting state: one recipient holding all 10,000 bps, labelled "Dev" → "Dev · 100.00%". */
function blankRecipient(bps: string, label: string): Recipient {
  return { id: nextRowId(), address: "", label, bps };
}

/**
 * "" becomes 0 and "abc" becomes NaN on purpose: `validateShares` already has a message for each
 * ("every share must be greater than 0", "must be a whole number of basis points"). Coercing to a
 * number here is what lets those messages fire instead of a silent parse failure.
 */
function parseBps(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isNaN(n) ? NaN : n;
}

/* ------------------------------------------------------------------ share link */

/**
 * The export JSON is the share payload, so the link carries the payload itself: base64url of those
 * exact bytes in one `d` parameter, never a lookalike transcription of them. Opening the link decodes
 * `d`, rebuilds the rows and runs the same validator over them, so editing the JSON by hand produces
 * a visible, specific complaint instead of a quietly different split.
 */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  try {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** The exact object shape the fee-sharing call takes. */
type SharePayload = {
  mint: string | null;
  shareholders: { address: string; shareBps: number; label: string }[];
};

/**
 * Read a shared link back: /splits?d=<base64url of the export JSON>. Anything unreadable — a truncated
 * base64 string, valid base64 that is not JSON, JSON with no shareholders — falls through to the
 * documented starting state rather than throwing the page away.
 */
function readPayload(params: URLSearchParams): { mint: string; recipients: Recipient[] } {
  /** The documented starting state — one recipient holding all 10,000 bps. */
  const startState = (): { mint: string; recipients: Recipient[] } => ({
    mint: "",
    recipients: [blankRecipient(String(TOTAL_BPS), "Dev")],
  });

  const encoded = params.get("d");
  if (!encoded) {
    // A bare `?mint=` deep link (the /kit launch receipt links that way) is still honoured so the mint
    // it names lands in the JSON, but the shareholders are never guessed from a partial link.
    return { mint: params.get("mint")?.trim() ?? "", recipients: startState().recipients };
  }

  const json = fromBase64Url(encoded);
  if (!json) return startState();

  try {
    const parsed = JSON.parse(json) as SharePayload;
    const list = Array.isArray(parsed?.shareholders) ? parsed.shareholders : [];
    const recipients: Recipient[] = list.slice(0, MAX_SHAREHOLDERS).map((s) => ({
      id: nextRowId(),
      address: typeof s?.address === "string" ? s.address : "",
      bps: typeof s?.shareBps === "number" && Number.isFinite(s.shareBps) ? String(s.shareBps) : "",
      label: typeof s?.label === "string" ? s.label : "",
    }));
    if (recipients.length === 0) return startState();
    return { mint: typeof parsed.mint === "string" ? parsed.mint : "", recipients };
  } catch {
    return startState();
  }
}

/**
 * ui.tsx's inputClass carries `outline-none`, which sets `outline-style: none` — and the app's only
 * focus ring is the `:focus-visible { outline: 2px solid #828fff }` rule in globals.css, which lives in
 * the base layer. Utilities beat base, so the ring was invisible on every input in the app.
 * `focus-visible:outline-solid!` puts the style back from the utilities layer with !important, so the
 * ring survives regardless of the order Tailwind emits the two utilities in.
 */
const input = `${inputClass} focus-visible:outline-solid!`;
const monoInput = `${input} font-mono text-xs`;

export function SplitsStudio() {
  const params = useSearchParams();

  // Seeded once, from the query string, in a lazy initializer — never in an effect, so a shared link
  // is restored in the same render that first paints this subtree (and editing afterwards is not
  // fought by a re-seeding effect). A Suspense boundary above this component is what makes that
  // possible: with useSearchParams inside it, the subtree is client-rendered with the real params.
  const [seeded] = useState(() => readPayload(params));
  const [mint, setMint] = useState(seeded.mint);
  const [recipients, setRecipients] = useState<Recipient[]>(seeded.recipients);

  const [copied, setCopied] = useState<"json" | "link" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const specs: ShareSpec[] = useMemo(
    () => recipients.map((r) => ({ address: r.address.trim(), bps: parseBps(r.bps) })),
    [recipients],
  );

  /** THE validation. Ordering, wording and coverage all come from the shared module. */
  const issues = useMemo(() => validateShares(specs), [specs]);
  const valid = issues.length === 0;

  // Summed the same way the validator sums it (non-finite values contribute nothing), so the total and
  // the validator's own message can never disagree about the number.
  const sum = useMemo(
    () => specs.reduce((acc, s) => acc + (Number.isFinite(s.bps) ? s.bps : 0), 0),
    [specs],
  );
  const unknown = useMemo(() => specs.some((s) => !Number.isFinite(s.bps)), [specs]);
  const percent = (sum / TOTAL_BPS) * 100;
  const over = sum > TOTAL_BPS;
  /**
   * The single condition that earns the tick and the emerald total: the real validator returned
   * nothing. A 100.00% total with a duplicate wallet or an unparseable address is still refused.
   */
  const exact = valid && sum === TOTAL_BPS;

  /** Exactly the measured export shape: {"mint":null,"shareholders":[{"address":..,"shareBps":..,"label":..}]} */
  const exportJson = useMemo(
    () =>
      JSON.stringify(
        {
          mint: mint.trim() === "" ? null : mint.trim(),
          shareholders: recipients.map((r) => ({
            address: r.address.trim(),
            shareBps: parseBps(r.bps),
            label: r.label.trim(),
          })),
        },
        null,
        2,
      ),
    [mint, recipients],
  );

  const sharePath = useMemo(() => `/splits?d=${toBase64Url(exportJson)}`, [exportJson]);

  /** Absolute for sharing, relative when the deployment has no NEXT_PUBLIC_APP_URL (local dev). */
  function shareableLink(): string {
    const configured = absoluteUrl(sharePath);
    if (configured.startsWith("http")) return configured;
    return typeof window === "undefined" ? configured : new URL(sharePath, window.location.origin).toString();
  }

  /**
   * Mirrors src/app/dev/copy-button.tsx: the async clipboard API is only trusted on a secure origin,
   * and the real outcome is reported. Outside a secure context — or when the browser refuses — the
   * button says so and points at the selectable text instead of claiming a copy happened.
   */
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through — reported as a failure below
    }
    return false;
  }

  async function copy(text: string, what: "json" | "link") {
    setCopyError(null);
    const ok = await writeClipboard(text);
    if (ok) {
      setCopied(what);
    } else {
      setCopyError(
        what === "json"
          ? "This browser refused clipboard access. The JSON below is selectable — copy it by hand."
          : "This browser refused clipboard access. The link below is selectable — copy it by hand.",
      );
    }
  }

  function copyJson() {
    void copy(exportJson, "json");
  }

  function copyShareLink() {
    void copy(shareableLink(), "link");
  }

  function downloadJson() {
    const slug = mint.trim().replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 10) || "draft";
    const blob = new Blob([`${exportJson}\n`], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `fee-splits-${slug}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  function update(index: number, patch: Partial<Recipient>) {
    setRecipients((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setCopied(null);
  }

  function addRecipient() {
    setRecipients((rows) => {
      if (rows.length >= MAX_SHAREHOLDERS) return rows;
      // Hand the new row whatever budget is still unallocated (0 when the split already sums to
      // 10,000), so adding a recipient does not silently break the total on its own.
      const used = rows.reduce((acc, r) => acc + (Number.isFinite(parseBps(r.bps)) ? parseBps(r.bps) : 0), 0);
      return [...rows, blankRecipient(String(Math.max(0, TOTAL_BPS - used)), `Recipient ${rows.length + 1}`)];
    });
    setCopied(null);
  }

  function removeRecipient(index: number) {
    // The program rejects an empty shareholder list, so the last row cannot be removed.
    setRecipients((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
    setCopied(null);
  }

  /** Divides 10,000 exactly: the remainder goes to the first rows, never rounded away. */
  function splitEvenly() {
    setRecipients((rows) => {
      if (rows.length === 0) return rows;
      const base = Math.floor(TOTAL_BPS / rows.length);
      const remainder = TOTAL_BPS - base * rows.length;
      return rows.map((r, i) => ({ ...r, bps: String(base + (i < remainder ? 1 : 0)) }));
    });
    setCopied(null);
  }

  const issueAt = (index: number, field: string) =>
    issues.find((i) => i.index === index && i.field === field)?.message ?? null;

  const lockedHint = valid ? undefined : "Fix the issues above first — a split the program rejects cannot be exported or shared";

  const totalNote = exact
    ? "Exactly 10,000 bps and every rule passes — this is the split the program accepts."
    : unknown
      ? "A share is not a whole number yet, so the total cannot be totalled."
      : sum === TOTAL_BPS
        ? "The total is exactly 10,000 bps, but the split is still rejected — see the issues below."
        : over
          ? `${(sum - TOTAL_BPS).toLocaleString()} bps over 10,000 — take the difference off a share.`
          : `${(TOTAL_BPS - sum).toLocaleString()} bps unallocated — the program rejects a split that does not sum to exactly 10,000 bps.`;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <SectionTitle aside={`${recipients.length}/${MAX_SHAREHOLDERS} shareholders`}>Recipients</SectionTitle>

        <div className="mt-3">
          <Field
            id="split-mint"
            label="Mint address (optional)"
            hint="Carried into the JSON and the link exactly as typed. Nothing is sent from this page."
          >
            <input
              id="split-mint"
              name="mint"
              autoComplete="off"
              spellCheck={false}
              className={monoInput}
              value={mint}
              onChange={(e) => {
                setMint(e.target.value);
                setCopied(null);
              }}
              placeholder="empty exports as null"
            />
          </Field>
        </div>

        <ol className="mt-4 space-y-3">
          {recipients.map((r, index) => {
            const addressError = issueAt(index, "address");
            const bpsError = issueAt(index, "bps");
            const bps = parseBps(r.bps);
            const share = Number.isFinite(bps) ? `${((bps / TOTAL_BPS) * 100).toFixed(2)}%` : "—";
            return (
              <li key={r.id} className="rounded-md border border-white/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-white/40">
                    {r.label.trim() || `Recipient ${index + 1}`}
                    {" · "}
                    <span className="tabular text-white/60">{share}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRecipient(index)}
                    disabled={recipients.length <= 1}
                    title={
                      recipients.length <= 1
                        ? "A split needs at least one shareholder — the program rejects an empty list"
                        : `Remove recipient ${index + 1}`
                    }
                  >
                    Remove
                  </Button>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_6.5rem]">
                  <Field id={`s-addr-${r.id}`} label="Wallet address" error={addressError}>
                    <input
                      id={`s-addr-${r.id}`}
                      name={`address-${index}`}
                      autoComplete="off"
                      spellCheck={false}
                      className={monoInput}
                      value={r.address}
                      onChange={(e) => update(index, { address: e.target.value })}
                      aria-invalid={addressError !== null}
                      placeholder="base58 address"
                    />
                  </Field>
                  <Field id={`s-label-${r.id}`} label="Label">
                    <input
                      id={`s-label-${r.id}`}
                      name={`label-${index}`}
                      autoComplete="off"
                      maxLength={24}
                      className={input}
                      value={r.label}
                      onChange={(e) => update(index, { label: e.target.value })}
                      placeholder="Dev, Ops, treasury…"
                    />
                  </Field>
                  <Field id={`s-bps-${r.id}`} label="Share (bps)" error={bpsError}>
                    <input
                      id={`s-bps-${r.id}`}
                      name={`bps-${index}`}
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      className={`${input} tabular text-right`}
                      value={r.bps}
                      onChange={(e) => update(index, { bps: e.target.value })}
                      aria-invalid={bpsError !== null}
                      placeholder="2500"
                    />
                  </Field>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addRecipient}
            disabled={recipients.length >= MAX_SHAREHOLDERS}
            title={
              recipients.length >= MAX_SHAREHOLDERS
                ? `The program accepts at most ${MAX_SHAREHOLDERS} shareholders`
                : "Add a recipient"
            }
          >
            + Add recipient
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={splitEvenly}
            title={`Divide ${TOTAL_BPS.toLocaleString()} bps evenly across the rows`}
          >
            Split evenly
          </Button>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-white/50">Total</span>
            <span
              className={`tabular font-mono text-sm ${
                exact ? "text-emerald-300" : over && !unknown ? "text-red-300" : "text-amber-300"
              }`}
            >
              {unknown ? "—" : `${percent.toFixed(2)}%`}
              {exact ? " ✓" : ""}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Basis points allocated"
            aria-valuemin={0}
            aria-valuemax={TOTAL_BPS}
            aria-valuenow={Math.min(Math.max(sum, 0), TOTAL_BPS)}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className={`h-full transition-[width] ${
                exact ? "bg-emerald-400/70" : over && !unknown ? "bg-red-500/70" : "bg-amber-400/70"
              }`}
              style={{ width: `${unknown ? 0 : Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">{totalNote}</p>
        </div>

        <div className="mt-4">
          {issues.length > 0 ? (
            <Alert
              tone="error"
              title={`${issues.length} ${issues.length === 1 ? "issue" : "issues"} — export and sharing stay locked until fixed`}
            >
              <ul className="mt-1 space-y-0.5">
                {issues.map((issue, i) => (
                  <li key={`${issue.field}-${issue.index}-${i}`}>
                    <span className="font-mono text-[11px]">
                      {issue.index < 0 ? issue.field : `entry ${issue.index + 1} · ${issue.field}`}
                    </span>
                    {" — "}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="ok" title="Valid — the program will accept this split">
              Up to {MAX_SHAREHOLDERS} shareholders, every address parses, no duplicates, every share
              above zero, and the total is exactly {TOTAL_BPS.toLocaleString()} bps.
            </Alert>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle aside={<Badge tone={valid ? "ok" : "warn"}>{valid ? "ready" : "blocked"}</Badge>}>
          Export
        </SectionTitle>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={copyJson} disabled={!valid} title={lockedHint}>
            {copied === "json" ? "Copied ✓" : "Copy JSON"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={copyShareLink} disabled={!valid} title={lockedHint}>
            {copied === "link" ? "Copied ✓" : "Copy share link"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={downloadJson} disabled={!valid} title={lockedHint}>
            Download JSON
          </Button>
        </div>

        {copyError ? (
          <div className="mt-3">
            <Alert tone="warn" title="Clipboard unavailable">
              {copyError}
            </Alert>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-white/40">Exactly the object the fee-sharing call takes:</p>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/70">
          {exportJson}
        </pre>

        <div className="mt-4">
          <Field
            id="split-link"
            label="Share link"
            hint={
              valid
                ? "The link is this exact payload, base64url-encoded — opening it rebuilds these rows and re-runs the same validation."
                : "Sharing is locked until the split is valid — this is the link it would carry."
            }
          >
            <input
              id="split-link"
              readOnly
              spellCheck={false}
              className={monoInput}
              value={sharePath}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}
