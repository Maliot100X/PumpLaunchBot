"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, Transaction } from "@solana/web3.js";
import { Alert, Badge, Button, Card, EmptyState, Field, SectionTitle, inputClass } from "@/components/ui";

/**
 * /shield — scan a token CA, show what the API actually returned, and score how cheaply a lookalike
 * could be made from those returned values alone.
 *
 * Two rules this file is written to keep:
 *  1. Every figure comes from GET /api/token/{mint} or POST /api/recreate. When a field is absent the
 *     UI prints "—" or an explicit sentence saying it was not returned — never a placeholder number.
 *  2. The clone-risk panel is arithmetic over returned fields, and each line prints the value it read,
 *     the weight it contributed and why, so the verdict can be audited instead of trusted.
 */

type Token = {
  mint: string;
  name: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  dexId: string | null;
  socials: { url: string; type?: string }[];
  websites: { url: string; label?: string }[];
  metadataUri: string | null;
  /** Optional extra that the snapshot adds when DexScreener reports it; used only when present. */
  pairCreatedAt?: number | null;
};

type RecreatePlan = {
  name: string;
  symbol: string;
  description: string;
  imagePrompt?: string;
  imageUrl: string | null;
};

type RecreateResponse = {
  ok?: boolean;
  plan?: RecreatePlan;
  /** The route's plan carries the artwork URL; `image` is the pinned record for it. */
  image?: { url: string | null; cid: string | null; model: string } | null;
  metadataUri?: string | null;
  feeSplit?: { userBps: number; platformBps: number; mode?: string };
  treasury?: string | null;
  model?: string;
  fallback?: boolean;
  warnings?: string[];
  error?: string;
  detail?: string;
};

/**
 * The shape POST /api/shield/launch returns. Only the fields the UI actually reads are typed;
 * anything optional is optional here too, because a route can legitimately omit a link set.
 */
type LaunchPlan = {
  ok?: boolean;
  mode?: "self" | "sponsored";
  note?: string;
  launch?: {
    mint: string;
    mintSecretKey: number[] | null;
    mintWasGenerated: boolean;
    name: string;
    symbol: string;
    metadataUri: string;
    payer: string;
    creator: string;
    treasury: string;
  };
  feeSharing?: {
    shares: { address: string; bps: number }[];
    splitMode: "split" | "treasury-only";
    createConfig: string;
    updateShares: string | null;
    note?: string;
    userBps: number;
    platformBps: number;
  };
  create?: {
    transaction: string;
    simulation: { ok: boolean; err?: string | null; logs?: string[] | null; unitsConsumed?: number | null };
  };
  links?: {
    mint?: string;
    pumpFun?: string;
    dexScreener?: string;
    explorer?: string;
    platformExplore?: string;
    platformExploreAbsolute?: string;
  };
  warnings?: string[];
  error?: string;
  detail?: string | string[];
};

function usd(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v < 0.01) return `$${v.toExponential(3)}`;
  return `$${v.toFixed(4)}`;
}

function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").slice(0, 28);
}

/* ------------------------------------------------------------------ clone risk */

type Signal = {
  key: string;
  label: string;
  /** The value actually read from the response, or "—" when the field was absent. */
  measured: string;
  /** Positive leans easy, negative leans hard, null means no lean (neutral or unmeasurable). */
  points: number | null;
  verdict: "easy" | "hard" | "neutral";
  reason: string;
};

/**
 * Tickers that are effectively public property: thousands of mints already use them, so matching one
 * tells a holder nothing. Kept as an explicit list so the signal is auditable rather than a vibe.
 */
const GENERIC_SYMBOLS = new Set([
  "PEPE", "DOGE", "SHIB", "WIF", "BONK", "MOON", "CAT", "DOG", "TRUMP", "AI",
  "MEME", "BABY", "ELON", "SOL", "PUMP", "GOAT", "FART", "WEN", "TURBO", "MOG", "POPCAT",
]);

type Assessment = {
  signals: Signal[];
  total: number;
  measurable: number;
  verdict: "Hard to clone" | "Moderate to clone" | "Easy to clone" | "Not enough data";
  driver: string;
};

