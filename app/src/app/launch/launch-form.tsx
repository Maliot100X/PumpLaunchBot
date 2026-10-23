"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { inputClass } from "@/components/ui";
import { VanityError, grindVanity, keypairFromResult } from "@/lib/vanity/grind";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, Transaction, type VersionedTransaction } from "@solana/web3.js";

type PrepareResponse = {
  ok?: boolean;
  built?: { transaction: string; recentBlockhash: string; signers: string[]; instructions: number };
  simulation?: { ok: boolean; err: string | null; logs: string[]; unitsConsumed: number | null };
  issues?: { field: string; message: string }[];
  error?: string;
  detail?: string;
};

/**
 * The Launch form (Phase 3). Flow: pin metadata to IPFS → build create_v2 → simulate.
 * Sending is deliberately OFF unless NEXT_PUBLIC_ENABLE_SEND=true: a real launch spends the
 * user's SOL, so it must be a conscious switch, not a default.
 */
export function LaunchForm() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const sendEnabled = process.env.NEXT_PUBLIC_ENABLE_SEND === "true";

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [twitter, setTwitter] = useState("");
  const [website, setWebsite] = useState("");
  const [mint, setMint] = useState("");
  const [busy, setBusy] = useState<null | "pin" | "prepare" | "send">(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<PrepareResponse | null>(null);
  const [metadataUri, setMetadataUri] = useState("");

  // Vanity grinding. The secret half stays in this component (a ref, so it never lands in a render
  // snapshot) until the user signs — the server only ever sees the public address.
  const mintKeypair = useRef<Keypair | null>(null);
  const grindAbort = useRef<AbortController | null>(null);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [grind, setGrind] = useState<{ running: boolean; attempts: number; rate: number; expected: number } | null>(null);

  const say = useCallback((line: string) => setLog((l) => [...l, line]), []);

  const address = useMemo(() => publicKey?.toBase58() ?? "", [publicKey]);

  function generateMint() {
    const kp = Keypair.generate();
    mintKeypair.current = kp;
    setMint(kp.publicKey.toBase58());
    say(`generated mint ${kp.publicKey.toBase58()} — its secret key is held here and signs the create`);
  }

  /** Grind a mint whose address starts with the prefix and/or ends with the suffix. */
  async function grindMint() {
    if (grind?.running) {
      grindAbort.current?.abort();
      say("grind stopped");
      return;
    }
    try {
      grindAbort.current = new AbortController();
      setGrind({ running: true, attempts: 0, rate: 0, expected: 0 });
      const result = await grindVanity({
        prefix,
        suffix,
        ignoreCase,
        signal: grindAbort.current.signal,
        onProgress: (p) => {
          setGrind({ running: true, attempts: p.attempts, rate: p.rate, expected: p.expectedAttempts });
        },
      });
      if (!result) {
        say("grind stopped without a match");
        setGrind(null);
        return;
      }
      const kp = keypairFromResult(result);
      mintKeypair.current = kp;
      setMint(result.publicKey);
      setGrind(null);
      say(
        `ground mint ${result.publicKey} after ${result.attempts.toLocaleString()} attempts in ` +
          `${result.elapsedMs} ms — its secret key signs the create`,
      );
    } catch (err) {
      setGrind(null);
      say(`grind error: ${err instanceof VanityError || err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function pin() {
    setBusy("pin");
    setResult(null);
    try {
      const res = await fetch("/api/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          symbol,
          description,
          imageUrl,
          ...(twitter ? { twitter } : {}),
          ...(website ? { website } : {}),
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        metadata?: { uri: string; cid: string };
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.metadata) throw new Error(body.detail ?? body.error ?? `pin failed (${res.status})`);
      setMetadataUri(body.metadata.uri);
      say(`pinned metadata → ${body.metadata.uri}`);
    } catch (err) {
      say(`pin error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    if (!address) {
      say("connect a wallet first — it is the payer and the fee recipient");
      return;
    }
    setBusy("prepare");
    setResult(null);
    try {
      const res = await fetch("/api/launch/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint, name, symbol, uri: metadataUri, creator: address, user: address }),
      });
      const body = (await res.json()) as PrepareResponse;
      setResult(body);
      if (!res.ok) {
        say(`prepare refused: ${body.error} ${body.detail ?? ""} ${JSON.stringify(body.issues ?? [])}`);
        return;
      }
      say(`built: ${body.built?.instructions} instruction(s), simulation ok=${body.simulation?.ok}`);
      if (body.simulation?.err) say(`simulation error: ${body.simulation.err}`);
      for (const l of (body.simulation?.logs ?? []).slice(-6)) say(`  ${l}`);
    } catch (err) {
      say(`prepare error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  async function signAndSend() {
    if (!signEnabledOk()) return;
    setBusy("send");
    try {
      const res = await fetch("/api/launch/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint, name, symbol, uri: metadataUri, creator: address, user: address }),
      });
      const body = (await res.json()) as PrepareResponse;
      if (!res.ok || !body.built) throw new Error(body.detail ?? "prepare failed");

      // A pump.fun create needs the mint to sign as well as the payer. The mint keypair was created
      // in this component (ground or generated) and never sent to the server, so it is partially
      // signed here first and the wallet only has to add its own signature.
      const tx = Transaction.from(Buffer.from(body.built.transaction, "base64"));
      const kp = mintKeypair.current;
      if (!kp) throw new Error("no mint keypair in this browser — grind or generate the mint first");
      if (kp.publicKey.toBase58() !== mint) throw new Error("the held keypair does not match the mint field");
      tx.partialSign(kp);
      const signed = await signTransaction?.(tx as unknown as VersionedTransaction);
      if (!signed) throw new Error("wallet did not return a signed transaction");
      const sig = await connection.sendRawTransaction(signed.serialize());
      say(`sent: ${sig}`);
    } catch (err) {
      say(`send error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  function signEnabledOk(): boolean {
    if (!sendEnabled) {
      say("sending is disabled in this build (NEXT_PUBLIC_ENABLE_SEND !== 'true')");
      return false;
    }
    if (!connected) {
      say("connect a wallet first");
      return false;
    }
    return true;
  }

  const input = inputClass;
  const label = "text-xs font-medium text-white/60";

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-medium">Token details</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-name">Name (max 32 bytes)</label>
            <input id="f-name" name="name" autoComplete="off" className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="f-symbol">Ticker (max 13)</label>
            <input id="f-symbol" name="symbol" autoComplete="off" className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="f-twitter">X / Twitter (optional)</label>
            <input id="f-twitter" name="twitter" autoComplete="off" inputMode="url" className={input} value={twitter} onChange={(e) => setTwitter(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-image">Image URL</label>
            <input id="f-image" name="imageUrl" autoComplete="off" inputMode="url" className={input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-desc">Description</label>
            <textarea id="f-desc" name="description" autoComplete="off" rows={3} className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-site">Website (optional)</label>
            <input id="f-site" name="website" autoComplete="off" inputMode="url" className={input} value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="sm:col-span-2 rounded-md border border-white/10 bg-white/[0.015] p-3">
            <p className="text-xs font-medium text-white/70">Vanity mint (optional)</p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/40">
              Grinds the mint address in this browser — the keypair never leaves the page and it is what
              signs the create. Longer patterns take exponentially longer; 4–5 characters is the practical
              range.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <div>
                <label className={label} htmlFor="f-prefix">Starts with</label>
                <input id="f-prefix" name="prefix" autoComplete="off" spellCheck={false} className={`${input} font-mono text-xs`} value={prefix} maxLength={6}
                       onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. pump" />
              </div>
              <div>
                <label className={label} htmlFor="f-suffix">Ends with</label>
                <input id="f-suffix" name="suffix" autoComplete="off" spellCheck={false} className={`${input} font-mono text-xs`} value={suffix} maxLength={6}
                       onChange={(e) => setSuffix(e.target.value)} placeholder="e.g. 999" />
              </div>
              <label className="flex items-center gap-2 pb-2 text-[11px] text-white/55">
                <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
                ignore case
              </label>
              <button
                type="button"
                onClick={grindMint}
                className="rounded-md border border-white/15 px-3 py-2 text-xs hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#828fff]"
              >
                {grind?.running ? "stop" : "grind"}
              </button>
            </div>
            {grind ? (
              <p aria-live="polite" className="mt-2 font-mono text-[11px] text-white/50 tabular">
                {grind.attempts.toLocaleString()} attempts · {grind.rate.toLocaleString()}/s ·{" "}
                {grind.expected ? `budget ~${grind.expected.toLocaleString()}` : ""}
              </p>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-mint">Mint address</label>
            <div className="flex gap-2">
              <input id="f-mint" name="mint" autoComplete="off" spellCheck={false} className={`${input} font-mono text-xs tabular`} value={mint} onChange={(e) => setMint(e.target.value)} />
              <button type="button" onClick={generateMint} className="shrink-0 rounded-md border border-white/15 px-3 text-xs hover:bg-white/5">
                random
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || !name || !symbol || !imageUrl}
            onClick={pin}
            className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
          >
            {busy === "pin" ? "Pinning…" : "1 · Pin metadata"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !metadataUri}
            onClick={prepare}
            className="rounded-md bg-[#5e6ad2] px-3 py-2 text-sm font-medium hover:bg-[#4f59b8] disabled:opacity-40"
          >
            {busy === "prepare" ? "Building…" : "2 · Prepare + simulate"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !metadataUri}
            onClick={signAndSend}
            className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
            title={sendEnabled ? "Signs with your wallet and sends" : "Disabled in this build"}
          >
            {busy === "send" ? "Sending…" : "3 · Sign & send"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-white/35">
          Sending is {sendEnabled ? "ENABLED" : "disabled in this build"} — the create transaction
          spends real rent ({connected ? "wallet connected" : "no wallet connected"}).
        </p>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-medium">Build log</h2>
        {metadataUri ? (
          <p className="mt-2 break-all font-mono text-[11px] text-white/50">uri: {metadataUri}</p>
        ) : null}
        {result?.simulation ? (
          <p className={`mt-2 text-xs ${result.simulation.ok ? "text-emerald-300" : "text-amber-300"}`}>
            simulation {result.simulation.ok ? "passed" : "failed"} · {result.simulation.unitsConsumed ?? "?"} CU
            {result.simulation.err ? ` · ${result.simulation.err}` : ""}
          </p>
        ) : null}
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/70">
          {log.length > 0 ? log.join("\n") : "nothing yet"}
        </pre>
      </section>
    </div>
  );
}
