"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Card, Field, LinkButton, SectionTitle, inputClass } from "@/components/ui";
import { METADATA_LIMITS, validateLaunchInput } from "@/lib/pump/create";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * Launch Kit — fill the coin in once and get the exact object that gets pinned, plus a checklist
 * wired to the tab that does each remaining step.
 *
 * Two rules this tab keeps:
 *  - the byte counters are the program's own limits, imported from the launch code
 *    (`METADATA_LIMITS` / `validateLaunchInput`) rather than typed in again here, so this tab can
 *    never drift from what the create instruction will actually accept;
 *  - the JSON below is the metadata object and nothing else — no invented fields, no `any`.
 */

/** The program counts bytes, not JS characters — a name with an emoji in it is longer than it looks. */
function byteLen(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The pin route requires a fetchable URL; `new URL` in a try/catch is the same check it makes. */
function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "ipfs:";
  } catch {
    return false;
  }
}

/** Exactly the object the pin route writes to IPFS (field for field, optionals only when filled). */
type TokenMetadata = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

function UrlField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const bad = value.trim() !== "" && !looksLikeUrl(value);
  return (
    <Field id={id} label={label} hint={hint} error={bad ? "must be an http(s) or ipfs URL" : null}>
      <input
        id={id}
        name={id.replace("kit-", "")}
        className={inputClass}
        autoComplete="off"
        spellCheck={false}
        inputMode="url"
        aria-invalid={bad}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function KitClient() {
  const { connected } = useWallet();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [uri, setUri] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  // Two checklist items cannot be derived here — whether a vanity mint exists and whether the fee
  // split is settled both happen in other tabs — so they are local, user-ticked state.
  const [mintGround, setMintGround] = useState(false);
  const [splitDecided, setSplitDecided] = useState(false);

  /**
   * The real validator from the launch path, run over the fields this tab owns. Issues for
   * mint/creator/user are dropped (those are the launch tab's to supply), and "required" is dropped
   * so an untouched form is not dressed up as broken — an empty field simply has no message yet.
   */
  const issues = useMemo(() => validateLaunchInput({ name, symbol, uri }), [name, symbol, uri]);
  const issueFor = (field: "name" | "symbol" | "uri"): string | null =>
    issues.find((i) => i.field === field && i.message !== "required")?.message ?? null;

  const nameIssue = issueFor("name");
  const symbolIssue = issueFor("symbol");
  const uriIssue = issueFor("uri");

  /**
   * The validator names the limit; the task is to name the overage too — "3 over" is the number that
   * tells someone how much to cut, and it is the one the message does not carry on its own.
   */
  const withOverage = (issue: string | null, value: string, limit: number): string | null => {
    if (issue === null) return null;
    const over = byteLen(value) - limit;
    return over > 0 ? `${issue} — ${over} over` : issue;
  };
  const nameError = withOverage(nameIssue, name, METADATA_LIMITS.name);
  const symbolError = withOverage(symbolIssue, symbol, METADATA_LIMITS.symbol);
  const uriError = withOverage(uriIssue, uri, METADATA_LIMITS.uri);

  const metadata = useMemo<TokenMetadata>(
    () => ({
      name,
      symbol,
      description,
      image,
      ...(twitter.trim() ? { twitter: twitter.trim() } : {}),
      ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
      ...(website.trim() ? { website: website.trim() } : {}),
    }),
    [name, symbol, description, image, twitter, telegram, website],
  );

  const json = useMemo(() => JSON.stringify(metadata, null, 2), [metadata]);

  const imageValid = image.trim() !== "" && looksLikeUrl(image);
  const metadataValid =
    name.trim() !== "" &&
    symbol.trim() !== "" &&
    nameIssue === null &&
    symbolIssue === null &&
    imageValid &&
    (twitter.trim() === "" || looksLikeUrl(twitter)) &&
    (telegram.trim() === "" || looksLikeUrl(telegram)) &&
    (website.trim() === "" || looksLikeUrl(website)) &&
    (uri.trim() === "" || uriIssue === null);

  // The export is only blocked by the program's own limits plus the two fields the pin route
  // requires — everything else can be filled in after the file is written.
  const exportable = name.trim() !== "" && symbol.trim() !== "" && nameIssue === null && symbolIssue === null;
  const exportBlocked = !exportable;

  const sendEnabled = process.env.NEXT_PUBLIC_ENABLE_SEND === "true";

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied("ok");
    } catch {
      // Say it failed rather than pretending: clipboard access needs a secure context and permission.
      setCopied("failed");
    }
    window.setTimeout(() => setCopied("idle"), 2500);
  }

  function downloadJson() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const slug = symbol.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "token";
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-metadata.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download in some browsers; give it a beat.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const checklist: {
    key: string;
    label: string;
    done: boolean;
    href: string;
    note: string;
    manual?: boolean;
  }[] = [
    {
      key: "metadata",
      label: "Metadata valid",
      done: metadataValid,
      href: "#kit-metadata",
      note: metadataValid
        ? `name and ticker are inside the program's byte limits and the image is a fetchable URL.`
        : "Finish the fields above: they are measured against the same limits the create instruction enforces.",
    },
    {
      key: "mint",
      label: "Vanity mint ground",
      manual: true,
      done: mintGround,
      href: "/grinder",
      note: "A ground mint is what makes the address recognisable — and what makes a copycat cheap to spot, because holders can compare both ends of the CA.",
    },
    {
      key: "splits",
      label: "Fee split decided",
      manual: true,
      done: splitDecided,
      href: "/splits",
      note: "Up to 10 shareholders, basis points summing to 10,000. This platform's default is 70% creator / 30% platform, written on chain and permanent once set.",
    },
    {
      key: "wallet",
      label: "Wallet connected",
      done: connected,
      href: "/launch",
      note: connected
        ? "A wallet is connected in the header; the launch tab has a signer."
        : "Connect from the header wallet button — the launch tab cannot sign without one.",
    },
    {
      key: "send",
      label: "Sending consciously enabled",
      done: sendEnabled,
      href: "/settings",
      note: sendEnabled
        ? "NEXT_PUBLIC_ENABLE_SEND=true in this environment: a prepared launch will actually submit."
        : "This build prepares and simulates only. Nothing can be submitted until the environment switches sending on — which is the safe default.",
    },
  ];

  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <div className="mt-6 space-y-3">
      {/* ------------------------------------------------------- metadata builder */}
      <Card className="p-4" id="kit-metadata">
        <SectionTitle aside={`limits from the program: name ${METADATA_LIMITS.name} · ticker ${METADATA_LIMITS.symbol} · uri ${METADATA_LIMITS.uri} bytes`}>
          Token metadata
        </SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          Byte counters below come from the launch code itself, so they cannot disagree with what the
          create instruction accepts. A ticker with an emoji or an accent is longer than it looks.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            id="kit-name"
            label={`Name (max ${METADATA_LIMITS.name} bytes)`}
            hint={`${byteLen(name)} / ${METADATA_LIMITS.name} bytes`}
            error={nameError}
          >
            <input
              id="kit-name"
              name="name"
              className={inputClass}
              autoComplete="off"
              aria-invalid={nameIssue !== null}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field
            id="kit-symbol"
            label={`Ticker (max ${METADATA_LIMITS.symbol} bytes)`}
            hint={`${byteLen(symbol)} / ${METADATA_LIMITS.symbol} bytes`}
            error={symbolError}
          >
            <input
              id="kit-symbol"
              name="symbol"
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={symbolIssue !== null}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              id="kit-description"
              label="Description"
              hint="Plain text. The pin step trims it and enforces its own cap; the program does not limit this field."
            >
              <textarea
                id="kit-description"
                name="description"
                className={inputClass}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <UrlField
              id="kit-image"
              label="Image URL (after upload)"
              hint="Required by the pin step, which fetches this URL and re-hosts the image on IPFS — so it must be a link a server can read, not a file on your disk."
              value={image}
              onChange={setImage}
            />
          </div>

          <UrlField
            id="kit-twitter"
            label="X / Twitter (optional)"
            hint="Left empty, the field is left out of the JSON entirely."
            value={twitter}
            onChange={setTwitter}
          />
          <UrlField
            id="kit-telegram"
            label="Telegram (optional)"
            hint="Left empty, the field is left out of the JSON entirely."
            value={telegram}
            onChange={setTelegram}
          />
          <UrlField
            id="kit-website"
            label="Website (optional)"
            hint="Left empty, the field is left out of the JSON entirely."
            value={website}
            onChange={setWebsite}
          />

          <div className="sm:col-span-2">
            <Field
              id="kit-uri"
              label={`Metadata URI (optional, max ${METADATA_LIMITS.uri} bytes)`}
              hint={`${byteLen(uri)} / ${METADATA_LIMITS.uri} bytes · the ipfs:// or https:// URI that goes into the create as its \`uri\` — this one is not part of the JSON below.`}
              error={uriError}
            >
              <input
                id="kit-uri"
                name="uri"
                className={`${inputClass} font-mono text-xs`}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={uriIssue !== null}
                placeholder="ipfs://… or https://gateway…/ipfs/…"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------ JSON preview */}
      <Card className="p-4">
        <SectionTitle aside={`${byteLen(json)} bytes`}>Metadata file</SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          This is the object that gets pinned — nothing added, nothing hidden. Optional fields appear
          only when they have a value, so an empty one is not written as a blank string.
        </p>

        <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-white/10 bg-white/[0.015] p-3 font-mono text-xs leading-relaxed text-white/70">
          {json}
        </pre>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={copyJson}
            disabled={exportBlocked}
            title={exportBlocked ? "Needs a name and a ticker inside the byte limits" : "Copy the JSON to the clipboard"}
          >
            {copied === "ok" ? "Copied" : "Copy JSON"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={downloadJson}
            disabled={exportBlocked}
            title={exportBlocked ? "Needs a name and a ticker inside the byte limits" : "Download as a .json file"}
          >
            Download .json
          </Button>
          <span aria-live="polite" className="text-[11px] text-white/40">
            {exportBlocked
              ? "A name and a ticker are required before this can be exported."
              : copied === "ok"
                ? "Copied to the clipboard."
                : copied === "failed"
                  ? "Copying was blocked by the browser — select the JSON above and copy it manually."
                  : ""}
          </span>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          The file name follows the ticker ({symbol.trim() ? `${symbol.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "token"}-metadata.json` : "token-metadata.json"}).
          Upload it to IPFS (or a pinning service) and use its URI at launch; the pin step in this app
          does both the image and this file, and also writes <code className="font-mono">showName: true</code>{" "}
          alongside these fields.
        </p>
      </Card>

      {/* ----------------------------------------------------------------- checklist */}
      <Card className="p-4" id="kit-checklist">
        <SectionTitle aside={`${doneCount}/${checklist.length} done`}>Checklist</SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          Three of these this page can see for itself (metadata, wallet, the send gate). The other two
          happen in their own tabs, so they are yours to tick.
        </p>

        <ul className="mt-3">
          {checklist.map((item) => (
            <li key={item.key} className="flex items-start gap-3 border-t border-white/10 py-3 first:border-t-0">
              {item.manual ? (
                <input
                  id={`kit-check-${item.key}`}
                  name={`check-${item.key}`}
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) => (item.key === "mint" ? setMintGround(e.target.checked) : setSplitDecided(e.target.checked))}
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[#5e6ad2] transition-colors hover:accent-[#4f59b8] active:accent-[#4650a8]"
                />
              ) : (
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                    item.done
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-white/20 text-white/30"
                  }`}
                >
                  {item.done ? "✓" : "○"}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  {item.manual ? (
                    <label htmlFor={`kit-check-${item.key}`} className="text-sm">
                      {item.label}
                    </label>
                  ) : (
                    <span className="text-sm">
                      {item.label}
                      <span className="sr-only">{item.done ? " — done" : " — not done yet"}</span>
                    </span>
                  )}
                  <LinkButton href={item.href} size="sm" variant="ghost">
                    open →
                  </LinkButton>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-white/40">{item.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* --------------------------------------------------------------- call to action */}
      <Card className="p-4">
        <SectionTitle aside="the ticket is the metadata URI">Ready to launch?</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          The launch tab takes this coin the rest of the way: it pins the image and this metadata file,
          builds the create against the real pump.fun program, simulates it, and only then asks for a
          signature. Come back here if a field turns red — the byte counts above are the same ones the
          create instruction applies.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <LinkButton href="/launch" variant="primary" size="md">
            Open the launch tab →
          </LinkButton>
          <LinkButton href="/lab" variant="secondary" size="md">
            Simulate it in the Launch Lab
          </LinkButton>
        </div>
        {sendEnabled ? (
          <div className="mt-3">
            <Alert tone="warn" title="Sending is enabled in this environment">
              A prepared launch will actually submit and spend real SOL. Check the mint, the fee split
              and the dev buy once more before you sign.
            </Alert>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
