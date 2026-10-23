"use client";

import { useCallback, useMemo, useState } from "react";
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

  const say = useCallback((line: string) => setLog((l) => [...l, line]), []);

  const address = useMemo(() => publicKey?.toBase58() ?? "", [publicKey]);

  function generateMint() {
    const kp = Keypair.generate();
    setMint(kp.publicKey.toBase58());
    // The secret half must be kept by the user; in this build it is regenerated per launch
    // and never sent to the server. Vanity grinding (Phase 5) replaces this step.
    say(`generated mint ${kp.publicKey.toBase58()} (keep its secret key — it must sign the create)`);
    // The keypair is intentionally not stored in state beyond its address in this phase.
    void kp;
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

      // The mint keypair that signs is NOT held server-side; in this phase the user signs
      // with the wallet only and the mint must be supplied by the grind step (Phase 5).
      const tx = Transaction.from(Buffer.from(body.built.transaction, "base64"));
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

  const input =
    "w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-[#5e6ad2]";
  const label = "text-xs font-medium text-white/60";

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-medium">Token details</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-name">Name (max 32 bytes)</label>
            <input id="f-name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="f-symbol">Ticker (max 13)</label>
            <input id="f-symbol" className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="f-twitter">X / Twitter (optional)</label>
            <input id="f-twitter" className={input} value={twitter} onChange={(e) => setTwitter(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-image">Image URL</label>
            <input id="f-image" className={input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-desc">Description</label>
            <textarea id="f-desc" rows={3} className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-site">Website (optional)</label>
            <input id="f-site" className={input} value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="f-mint">Mint address</label>
            <div className="flex gap-2">
              <input id="f-mint" className={`${input} font-mono text-xs`} value={mint} onChange={(e) => setMint(e.target.value)} />
              <button type="button" onClick={generateMint} className="shrink-0 rounded-md border border-white/15 px-3 text-xs hover:bg-white/5">
                generate
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
