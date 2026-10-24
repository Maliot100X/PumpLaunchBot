"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  LinkButton,
  SectionTitle,
  inputClass,
} from "@/components/ui";
import { METADATA_LIMITS, validateLaunchInput } from "@/lib/pump/create";
import { tokenLinks } from "@/lib/links";
import { CopyButton } from "./copy";

/**
 * Launch Kit — fill the coin in once and this tab emits three things from the same fields:
 * the metadata file (the pump.fun shape src/lib/pinata.ts pins), a template launch thread, and a
 * nine-item checklist wired to the tab that does each remaining step.
 *
 * The rule this tab is built around — every tick has to come from state this page can actually
 * read, and where there is none it says so:
 *   - nothing in this app writes localStorage, sessionStorage or a cookie (measured: no such call
 *     exists in src/), so most of the checklist is genuinely invisible from here. Those items carry
 *     "not tracked here" and a link — never a checkbox that ticks itself into a lie.
 *   - two items DO have real state: item 8/9 tick from the platform's own launch registry
 *     (GET /api/registry), which is written only after a launch confirms, and item 7 ticks from
 *     fetching the pinned metadata URI back through the browser and comparing it with this coin.
 *   - the byte counters are the program's own limits, imported from the launch code
 *     (METADATA_LIMITS / validateLaunchInput), so this tab cannot drift from what create_v2 accepts.
 */

/* ---------------------------------------------------------------------------- helpers */