function assessCloneRisk(token: Token): Assessment {
  const signals: Signal[] = [];

  // 1 · Liquidity ÷ market cap — a thin book is cheap to pull, so it leans toward "easy".
  const mc = token.marketCap;
  const liq = token.liquidityUsd;
  if (mc === null || liq === null) {
    signals.push({
      key: "liquidity",
      label: "Liquidity ÷ market cap",
      measured: "—",
      points: null,
      verdict: "neutral",
      reason: `DexScreener returned ${mc === null ? "no market cap" : "no liquidity"} for this mint, so the liquidity-to-market-cap ratio is not measurable from this data.`,
    });
  } else if (mc <= 0) {
    signals.push({
      key: "liquidity",
      label: "Liquidity ÷ market cap",
      measured: `${usd(liq)} ÷ ${usd(mc)}`,
      points: null,
      verdict: "neutral",
      reason: "the returned market cap is zero, so a liquidity-to-market-cap ratio cannot be formed from this data.",
    });
  } else {
    const ratio = liq / mc;
    const pctText = `${(ratio * 100).toFixed(2)}%`;
    const points = ratio < 0.02 ? 2 : ratio < 0.05 ? 1 : ratio > 0.15 ? -1 : 0;
    signals.push({
      key: "liquidity",
      label: "Liquidity ÷ market cap",
      measured: `${usd(liq)} ÷ ${usd(mc)} = ${pctText}`,
      points,
      verdict: points > 0 ? "easy" : points < 0 ? "hard" : "neutral",
      reason:
        points === 2
          ? `liquidity ${usd(liq)} is only ${pctText} of the ${usd(mc)} market cap — a thin book, so whatever backs the price can leave in one sell. Under 2% adds the most risk weight here.`
          : points === 1
            ? `liquidity ${usd(liq)} is ${pctText} of market cap — below the 5% line, still thin enough to move hard on a single order.`
            : points === -1
              ? `liquidity ${usd(liq)} is ${pctText} of market cap — above 15%, a deeper book than the thin pools most copies run.`
              : `liquidity ${usd(liq)} is ${pctText} of market cap — between 5% and 15%, neither unusually thin nor unusually deep, so this signal carries no weight either way.`,
    });
  }

  // 2 · The last 4 characters. `pump` is the fixed suffix every pump.fun mint shares, so it is a
  //     guessable tail; anything else is four characters a copy would have to grind on purpose.
  const tail = token.mint.slice(-4);
  const tailIsDefault = tail.toLowerCase() === "pump";
  signals.push({
    key: "suffix",
    label: "Address tail",
    measured: `…${tail}`,
    points: tailIsDefault ? 1 : -1,
    verdict: tailIsDefault ? "easy" : "hard",
    reason: tailIsDefault
      ? `the address ends in "${tail}", the fixed suffix every pump.fun mint shares — a copy only has to match the middle of the address, not the end, so the tail identifies nothing.`
      : `the address ends in "${tail}", which is not the default pump.fun suffix — reproducing exactly those four characters is ~11.3M keys of deliberate work, so the tail is a real check holders can make.`,
  });

  // 3 · Ticker shape. A generic or very short ticker is free to reuse; a long specific one is not.
  const sym = token.symbol.trim();
  const symLen = sym.length;
  const nameLen = token.name.trim().length;
  const measuredSymbol = `symbol "${sym || "—"}" (${symLen} ch) · name (${nameLen} ch)`;
  if (symLen === 0) {
    signals.push({
      key: "symbol",
      label: "Ticker shape",
      measured: measuredSymbol,
      points: null,
      verdict: "neutral",
      reason: "the API returned an empty ticker, so there is nothing to measure about its shape.",
    });
  } else {
    const generic = GENERIC_SYMBOLS.has(sym.toUpperCase());
    const points = generic ? 2 : symLen <= 3 ? 1 : symLen >= 8 ? -1 : 0;
    signals.push({
      key: "symbol",
      label: "Ticker shape",
      measured: measuredSymbol,
      points,
      verdict: points > 0 ? "easy" : points < 0 ? "hard" : "neutral",
      reason: generic
        ? `the ticker "${sym}" is a generic, widely reused pattern — a copy can wear the same ticker and a holder could not tell the two apart by ticker alone.`
        : points === 1
          ? `the ticker "${sym}" is only ${symLen} character(s) — tickers that short are shared by thousands of mints, so it adds nothing a copy has to work for.`
          : points === -1
            ? `the ticker "${sym}" is ${symLen} characters — long and specific enough that a copy matching it exactly stands out.`
            : `the ticker "${sym}" is ${symLen} characters — not a generic pattern and not distinctive on its own, so this signal carries no weight either way.`,
    });
  }

  // 4 · Age / price availability. Only ever read from what came back; absent data is stated as such.
  const price = token.priceUsd;
  const created = token.pairCreatedAt ?? null;
  if (price === null) {
    signals.push({
      key: "age",
      label: "Age & price history",
      measured: "—",
      points: null,
      verdict: "neutral",
      reason: "DexScreener returned no price for this mint, so there is no price or age history to judge — not measurable from this data.",
    });
  } else if (created === null) {
    signals.push({
      key: "age",
      label: "Age & price history",
      measured: `price ${usd(price)} · pair age —`,
      points: null,
      verdict: "neutral",
      reason: `a price of ${usd(price)} is available, but the API returned no pair creation time, so the token's age is not measurable from this data.`,
    });
  } else {
    const ageHours = Math.max(0, (Date.now() - created) / 3_600_000);
    const ageText = ageHours < 48 ? `${ageHours.toFixed(1)} h` : `${(ageHours / 24).toFixed(1)} days`;
    const points = ageHours < 24 ? 1 : ageHours >= 24 * 30 ? -1 : 0;
    signals.push({
      key: "age",
      label: "Age & price history",
      measured: `price ${usd(price)} · pair ${ageText} old`,
      points,
      verdict: points > 0 ? "easy" : points < 0 ? "hard" : "neutral",
      reason:
        points === 1
          ? `the pair was created ${ageText} ago — a token this new has almost no track record, so a copy has nothing of its own to be told apart by yet.`
          : points === -1
            ? `the pair has been trading for ${ageText} — a longer record than a fresh copy would carry.`
            : `the pair is ${ageText} old — neither brand new nor long-established, so this signal carries no weight either way.`,
    });
  }

  // 5 · Link count. The fewer channels, the less there is for a holder to verify a copy against.
  const socialCount = token.socials.length;
  const webCount = token.websites.length;
  const links = socialCount + webCount;
  const points = links === 0 ? 2 : links === 1 ? 1 : links >= 3 ? -1 : 0;
  signals.push({
    key: "links",
    label: "Socials & websites",
    measured: `${links} (${socialCount} social · ${webCount} web)`,
    points,
    verdict: points > 0 ? "easy" : points < 0 ? "hard" : "neutral",
    reason:
      links === 0
        ? "the API returned no socials and no websites — a copy typically ships with nothing to check either, so an empty link set makes the two harder to tell apart."
        : points === 1
          ? "only one link was returned — a single channel is cheap to stand up for a copy."
          : points === -1
            ? `${links} links were returned — a copy would have to fake or drop several channels, which is more work than a single-link clone.`
            : "two links were returned — enough to compare, not enough to be distinctive.",
  });

  const measurable = signals.filter((s) => s.points !== null).length;
  const total = signals.reduce((sum, s) => sum + (s.points ?? 0), 0);
  const verdict: Assessment["verdict"] =
    measurable < 2
      ? "Not enough data"
      : total >= 2
        ? "Easy to clone"
        : total <= -2
          ? "Hard to clone"
          : "Moderate to clone";

  const ranked = signals
    .filter((s): s is Signal & { points: number } => s.points !== null)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const driver =
    ranked.length > 0
      ? `${ranked[0].label} — ${ranked[0].reason}`
      : "no single signal dominated, because almost nothing that would decide this was returned.";

  return { signals, total, measurable, verdict, driver };
}

const VERDICT_TONE: Record<Assessment["verdict"], "ok" | "warn" | "neutral"> = {
  "Hard to clone": "ok",
  "Moderate to clone": "neutral",
  "Easy to clone": "warn",
  "Not enough data": "neutral",
};

const VERDICT_CLASS: Record<Signal["verdict"], string> = {
  easy: "text-amber-300",
  hard: "text-emerald-300",
  neutral: "text-white/45",
};

/* ----------------------------------------------------------------------- view */

export function ShieldClient({ initialMint }: { initialMint: string }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [mint, setMint] = useState(initialMint);
  const [token, setToken] = useState<Token | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [plan, setPlan] = useState<RecreateResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSymbol, setEditSymbol] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const lookedUp = useRef("");

  /* ---- launch half: fee wallet, mode, plan, and the sign/send trail ---- */
  const [feeWallet, setFeeWallet] = useState("");
  const [launchMode, setLaunchMode] = useState<"self" | "sponsored">("sponsored");
  const [launchPlan, setLaunchPlan] = useState<LaunchPlan | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendLog, setSendLog] = useState<string[]>([]);
  const [signatures, setSignatures] = useState<string[]>([]);

  const walletAddress = publicKey?.toBase58() ?? null;

  async function runScan(value: string) {
    if (!value) {
      setScanError("Enter a Solana mint address to scan.");
      return;
    }
    setScanning(true);
    setScanError(null);
    setToken(null);
    setPlan(null);
    setPlanError(null);
    try {
      const res = await fetch(`/api/token/${encodeURIComponent(value)}`);
      const body = (await res.json()) as { ok?: boolean; token?: Token; error?: string; detail?: string };
      if (!res.ok || !body.token) {
        setScanError(body.detail ?? body.error ?? `lookup failed (${res.status})`);
      } else {
        // The snapshot always sends arrays, but a degraded upstream response could omit them; normalise
        // here so the render path never dereferences undefined.
        setToken({ ...body.token, socials: body.token.socials ?? [], websites: body.token.websites ?? [] });
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "network error");
    } finally {
      setScanning(false);
    }
  }

  // A deep link (?mint=…) should already show the token, not just fill the box.
  useEffect(() => {
    if (!initialMint || lookedUp.current === initialMint) return;
    lookedUp.current = initialMint;
    void runScan(initialMint);
  }, [initialMint]);

  const risk = useMemo(() => (token ? assessCloneRisk(token) : null), [token]);

  async function prepareRecreate() {
    const target = token?.mint ?? mint.trim();
    if (!target) {
      setPlanError("Scan or paste a mint first — recreate needs a token to copy.");
      return;
    }
    setPreparing(true);
    setPlanError(null);
    setPlan(null);
    try {
      const res = await fetch("/api/recreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: target }),
      });
      const body = (await res.json().catch(() => null)) as RecreateResponse | null;
      if (!res.ok || !body || body.ok === false || !body.plan) {
        setPlanError(body?.detail ?? body?.error ?? `recreate failed (${res.status})`);
        return;
      }
      setPlan(body);
      setEditName(body.plan.name ?? "");
      setEditSymbol(body.plan.symbol ?? "");
      setEditDescription(body.plan.description ?? "");
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "network error");
    } finally {
      setPreparing(false);
    }
  }

  const recreateTarget = token?.mint ?? mint.trim();

  /* ------------------------------------------------------------- prepare the launch */

  async function prepareLaunch() {
    setLaunchError(null);
    setSignatures([]);
    setSendLog([]);

    const proposal = plan; // the recreate response
    if (!proposal?.plan) {
      setLaunchError("Prepare a recreate plan first — the launch needs a name, ticker and artwork.");
      return;
    }
    if (!proposal.image?.url) {
      setLaunchError(
        "This plan has no pinned artwork, and pump.fun metadata must point at an image. Re-run Prepare recreate.",
      );
      return;
    }
    if (launchMode === "self" && !walletAddress) {
      setLaunchError("Self launch is signed by your wallet — connect a Solana wallet first.");
      return;
    }

    setLaunching(true);
    try {
      const res = await fetch("/api/shield/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMint: recreateTarget || undefined,
          name: editName.trim() || proposal.plan.name,
          symbol: editSymbol.trim() || proposal.plan.symbol,
          description: editDescription.trim() || proposal.plan.description,
          imageUri: proposal.image.url,
          mode: launchMode,
          user: launchMode === "self" ? walletAddress ?? undefined : undefined,
          feeWallet: feeWallet.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as LaunchPlan | null;
      if (!res.ok || !body || body.ok === false || !body.launch) {
        setLaunchError(
          Array.isArray(body?.detail)
            ? body.detail.join(" · ")
            : (body?.detail as string) ?? body?.error ?? `launch prepare failed (${res.status})`,
        );
        return;
      }
      setLaunchPlan(body);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "network error");
    } finally {
      setLaunching(false);
    }
  }

  /* ------------------------------------------------- sign and send (self mode only) */

  async function signAndSend() {
    setSendError(null);
    if (!launchPlan?.launch || !launchPlan.create || !launchPlan.feeSharing) return;
    if (!publicKey || !sendTransaction) {
      setSendError("Connect a Solana wallet — this path is signed by you, not by the platform.");
      return;
    }

    const log = (line: string) => setSendLog((lines) => [...lines, line]);
    setSending(true);

    /** Re-stamp a fresh blockhash: a plan can sit on screen long enough to expire. */
    async function fresh(tx: Transaction): Promise<Transaction> {
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      return tx;
    }

    try {
      // 1 · create_v2. The mint keypair the route generated must also sign, which is why its secret
      //     is returned exactly once. The connected wallet is the fee payer.
      const createTx = Transaction.from(Buffer.from(launchPlan.create.transaction, "base64"));
      if (launchPlan.launch.mintSecretKey) {
        createTx.partialSign(Keypair.fromSecretKey(Uint8Array.from(launchPlan.launch.mintSecretKey)));
      }
      const sigCreate = await sendTransaction(await fresh(createTx), connection, {
        skipPreflight: false,
        maxRetries: 3,
      });
      log(`1/3 create_v2 sent · ${sigCreate}`);
      await connection.confirmTransaction(sigCreate, "confirmed");
      log("1/3 create_v2 confirmed — the coin now exists on pump.fun");
      setSignatures((s) => [...s, sigCreate]);

      // 2 · create_fee_sharing_config. Separate transaction on purpose: packed together with create
      //     the three instructions are ~1,280 bytes and pump's ceiling is 1,232.
      const cfgTx = Transaction.from(Buffer.from(launchPlan.feeSharing.createConfig, "base64"));
      const sigConfig = await sendTransaction(await fresh(cfgTx), connection, {
        skipPreflight: false,
        maxRetries: 3,
      });
      log(`2/3 fee-sharing config sent · ${sigConfig}`);
      await connection.confirmTransaction(sigConfig, "confirmed");
      log("2/3 fee-sharing config confirmed");
      setSignatures((s) => [...s, sigConfig]);

      // 3 · update_fee_shares_v2 — this is the permanent split, and it revokes the admin.
      if (launchPlan.feeSharing.updateShares) {
        const upTx = Transaction.from(Buffer.from(launchPlan.feeSharing.updateShares, "base64"));
        const sigShares = await sendTransaction(await fresh(upTx), connection, {
          skipPreflight: false,
          maxRetries: 3,
        });
        log(`3/3 fee shares sent · ${sigShares}`);
        await connection.confirmTransaction(sigShares, "confirmed");
        log("3/3 fee shares confirmed — the split is now permanent on chain");
        setSignatures((s) => [...s, sigShares]);
      } else {
        log("3/3 no share update was built, so the config keeps its default single creator share");
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "the wallet or the cluster rejected the transaction");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookedUp.current = mint.trim();
          void runScan(mint.trim());
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="shield-mint" className="sr-only">
          Solana mint address
        </label>
        <input
          id="shield-mint"
          name="mint"
          autoComplete="off"
          inputMode="text"
          spellCheck={false}
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          placeholder="mint address, e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
          className={`min-w-0 flex-1 font-mono text-xs ${inputClass}`}
        />
        <Button type="submit" disabled={scanning}>
          {scanning ? "Scanning…" : "Scan"}
        </Button>
      </form>

      <p className="mt-2 text-[11px] text-white/35">
        Reads the same data as Explore: on-chain metadata (Helius DAS) merged with market numbers
        (DexScreener). Add <span className="font-mono">?mint=…</span> to this URL to open with a token
        already scanned.
      </p>

      <div aria-live="polite">
        {scanError ? (
          <div className="mt-4">
            <Alert tone="error" title="Scan failed">
              {scanError}
            </Alert>
          </div>
        ) : null}

        {scanning && !token ? <p className="mt-4 text-xs text-white/40">Reading the chain and the market…</p> : null}

        {!scanning && !token && !scanError ? (
          <div className="mt-4">
            <EmptyState title="No token scanned yet">
              Paste a mint above and press Scan. Nothing is guessed: every field below is whatever the
              lookup returns for that address.
            </EmptyState>
          </div>
        ) : null}

        {token ? (
          <article className="mt-6">
            <SectionTitle aside={token.dexId ? `dex ${token.dexId}` : "dex —"}>
              {token.name} <span className="text-white/50">${token.symbol}</span>
            </SectionTitle>

            <Card className="mt-3 p-4">
              <div className="flex items-start gap-4">
                {token.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote token art, arbitrary hosts
                  <img
                    src={token.imageUrl}
                    alt=""
                    width={64}
                    height={64}
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-md border border-white/10 object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-white/15 text-[10px] text-white/35">
                    no image
                  </div>
                )}

                <div className="min-w-0">
                  <p className="break-all font-mono text-[11px] text-white/40">{token.mint}</p>
                  {token.description ? (
                    <p className="mt-2 text-sm leading-relaxed text-white/60">{token.description}</p>
                  ) : (
                    <p className="mt-2 text-xs text-white/40">
                      no on-chain description was returned for this mint.
                    </p>
                  )}
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                {(
                  [
                    ["Price", usd(token.priceUsd)],
                    ["Market cap", usd(token.marketCap)],
                    ["Liquidity", usd(token.liquidityUsd)],
                    ["DEX", token.dexId ?? "—"],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="rounded-md border border-white/10 bg-white/[0.02] p-2.5">
                    <dt className="text-white/40">{k}</dt>
                    <dd className="tabular mt-1 font-medium">{v}</dd>
                  </div>
                ))}
              </dl>

              {token.socials.length + token.websites.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  {[...token.websites, ...token.socials].map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border border-white/10 px-2 py-1 text-white/70 transition-colors hover:border-white/25 hover:text-white"
                    >
                      {"label" in l && l.label ? l.label : linkLabel(l.url)}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-xs text-white/40">
                  no socials and no websites were returned for this mint.
                </p>
              )}

              <p className="mt-4 break-all text-[11px] text-white/35">
                metadata URI: {token.metadataUri ?? "none returned"}
              </p>
            </Card>
          </article>
        ) : null}
      </div>

      {token && risk ? (
        <section className="mt-8">
          <SectionTitle aside={`score ${risk.total > 0 ? `+${risk.total}` : risk.total} · ${risk.measurable} of ${risk.signals.length} signals measurable`}>
            Clone risk / shield score
          </SectionTitle>

          <Card className="mt-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={VERDICT_TONE[risk.verdict]}>{risk.verdict}</Badge>
              <span className="tabular text-xs text-white/40">
                {risk.verdict === "Not enough data"
                  ? "fewer than two signals could be measured"
                  : `weighted ${risk.total > 0 ? `+${risk.total}` : risk.total} · +2 or more reads Easy, −2 or less reads Hard, in between Moderate`}
              </span>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-white/60">
              <span className="text-white/40">What drives it: </span>
              {risk.driver}
            </p>

            <dl className="mt-4 divide-y divide-white/10 border-t border-white/10">
              {risk.signals.map((s) => (
                <div key={s.key} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <dt className="text-sm">{s.label}</dt>
                    <dd className="tabular break-all font-mono text-[11px] text-white/55">{s.measured}</dd>
                  </div>
                  <p className={`mt-1 font-mono text-[11px] ${VERDICT_CLASS[s.verdict]}`}>
                    {s.points === null
                      ? "no lean — not measurable"
                      : s.points > 0
                        ? `+${s.points} toward easy to clone`
                        : `${s.points} against easy to clone`}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">{s.reason}</p>
                </div>
              ))}
            </dl>

            <p className="mt-3 text-[11px] leading-relaxed text-white/40">
              This is a copy-cost read, not a rug score: it only weighs the fields the lookup returned,
              and any signal the API left out is reported as not measurable rather than assumed. Judging
              whether a token is worth buying is not something this data answers.
            </p>
          </Card>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionTitle aside={recreateTarget ? `mint ${recreateTarget.slice(0, 6)}…${recreateTarget.slice(-4)}` : "no mint yet"}>
          Recreate this token
        </SectionTitle>

        <Card className="mt-3 p-4">
          <p className="text-sm leading-relaxed text-white/60">
            Prepare a fresh launch from this token&apos;s own identity: the model proposes a new name, a
            ticker, a description and an image prompt, and the image is generated from that prompt. The
            plan is a proposal only — nothing is signed, sent or funded here.
          </p>

          <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02] p-3">
            <p className="text-xs text-white/40">Creator-fee rule on every launch</p>
            <p className="tabular mt-1 text-sm text-white/70">
              70% of creator fees to the launcher&apos;s wallet · 30% to the platform treasury
            </p>
            <p className="mt-1 font-mono text-[11px] text-white/40">7000 bps / 3000 bps</p>
            {plan?.feeSplit ? (
              <p className="mt-1 font-mono text-[11px] text-white/55">
                this plan returned: {plan.feeSplit.userBps} bps launcher / {plan.feeSplit.platformBps} bps
                platform
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-white/40">
                the recreate response has not returned a fee split, so the rule above is the documented
                default.
              </p>
            )}
          </div>

          <div className="mt-4">
            <Button type="button" onClick={() => void prepareRecreate()} disabled={preparing || !recreateTarget}>
              {preparing ? "Preparing…" : "Prepare recreate"}
            </Button>
          </div>

          <div aria-live="polite">
            {planError ? (
              <div className="mt-4">
                <Alert tone="error" title="Recreate failed">
                  {planError}
                </Alert>
              </div>
            ) : null}

            {plan?.warnings && plan.warnings.length > 0 ? (
              <div className="mt-4">
                <Alert tone="warn" title="The route returned warnings">
                  <ul className="list-disc space-y-1 pl-4">
                    {plan.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              </div>
            ) : null}
          </div>

          {plan?.plan ? (
            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="flex items-start gap-4">
                {plan.image?.url ?? plan.plan.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated art, arbitrary host
                  <img
                    src={(plan.image?.url ?? plan.plan.imageUrl) as string}
                    alt=""
                    width={96}
                    height={96}
                    loading="lazy"
                    className="h-24 w-24 shrink-0 rounded-md border border-white/10 object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md border border-dashed border-white/15 text-center text-[10px] text-white/35">
                    no artwork — the image step was skipped or failed, and the launch needs one
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs text-white/40">
                    Proposed identity — edit anything below before launching
                  </p>
                  {plan.image?.cid ? (
                    <p className="mt-1 break-all font-mono text-[11px] text-white/45">
                      artwork pinned: {plan.image.cid} ({plan.image.model})
                    </p>
                  ) : null}
                  {plan.plan.imagePrompt ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                      prompt: {plan.plan.imagePrompt}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                    {plan.fallback
                      ? "This plan was derived from the token's own metadata — the model was not reachable for this request."
                      : `Rewritten by ${plan.model ?? "the model"}.`}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Name" id="plan-name">
                  <input
                    id="plan-name"
                    className={inputClass}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Ticker" id="plan-symbol">
                  <input
                    id="plan-symbol"
                    className={`font-mono text-xs ${inputClass}`}
                    value={editSymbol}
                    onChange={(e) => setEditSymbol(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="Description" id="plan-description">
                  <textarea
                    id="plan-description"
                    rows={3}
                    className={inputClass}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </Field>
              </div>

              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-xs text-white/40">Launch this plan</p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Wallet that receives your 70% (optional)" id="fee-wallet">
                    <input
                      id="fee-wallet"
                      name="feeWallet"
                      autoComplete="off"
                      spellCheck={false}
                      value={feeWallet}
                      onChange={(e) => setFeeWallet(e.target.value)}
                      placeholder="your Solana wallet"
                      className={`font-mono text-xs ${inputClass}`}
                    />
                  </Field>

                  <Field label="Who pays the launch" id="launch-mode">
                    <select
                      id="launch-mode"
                      name="launchMode"
                      value={launchMode}
                      onChange={(e) => setLaunchMode(e.target.value as "self" | "sponsored")}
                      className={inputClass}
                    >
                      <option value="sponsored">Platform-sponsored — the treasury pays and signs</option>
                      <option value="self">Self launch — my wallet pays and signs everything</option>
                    </select>
                  </Field>
                </div>

                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  {launchMode === "sponsored"
                    ? "The platform treasury is the creator of record and pays the pump.fun costs. You only name the wallet that takes your share."
                    : connected
                      ? `Your connected wallet ${walletAddress?.slice(0, 4)}…${walletAddress?.slice(-4)} pays every cost and is the creator — the fees are yours.`
                      : "Self launch is signed by your wallet: connect one in the header first, then come back."}
                  {!feeWallet.trim()
                    ? " With no wallet named, the treasury keeps 100% of the creator fees — the program rejects an empty shareholder list."
                    : ""}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void prepareLaunch()} disabled={launching}>
                    {launching ? "Building the launch…" : "Prepare launch"}
                  </Button>
                  {launchMode === "self" ? (
                    <Button
                      type="button"
                      onClick={() => void signAndSend()}
                      disabled={sending || !launchPlan?.create}
                    >
                      {sending ? "Sending…" : "Sign & send (3 transactions)"}
                    </Button>
                  ) : null}
                </div>

                <div aria-live="polite">
                  {launchError ? (
                    <div className="mt-4">
                      <Alert tone="error" title="Launch prepare failed">
                        {launchError}
                      </Alert>
                    </div>
                  ) : null}
                  {sendError ? (
                    <div className="mt-4">
                      <Alert tone="error" title="The transaction was not sent">
                        {sendError}
                      </Alert>
                    </div>
                  ) : null}
                </div>

                {launchPlan?.warnings && launchPlan.warnings.length > 0 ? (
                  <div className="mt-4">
                    <Alert tone="warn" title="Warnings from the launch route">
                      <ul className="list-disc space-y-1 pl-4">
                        {launchPlan.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </Alert>
                  </div>
                ) : null}

                {launchPlan?.launch && launchPlan.feeSharing ? (
                  <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={launchPlan.feeSharing.splitMode === "split" ? "ok" : "neutral"}>
                        {launchPlan.feeSharing.splitMode === "split" ? "70 / 30 split set" : "treasury keeps 100%"}
                      </Badge>
                      <span className="text-xs text-white/45">
                        mode {launchPlan.mode} · payer {launchPlan.launch.payer.slice(0, 4)}…
                        {launchPlan.launch.payer.slice(-4)}
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1 text-xs">
                      {launchPlan.feeSharing.shares.map((s) => (
                        <li key={s.address} className="break-all font-mono text-[11px] text-white/60">
                          {s.address} · {(s.bps / 100).toFixed(2)}% ({s.bps} bps)
                          {s.address === launchPlan.launch?.treasury ? " · platform treasury" : " · yours"}
                        </li>
                      ))}
                    </ul>

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div className="rounded-md border border-white/10 p-2">
                        <dt className="text-white/40">create_v2 simulation</dt>
                        <dd className={`tabular mt-1 font-medium ${launchPlan.create?.simulation.ok ? "text-emerald-300" : "text-amber-300"}`}>
                          {launchPlan.create?.simulation.ok ? "ok" : "failed"}
                        </dd>
                      </div>
                      <div className="rounded-md border border-white/10 p-2">
                        <dt className="text-white/40">Mint</dt>
                        <dd className="mt-1 break-all font-mono text-[10px]">{launchPlan.launch.mint.slice(0, 10)}…</dd>
                      </div>
                      <div className="rounded-md border border-white/10 p-2">
                        <dt className="text-white/40">Transactions</dt>
                        <dd className="tabular mt-1 font-medium">3 max, never packed</dd>
                      </div>
                      <div className="rounded-md border border-white/10 p-2">
                        <dt className="text-white/40">Sent</dt>
                        <dd className="tabular mt-1 font-medium">
                          {signatures.length > 0 ? `${signatures.length} sent` : "nothing"}
                        </dd>
                      </div>
                    </dl>

                    {!launchPlan.create?.simulation.ok && launchPlan.create?.simulation.err ? (
                      <p className="mt-2 break-all font-mono text-[10px] text-amber-300/80">
                        {launchPlan.create.simulation.err}
                      </p>
                    ) : null}

                    <p className="mt-2 break-all font-mono text-[10px] text-white/40">
                      metadata {launchPlan.launch.metadataUri}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      {launchPlan.links?.pumpFun ? (
                        <a
                          href={launchPlan.links.pumpFun}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white"
                        >
                          pump.fun coin page
                        </a>
                      ) : null}
                      {launchPlan.links?.platformExplore ? (
                        <a
                          href={launchPlan.links.platformExplore}
                          className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white"
                        >
                          our explore view
                        </a>
                      ) : null}
                      {launchPlan.links?.explorer ? (
                        <a
                          href={launchPlan.links.explorer}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white"
                        >
                          solscan
                        </a>
                      ) : null}
                      {launchPlan.links?.dexScreener ? (
                        <a
                          href={launchPlan.links.dexScreener}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-white/10 px-2 py-1 text-white/70 hover:border-white/25 hover:text-white"
                        >
                          dexscreener
                        </a>
                      ) : null}
                    </div>

                    <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                      {launchPlan.note}
                    </p>

                    {sendLog.length > 0 ? (
                      <ol className="mt-3 space-y-1 border-t border-white/10 pt-3">
                        {sendLog.map((line) => (
                          <li key={line} className="break-all font-mono text-[10px] text-white/55">
                            {line}
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {signatures.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {signatures.map((sig) => (
                          <li key={sig}>
                            <a
                              href={`https://solscan.io/tx/${sig}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all font-mono text-[10px] text-[#8f9bff] hover:underline"
                            >
                              {sig}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