/** The program counts bytes, not JS characters — a name with an emoji in it is longer than it looks. */
function byteLen(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** X counts code points, so an emoji is one character there and two UTF-16 units in JS. */
function charCount(value: string): number {
  return Array.from(value).length;
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

/** Same validation the launch path applies to a mint: a base58 public key that round-trips. */
function addressIssue(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  try {
    if (new PublicKey(v).toBase58() !== v) return "not a valid base58 Solana address";
    return null;
  } catch {
    return "not a valid base58 Solana address";
  }
}

function isAddress(value: string): boolean {
  return value.trim() !== "" && addressIssue(value) === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** ipfs://<cid>, a bare CID and an http(s) URL all become something fetchable. */
function pinReadUrl(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (v.startsWith("ipfs://")) {
    const path = v.slice("ipfs://".length).replace(/^ipfs\//, "");
    return path ? `https://gateway.pinata.cloud/ipfs/${path}` : null;
  }
  // A bare CID: v0 (base58, Qm…) or v1 (base32, b…).
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(v)) {
    return `https://gateway.pinata.cloud/ipfs/${v}`;
  }
  try {
    const parsed = new URL(v);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------- shapes */

/** Exactly the object the pin route writes to IPFS, field for field (see src/lib/pinata.ts). */
type TokenMetadata = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

type RegistryRecord = {
  mint: string;
  name: string;
  symbol: string;
  mode: string;
  metadataUri: string;
  signatures: string[];
  createdAt: number;
};

type RegistryState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "unconfigured"; detail: string }
  | { phase: "error"; detail: string }
  | { phase: "ok"; total: number; count: number; match: RegistryRecord | null };

type PinCheck =
  | { phase: "idle" }
  | { phase: "checking"; readUrl: string }
  | { phase: "unreadable"; readUrl: string; detail: string }
  | { phase: "not-json"; readUrl: string; status: number; detail: string }
  | {
      phase: "read";
      readUrl: string;
      status: number;
      bytes: number;
      keys: string[];
      name: string | null;
      symbol: string | null;
      showName: boolean;
    };

type ItemState = "done" | "open" | "idle" | "untracked";

type CheckItem = {
  key: string;
  n: number;
  label: string;
  /** Where this step actually happens. `null` for the one item this page checks itself. */
  href: string | null;
  openLabel: string;
  state: ItemState;
  stateLabel: string;
  note: string;
};

function parseLaunchRecord(value: unknown): RegistryRecord | null {
  if (!isRecord(value)) return null;
  const mint = asString(value.mint);
  if (!mint) return null;
  return {
    mint,
    name: asString(value.name) ?? "",
    symbol: asString(value.symbol) ?? "",
    mode: asString(value.mode) ?? "",
    metadataUri: asString(value.metadataUri) ?? "",
    signatures: Array.isArray(value.signatures)
      ? value.signatures.filter((s): s is string => typeof s === "string")
      : [],
    createdAt: asNumber(value.createdAt) ?? 0,
  };
}

/** A state chip. "not tracked here" is deliberately not a tick and not an amber warning. */
function StateChip({ state, label }: { state: ItemState; label: string }) {
  if (state === "done") return <Badge tone="ok">{label}</Badge>;
  if (state === "open") return <Badge tone="warn">{label}</Badge>;
  return <span className="font-mono text-[11px] text-white/35">{label}</span>;
}

/** A URL field with the pin route's own validation (http(s) or ipfs, fetchable). */
function UrlField({
  id,
  label,
  hint,
  value,
  onChange,
  className = "",
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const bad = value.trim() !== "" && !looksLikeUrl(value);
  return (
    <div className={className}>
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
    </div>
  );
}

/* ---------------------------------------------------------------------------- component */

export function KitClient() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [ca, setCa] = useState("");
  const [devBuy, setDevBuy] = useState("");

  const [pinUri, setPinUri] = useState("");
  const [pin, setPin] = useState<PinCheck>({ phase: "idle" });
  const [registry, setRegistry] = useState<RegistryState>({ phase: "idle" });
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

  const sendEnabled = process.env.NEXT_PUBLIC_ENABLE_SEND === "true";

  /* --- validation: the launch path's own validator over the fields this tab owns --- */

  const issues = useMemo(() => validateLaunchInput({ name, symbol }), [name, symbol]);
  const issueFor = (field: "name" | "symbol"): string | null =>
    issues.find((i) => i.field === field && i.message !== "required")?.message ?? null;

  /** Name the overage too: "3 over" is the number that tells someone how much to cut. */
  const withOverage = (issue: string | null, value: string, limit: number): string | null => {
    if (issue === null) return null;
    const over = byteLen(value) - limit;
    return over > 0 ? `${issue} — ${over} over` : issue;
  };

  const nameIssue = issueFor("name");
  const symbolIssue = issueFor("symbol");
  const nameError = withOverage(nameIssue, name, METADATA_LIMITS.name);
  const symbolError = withOverage(symbolIssue, symbol, METADATA_LIMITS.symbol);

  const caError = addressIssue(ca);
  const caOk = isAddress(ca);
  const trimmedCa = ca.trim();

  const devBuyError = useMemo(() => {
    const v = devBuy.trim();
    if (v === "") return null;
    return Number.isFinite(Number(v)) && Number(v) >= 0 ? null : "must be a number of SOL (0 or more)";
  }, [devBuy]);

  /* ------------------------------------------------------------------ metadata file */

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
  // The file is useless without the two fields create_v2 measures; the rest can be filled in later.
  const metadataReady = name.trim() !== "" && symbol.trim() !== "" && nameIssue === null && symbolIssue === null;
  const slug = symbol.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "token";
  const filename = `${slug}-metadata.json`;

  function downloadJson() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download in some browsers; give it a beat.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    // A click cannot report what the browser did with the file — so the note says what was asked.
    setDownloadNote(`the browser was asked to save ${filename}`);
  }

  /* ------------------------------------------------------------------- launch thread */

  const thread = useMemo(() => {
    const nm = name.trim();
    const sym = symbol.trim();
    const desc = description.trim();
    const buy = devBuy.trim();
    const posts: { key: string; label: string; body: string }[] = [];
    const skipped: string[] = [];

    if (nm !== "" && sym !== "") {
      posts.push({
        key: "hook",
        label: "1 · the hook",
        body: [desc !== "" ? `${nm} ($${sym})\n\n${desc}` : `${nm} ($${sym})`, "launching on pump.fun"].join(
          "\n\n",
        ),
      });
      if (desc === "") {
        skipped.push(
          "the pitch line in the hook — there is no description in the Kit yet, so the post is the name, the ticker and the pump.fun line.",
        );
      }
    } else {
      skipped.push("the hook — it needs a name and a ticker from the fields above.");
    }

    if (trimmedCa !== "" && caOk) {
      posts.push({
        key: "ca",
        label: "2 · the contract address",
        body: [`$${sym || "…"} launched`, `CA: ${trimmedCa}`, ...(buy !== "" ? [`dev buy: ${buy} SOL`] : [])].join(
          "\n",
        ),
      });
      posts.push({
        key: "verify",
        label: "3 · the verification line",
        body: [
          `The only official CA is ${trimmedCa} — it ends in "${trimmedCa.slice(-4)}". Anything else with the ticker $${sym || "…"} is a copy.`,
          tokenLinks(trimmedCa).pumpFun,
        ].join("\n\n"),
      });
    } else {
      skipped.push(
        "the CA post and the verification line — there is no valid contract address yet, so no address and no coin link are written (no placeholder stands in for one).",
      );
    }

    const socials = [
      website.trim() !== "" ? `site · ${website.trim()}` : null,
      twitter.trim() !== "" ? `x · ${twitter.trim()}` : null,
      telegram.trim() !== "" ? `tg · ${telegram.trim()}` : null,
    ].filter((line): line is string => line !== null);

    if (socials.length > 0) {
      posts.push({ key: "links", label: "4 · the links", body: socials.join("\n") });
    } else {
      skipped.push("the links post — no website, X or Telegram is filled in.");
    }

    // Renumber so the labels match what is actually there (a skipped post leaves no gap).
    const numbered = posts.map((p, i) => ({ ...p, label: `${i + 1} · ${p.label.split("· ")[1] ?? p.label}` }));
    return { posts: numbered, skipped, joined: numbered.map((p) => p.body).join("\n\n") };
  }, [name, symbol, description, devBuy, trimmedCa, caOk, website, twitter, telegram]);

  /* ------------------------------------------------------- real state: launch registry */

  const runRegistryCheck = useCallback(async () => {
    setRegistry({ phase: "checking" });
    try {
      const res = await fetch("/api/registry?limit=200", { cache: "no-store" });
      const body: unknown = await res.json();
      if (!isRecord(body)) {
        setRegistry({ phase: "error", detail: `the registry answered ${res.status} with something that is not an object` });
        return;
      }
      if (body.configured === false) {
        setRegistry({
          phase: "unconfigured",
          detail: asString(body.error) ?? "UPSTASH_REDIS_REST_URL / TOKEN are not set",
        });
        return;
      }
      if (!res.ok) {
        setRegistry({
          phase: "error",
          detail: `the registry answered ${res.status}${asString(body.error) ? `: ${asString(body.error)}` : ""}`,
        });
        return;
      }
      const launches = Array.isArray(body.launches)
        ? body.launches.map(parseLaunchRecord).filter((l): l is RegistryRecord => l !== null)
        : [];
      const wanted = ca.trim();
      setRegistry({
        phase: "ok",
        total: asNumber(body.total) ?? launches.length,
        count: asNumber(body.count) ?? launches.length,
        match: wanted === "" ? null : launches.find((l) => l.mint === wanted) ?? null,
      });
    } catch (err) {
      setRegistry({ phase: "error", detail: err instanceof Error ? err.message : "the request failed" });
    }
  }, [ca]);

  // When a valid address is typed, read the registry once (debounced) — the two registry-backed
  // items then reflect the platform's own record instead of asking for a manual tick.
  useEffect(() => {
    if (!isAddress(ca)) return;
    const id = window.setTimeout(() => {
      void runRegistryCheck();
    }, 600);
    return () => window.clearTimeout(id);
  }, [ca, runRegistryCheck]);

  /* ------------------------------------------------- real state: read the pin back */

  const runPinCheck = useCallback(async () => {
    const readUrl = pinReadUrl(pinUri);
    if (readUrl === null) {
      setPin({
        phase: "unreadable",
        readUrl: pinUri.trim(),
        detail: "that is not an http(s) URL, an ipfs:// URI or a CID, so there is nothing to fetch",
      });
      return;
    }
    setPin({ phase: "checking", readUrl });
    try {
      const res = await fetch(readUrl, { cache: "no-store" });
      const text = await res.text();
      const bytes = byteLen(text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setPin({
          phase: "not-json",
          readUrl,
          status: res.status,
          detail: `${text.slice(0, 80).replace(/\s+/g, " ")}…`,
        });
        return;
      }
      if (!isRecord(parsed)) {
        setPin({ phase: "not-json", readUrl, status: res.status, detail: "the response parsed as JSON but is not an object" });
        return;
      }
      setPin({
        phase: "read",
        readUrl,
        status: res.status,
        bytes,
        keys: Object.keys(parsed),
        name: asString(parsed.name),
        symbol: asString(parsed.symbol),
        showName: parsed.showName === true,
      });
    } catch (err) {
      setPin({
        phase: "unreadable",
        readUrl,
        detail: err instanceof Error ? err.message : "the request failed",
      });
    }
  }, [pinUri]);

  const pinMatches =
    pin.phase === "read" &&
    pin.name === name.trim() &&
    pin.symbol === symbol.trim() &&
    pin.name !== null &&
    pin.symbol !== null;

  /* ---------------------------------------------------------------------- checklist */

  const registryMatch = registry.phase === "ok" ? registry.match : null;

  const registryOutcome: { state: ItemState; label: string } = (() => {
    if (registry.phase === "ok" && registryMatch) {
      return {
        state: "done",
        label: registryMatch.mode === "sponsored" ? "recorded · treasury paid" : "recorded · a wallet sent it",
      };
    }
    if (registry.phase === "ok") return { state: "open", label: "not in the registry yet" };
    if (registry.phase === "unconfigured" || registry.phase === "error") {
      return { state: "untracked", label: "not tracked here" };
    }
    return { state: "idle", label: "not checked yet" };
  })();

  const pinOutcome: { state: ItemState; label: string } = (() => {
    if (pin.phase === "read" && pin.status < 400) {
      return pinMatches
        ? { state: "done", label: "read back · matches this coin" }
        : { state: "open", label: "read back · does not match" };
    }
    if (pin.phase === "read") return { state: "open", label: `read back · HTTP ${pin.status}` };
    if (pin.phase === "not-json") return { state: "open", label: `read back · not JSON (HTTP ${pin.status})` };
    if (pin.phase === "unreadable") return { state: "untracked", label: "not verified here" };
    if (pin.phase === "checking") return { state: "idle", label: "reading…" };
    return { state: "idle", label: "not checked yet" };
  })();

  const shieldHref = caOk ? `/shield?mint=${trimmedCa}` : "/shield";
  const splitsHref = caOk ? `/splits?mint=${trimmedCa}` : "/splits";

  const items: CheckItem[] = [
    {
      key: "grind",
      n: 1,
      label: "Grind your CA",
      href: "/grinder",
      openLabel: "open /grinder",
      state: "untracked",
      stateLabel: "not tracked here",
      note:
        caOk
          ? `The Contract address field holds ${trimmedCa.slice(0, 4)}…${trimmedCa.slice(-4)} — this page can see that it is filled and valid, but not that the Grinder produced it: that tab generates the keypair in its own memory and stores nothing.`
          : "The Grinder generates its keypair in that tab's memory and stores nothing — no localStorage, no cookie, no server record — so this page cannot see whether you ground an address, and it cannot prefill the field either.",
    },
    {
      key: "shield",
      n: 2,
      label: "Check your Vamp Shield score",
      href: shieldHref,
      openLabel: "open /shield",
      state: "untracked",
      stateLabel: "not tracked here",
      note: caOk
        ? "The link carries this kit's contract address as ?mint=, which is the field the Shield tab reads. The score is computed there from the address you give it and nothing is written back, so this page cannot tick it."
        : "The score is computed in the Shield tab and nothing is written back, so this page cannot tick it. The link picks up the contract address above as soon as there is a valid one.",
    },
    {
      key: "key",
      n: 3,
      label: "Back up the mint key (Vault or offline file)",
      href: "/vault",
      openLabel: "open /vault",
      state: "untracked",
      stateLabel: "not tracked here",
      note: "The Vault holds the platform's treasury key server-side and never shows a private key; the mint key you ground lives only in the Grinder tab. Whether you saved it is not recorded anywhere this page can read.",
    },
    {
      key: "simulate",
      n: 4,
      label: "Simulate your dev buy and wallets",
      href: "/lab",
      openLabel: "open /lab",
      state: "untracked",
      stateLabel: "not tracked here",
      note:
        devBuyError === null && devBuy.trim() !== ""
          ? `The Launch Lab is client-side arithmetic on the bonding curve and writes nothing down, so there is no result here to read. The dev buy above (${devBuy.trim()} SOL) is not handed to it — type it there.`
          : "The Launch Lab is client-side arithmetic on the bonding curve and writes nothing down, so there is no result here to read.",
    },
    {
      key: "splits",
      n: 5,
      label: "Set creator-fee splits",
      href: splitsHref,
      openLabel: "open /splits",
      state: "untracked",
      stateLabel: "not tracked here",
      note: caOk
        ? "The link carries ?mint=, which the Splits tab reads. The split is validated there to 10,000 bps and written on chain at launch — it is not stored in this browser, so this page cannot tick it."
        : "The Splits tab validates the split to 10,000 bps and it is written on chain at launch — not stored in this browser, so this page cannot tick it. The link carries the contract address above once there is a valid one.",
    },
    {
      key: "pin",
      n: 6,
      label: "Pin the metadata",
      href: "/launch",
      openLabel: "open /launch",
      state: "untracked",
      stateLabel: "not tracked here",
      note: "The pin runs on the Launch tab, which prints the resulting URI in its build log and keeps no record this page can read. Paste that URI into item 7 below and the pin gets checked here for real.",
    },
    {
      key: "pincheck",
      n: 7,
      label: "Check the pin landed",
      href: null,
      openLabel: "",
      state: pinOutcome.state,
      stateLabel: pinOutcome.label,
      note: pinMatches
        ? "The JSON at that URI came back through this browser and its name and ticker are this coin's — the pin landed."
        : "Paste the metadata URI from the Launch tab's build log and press check: this page fetches it back through your browser, and the tick only appears if the pinned JSON comes back with this coin's name and ticker.",
    },
    {
      key: "launch",
      n: 8,
      label: "Launch or hand over to the platform treasury",
      href: "/launch",
      openLabel: "open /launch",
      state: registryOutcome.state,
      stateLabel: registryOutcome.label,
      note: registryMatch
        ? `The launch registry has this mint: ${registryMatch.name || "—"} ($${registryMatch.symbol || "—"}), ${
            registryMatch.mode === "sponsored" ? "sponsored by the treasury" : "sent from a wallet"
          }, ${registryMatch.signatures.length} signature(s) on file. A record is only written after a transaction confirms, so that is a launch that really went out.`
        : "The registry is written by the launch path only after a transaction confirms — a planned launch is never recorded. Press check the board to read it.",
    },
    {
      key: "board",
      n: 9,
      label: "Import it on our own board",
      href: "/launchlab",
      openLabel: "open /launchlab",
      state: registryOutcome.state,
      stateLabel: registryOutcome.label,
      note: registryMatch
        ? "The board at /launchlab renders exactly what the registry holds, so this mint is on it — with its fee split and its live market data."
        : "The board renders exactly what the registry holds, so the same record that answers item 8 answers this one: it is on the board when it was recorded there.",
    },
  ];

  const doneCount = items.filter((i) => i.state === "done").length;

  const registryLine = (() => {
    switch (registry.phase) {
      case "idle":
        return "not read yet — this asks /api/registry for the newest 200 records";
      case "checking":
        return "reading /api/registry…";
      case "unconfigured":
        return `the registry is not configured in this environment (${registry.detail})`;
      case "error":
        return `the registry read failed (${registry.detail})`;
      case "ok":
        return `${registry.count} of ${registry.total} record(s) read (newest first)`;
    }
  })();

  return (
    <div className="mt-6 space-y-3">
      {/* ------------------------------------------------------------------ your coin */}

      <Card className="p-4" id="kit-coin">
        <SectionTitle aside={`${byteLen(json)} bytes of metadata so far`}>Your coin</SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          Fill it in once: the metadata file, the launch thread and the checklist links below are all
          built from these fields. Template-based and local — no model, no network call, nothing leaves
          this page until you copy or download it.
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
            id="kit-ticker"
            label={`Ticker (max ${METADATA_LIMITS.symbol} bytes)`}
            hint={`${byteLen(symbol)} / ${METADATA_LIMITS.symbol} bytes`}
            error={symbolError}
          >
            <input
              id="kit-ticker"
              name="ticker"
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
              hint="Plain text. The pin step trims it; the program does not limit this field. It goes into the metadata file verbatim."
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

          <UrlField
            id="kit-image"
            label="Image URL (after upload)"
            hint="Required by the pin step, which fetches this URL and re-hosts the image on IPFS — so it has to be a link a server can read, not a file on disk."
            value={image}
            onChange={setImage}
            className="sm:col-span-2"
          />

          <UrlField
            id="kit-website"
            label="Website (optional)"
            hint="Left empty, the key is left out of the metadata file entirely."
            value={website}
            onChange={setWebsite}
          />
          <UrlField
            id="kit-twitter"
            label="X (optional)"
            hint="Left empty, the key is left out of the metadata file entirely."
            value={twitter}
            onChange={setTwitter}
          />
          <UrlField
            id="kit-telegram"
            label="Telegram (optional)"
            hint="Left empty, the key is left out of the metadata file entirely."
            value={telegram}
            onChange={setTelegram}
          />

          <div className="min-w-0">
            <Field
              id="kit-ca"
              label="Contract address (use last grinded)"
              hint={
                caOk
                  ? `${trimmedCa.slice(0, 4)}…${trimmedCa.slice(-4)} · valid base58 — the pump.fun link and the Shield/Splits deep links follow it`
                  : "the mint the Grinder produced, or any base58 mint address"
              }
              error={caError}
            >
              <input
                id="kit-ca"
                name="ca"
                className={`${inputClass} font-mono text-xs`}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={caError !== null}
                placeholder="paste the ground mint"
                value={ca}
                onChange={(e) => setCa(e.target.value)}
              />
            </Field>
          </div>

          <div className="min-w-0">
            <Field
              id="kit-devbuy"
              label="Dev buy (SOL, optional)"
              hint="Not part of the metadata file — it is a buy, not a field. It appears in thread post 2 and is what you type into the Launch Lab."
              error={devBuyError}
            >
              <input
                id="kit-devbuy"
                name="devBuy"
                className={`${inputClass} tabular`}
                autoComplete="off"
                inputMode="decimal"
                aria-invalid={devBuyError !== null}
                placeholder="e.g. 1.5"
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value)}
              />
            </Field>
          </div>

          {caOk ? (
            <div className="min-w-0 sm:col-span-2">
              <div className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                <p className="text-xs text-white/55">The coin page for that address</p>
                <a
                  href={tokenLinks(trimmedCa).pumpFun}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block break-all font-mono text-[11px] text-white/70 underline decoration-white/20 underline-offset-2 transition-colors hover:decoration-white/60"
                >
                  {tokenLinks(trimmedCa).pumpFun}
                </a>
                <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
                  Built from the address above, the same way src/lib/links.ts builds it for the rest of
                  the app. It answers only after the coin exists on chain.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3">
          <Alert tone="info" title="Why the contract address is not prefilled">
            The Grinder generates its keypair in that tab&apos;s memory and stores nothing — no{" "}
            <span className="font-mono">localStorage</span>, no cookie, no server record — so no other
            tab can read the mint it produced. This field stays empty and says so, rather than guessing
            from a pattern.
          </Alert>
        </div>
      </Card>

      {/* -------------------------------------------------------------- metadata file */}

      <Card className="p-4" id="kit-metadata">
        <SectionTitle aside={metadataReady ? `${byteLen(json)} bytes · ready to export` : "needs a name and a ticker"}>
          Metadata file
        </SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          The shape src/lib/pinata.ts writes when it pins, minus the{" "}
          <span className="font-mono">showName: true</span> that the pin route adds itself. An optional
          key with no value is left out rather than written as an empty string.
        </p>

        <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-white/10 bg-white/[0.015] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-white/70">
          {json}
        </pre>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyButton
            text={json}
            label="Copy JSON"
            disabled={!metadataReady}
            title={metadataReady ? "Copy the metadata JSON" : "Needs a name and a ticker inside the byte limits"}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={downloadJson}
            disabled={!metadataReady}
            title={metadataReady ? `Save ${filename}` : "Needs a name and a ticker inside the byte limits"}
          >
            Download {filename}
          </Button>
          <span aria-live="polite" className="text-[11px] text-white/40">
            {downloadNote ??
              (metadataReady
                ? "the file name follows the ticker; nothing is uploaded from here"
                : "a name and a ticker inside the byte limits are required before this can be exported")}
          </span>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          Upload this file to IPFS (or a pinning service) or let the Launch tab pin it, and the URI that
          comes back is the <span className="font-mono">uri</span> of the create transaction. The image
          URL above is pinned separately, and the metadata file points at the IPFS copy of it.
        </p>
      </Card>

      {/* ------------------------------------------------------------- launch thread */}

      <Card className="p-4" id="kit-thread">
        <SectionTitle
          aside={`${thread.posts.length} post(s) · ${charCount(thread.joined)} characters`}
        >
          Launch thread
        </SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          A template, not a model: every line below is your fields with fixed wording around them, and a
          post that has nothing to say is left out. X allows 280 characters per post on a standard
          account — the counter is Unicode code points, which is how X counts them.
        </p>

        {thread.posts.length === 0 ? (
          <p className="mt-3 text-xs text-white/45">
            Nothing to write yet — the thread needs at least a name and a ticker.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {thread.posts.map((post) => {
              const chars = charCount(post.body);
              const over = chars > 280;
              return (
                <li key={post.key} className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs text-white/60">{post.label}</span>
                    <span className={`font-mono text-[11px] tabular ${over ? "text-amber-300" : "text-white/40"}`}>
                      {chars} / 280{over ? " — over the limit" : ""}
                    </span>
                  </div>
                  <pre className="mt-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-white/70">
                    {post.body}
                  </pre>
                  <div className="mt-2">
                    <CopyButton text={post.body} label="copy post" />
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {thread.skipped.length > 0 ? (
          <div className="mt-3">
            <Alert tone="info" title="Left out of the thread — nothing was invented to fill the gap">
              <ul className="list-disc space-y-0.5 pl-4">
                {thread.skipped.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyButton
            text={thread.joined}
            label="Copy whole thread"
            disabled={thread.posts.length === 0}
            title={thread.posts.length === 0 ? "Nothing to copy yet" : "Copy every post, separated by a blank line"}
          />
          <span className="text-[11px] text-white/40">
            posts are joined with a blank line; paste one post at a time if the composer prefers it
          </span>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ checklist */}

      <Card className="p-4" id="kit-checklist">
        <SectionTitle aside={`${doneCount}/${items.length} done · ${items.length} steps`}>Checklist</SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          Nine steps, each linked to the tab that does it. A tick appears only where this page can read
          real state — the launch registry for the last two, a read-back of the pinned file for item 7.
          Anywhere the app keeps no record, the item says <span className="font-mono">not tracked here</span> instead
          of offering a checkbox that does nothing.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void runRegistryCheck()}
            disabled={registry.phase === "checking"}
          >
            {registry.phase === "checking" ? "Reading the registry…" : "Check the board"}
          </Button>
          <span aria-live="polite" className="text-[11px] text-white/40">
            {registryLine}
          </span>
        </div>

        <ol className="mt-3">
          {items.map((item) => (
            <li key={item.key} className="border-t border-white/10 py-3 first:border-t-0">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[10px] tabular ${
                    item.state === "done"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-white/15 text-white/45"
                  }`}
                >
                  {item.n}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                    <p className="text-sm">
                      {item.label}
                      <span className="sr-only"> — {item.stateLabel}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <StateChip state={item.state} label={item.stateLabel} />
                      {item.href ? (
                        <LinkButton href={item.href} size="sm" variant="ghost">
                          {item.openLabel}
                        </LinkButton>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-1 text-xs leading-relaxed text-white/40">{item.note}</p>

                  {item.key === "pincheck" ? (
                    <div className="mt-2 rounded-md border border-white/10 bg-white/[0.015] p-3">
                      <Field
                        id="kit-pin-uri"
                        label="Metadata URI (from the Launch tab's build log)"
                        hint="ipfs://<cid>, a https gateway URL, or a bare CID."
                      >
                        <div className="flex flex-wrap gap-2">
                          <input
                            id="kit-pin-uri"
                            name="pinUri"
                            className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="ipfs://… or https://gateway.pinata.cloud/ipfs/…"
                            value={pinUri}
                            onChange={(e) => setPinUri(e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void runPinCheck()}
                            disabled={pin.phase === "checking"}
                          >
                            {pin.phase === "checking" ? "Reading…" : "Check the pin"}
                          </Button>
                        </div>
                      </Field>

                      {pin.phase === "checking" ? (
                        <p className="mt-2 text-[11px] text-white/40">
                          fetching <span className="break-all font-mono">{pin.readUrl}</span> from this browser…
                        </p>
                      ) : null}

                      {pin.phase === "unreadable" ? (
                        <div className="mt-2">
                          <Alert tone="warn" title="Nothing was read back">
                            {pin.detail}. A failed read is not proof the pin is missing — it usually means
                            the gateway refused a browser cross-origin read, the CID is wrong, or the
                            network is down. No tick is shown either way.
                          </Alert>
                        </div>
                      ) : null}

                      {pin.phase === "not-json" ? (
                        <div className="mt-2">
                          <Alert tone="warn" title={`HTTP ${pin.status} — what came back is not a metadata file`}>
                            The response was not JSON. First 80 characters:{" "}
                            <span className="break-all font-mono">{pin.detail}</span>
                          </Alert>
                        </div>
                      ) : null}

                      {pin.phase === "read" ? (
                        <dl className="mt-2 space-y-1 text-[11px] leading-relaxed text-white/55">
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-white/40">HTTP status</dt>
                            <dd className="tabular">{pin.status}</dd>
                          </div>
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-white/40">Body</dt>
                            <dd className="tabular">{pin.bytes} bytes of JSON</dd>
                          </div>
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-white/40">name</dt>
                            <dd>{pin.name === null ? "— (key not present)" : pin.name}</dd>
                          </div>
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-white/40">symbol</dt>
                            <dd>{pin.symbol === null ? "— (key not present)" : pin.symbol}</dd>
                          </div>
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-white/40">keys present</dt>
                            <dd className="break-all font-mono">{pin.keys.length > 0 ? pin.keys.join(", ") : "—"}</dd>
                          </div>
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-white/40">showName</dt>
                            <dd>
                              {pin.showName
                                ? "true — the pin route added it"
                                : "not in what came back, so this pin did not come from the pin route's own writer"}
                            </dd>
                          </div>
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-white/40">verdict</dt>
                            <dd className={pinMatches ? "text-emerald-300" : "text-amber-300"}>
                              {pinMatches
                                ? "this is this coin's metadata file"
                                : "name or ticker do not match the fields above"}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* --------------------------------------------------------------- what ships */}

      <Card className="p-4">
        <SectionTitle aside="the ticket is the metadata URI">Ship it</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          The Launch tab takes this coin the rest of the way: it pins the image and the metadata file,
          builds the create against the real pump.fun program, simulates it, and only then asks for a
          signature. Come back here when a field goes red — the byte counts above are the same ones the
          create instruction applies.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <LinkButton href="/launch" variant="primary" size="md">
            Open the launch tab →
          </LinkButton>
          <LinkButton href="/lab" variant="secondary" size="md">
            Simulate it in the Launch Lab
          </LinkButton>
          <LinkButton href="/launchlab" variant="secondary" size="md">
            See the board
          </LinkButton>
        </div>
        {sendEnabled ? (
          <div className="mt-3">
            <Alert tone="warn" title="Sending is enabled in this environment">
              A prepared launch will actually submit and spend real SOL. Check the mint, the fee split
              and the dev buy once more before you sign.
            </Alert>
          </div>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            This build prepares and simulates only: NEXT_PUBLIC_ENABLE_SEND is not &quot;true&quot;, so
            nothing can be submitted from any tab — the safe default.
          </p>
        )}
      </Card>
    </div>
  );
}
