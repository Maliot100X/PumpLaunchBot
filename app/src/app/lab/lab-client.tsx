"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, SectionTitle, Stat, inputClass } from "@/components/ui";

/**
 * Launch Lab — a bonding-curve SIMULATOR, and it says so everywhere.
 *
 * What it is: arithmetic over pump.fun's published curve parameters, run in this tab. What it is
 * not: a transaction. Nothing here talks to an RPC, a wallet, or the network — the whole tab is
 * pure functions over numbers the user types, which is why it can run with the wallet disconnected
 * and why no button here can spend anything.
 */

/* ------------------------------------------------------------------- the model */

/**
 * The constants, stated here AND printed in the UI ("Assumptions") so a number can always be traced
 * back to its input:
 *   - 1,000,000,000 total supply; 800,000,000 sell on the curve; 200,000,000 are held back for the
 *     liquidity pool the coin graduates into.
 *   - A constant-product curve with *virtual* reserves: 30 SOL and 1,073,000,000 tokens. Price is
 *     reserve SOL / reserve tokens, so it rises as buys pull tokens out — not a linear ramp.
 *   - k = virtual SOL x virtual tokens never changes, which is what makes one formula enough.
 *   - 1% of every buy leaves as fees: a 1 SOL buy puts 0.99 SOL into the curve (the same convention
 *     the scraped reference numbers use: 1 SOL dev buy -> 0.99 SOL in curve -> 3.43% of supply).
 *   - Graduation at 85 SOL of REAL (non-virtual) SOL in the curve.
 */
const TOTAL_SUPPLY = 1_000_000_000;
const CURVE_SUPPLY = 800_000_000;
const LIQUIDITY_RESERVE = TOTAL_SUPPLY - CURVE_SUPPLY; // 200,000,000
const VIRTUAL_SOL = 30;
const VIRTUAL_TOKENS = 1_073_000_000;
const BUY_FEE_BPS = 100;
const GRADUATION_SOL = 85;
const K = VIRTUAL_SOL * VIRTUAL_TOKENS;

/**
 * The concentration line, stated in the UI next to the flag it produces. 15% of supply between the
 * dev and the bundle is where the launch stops looking like a launch and starts looking like a
 * pump: it is 1.5x the 10% single-holder line screeners colour amber, and it is more than the
 * float a bundle needs to be the exit liquidity for everyone else.
 */
const CONCENTRATION_PCT = 15;

/** Token reserve at a given SOL reserve (the curve's own invariant). */
const tokensAt = (vsol: number) => K / vsol;
/** Price in SOL per token: reserve SOL / reserve tokens. */
const priceAt = (vsol: number) => (vsol * vsol) / K;
/** Market cap in SOL = price x the full 1,000,000,000 supply (pump.fun's convention). */
const mcAt = (vsol: number) => priceAt(vsol) * TOTAL_SUPPLY;
/** Invert the curve: the SOL reserve that prices the token at a given market cap. */
const vsolForMc = (mcSol: number) => Math.sqrt((mcSol * K) / TOTAL_SUPPLY);
/** What actually reaches the curve after the 1% buy fee. */
const netOfFee = (grossSol: number) => grossSol * (1 - BUY_FEE_BPS / 10_000);

type Buy = { tokens: number; net: number; vsolAfter: number };

/** Walk one buy along the curve. `gross` is what the buyer pays; `net` is what the curve receives. */
function buy(gross: number, vsolBefore: number): Buy {
  const net = netOfFee(gross);
  const vsolAfter = vsolBefore + net;
  return { tokens: tokensAt(vsolBefore) - tokensAt(vsolAfter), net, vsolAfter };
}

/** A chain of `count` identical buys, each paying `eachGross`, starting where the dev buy left off. */
function bundleBuys(count: number, vsolStart: number, eachGross: number): Buy {
  let vsol = vsolStart;
  let tokens = 0;
  let net = 0;
  for (let i = 0; i < count; i++) {
    const b = buy(eachGross, vsol);
    vsol = b.vsolAfter;
    tokens += b.tokens;
    net += b.net;
  }
  return { tokens, net, vsolAfter: vsol };
}

/* ----------------------------------------------------------------- formatters */

function compact(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`;
  return n.toFixed(digits);
}
const sol = (n: number, digits = 4) => `${n.toFixed(digits)} SOL`;
const asPct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;
/** Prices in a curve this flat are unreadable in SOL; nano-SOL is the unit holders actually use. */
const nanosol = (priceInSol: number) => `${(priceInSol * 1e9).toFixed(2)} nSOL`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** A typed-but-empty field should not become 0 or NaN under the user's fingers. */
function numberOr(raw: string, fallback: number): number {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : fallback;
}

const LADDER = [0, 1, 2, 3, 4, 6, 8, 10, 15, 20];

/* --------------------------------------------------------------------- the tab */

export function LabClient() {
  const [devBuyRaw, setDevBuyRaw] = useState("1");
  const [bundlesRaw, setBundlesRaw] = useState("0");
  const [devPctRaw, setDevPctRaw] = useState("5");
  const [targetMcRaw, setTargetMcRaw] = useState("28");
  const [solUsdRaw, setSolUsdRaw] = useState("");

  const devBuySol = Math.min(1_000_000, Math.max(0, numberOr(devBuyRaw, 1)));
  const bundles = Math.min(200, Math.max(0, Math.floor(numberOr(bundlesRaw, 0))));
  const declaredDevShare = Math.min(100, Math.max(0, numberOr(devPctRaw, 5))) / 100;
  const targetMcSol = Math.max(0, numberOr(targetMcRaw, 28));
  const solUsd = Math.max(0, numberOr(solUsdRaw, 0));

  const m = useMemo(() => {
    const dev = buy(devBuySol, VIRTUAL_SOL);
    const bundle = bundleBuys(bundles, dev.vsolAfter, devBuySol);

    const devShare = dev.tokens / TOTAL_SUPPLY;
    const bundleShare = bundle.tokens / TOTAL_SUPPLY;
    const teamShare = devShare + bundleShare;
    const float = Math.max(0, 1 - teamShare);

    const netInCurve = dev.net + bundle.net;
    const progress = Math.min(1, netInCurve / GRADUATION_SOL);

    const entryPrice = dev.tokens > 0 ? dev.net / dev.tokens : 0;
    const priceAfterDevBuy = priceAt(dev.vsolAfter);
    const priceAfterBundle = priceAt(bundle.vsolAfter);
    const mcAfterDevBuy = mcAt(dev.vsolAfter);
    const openMc = mcAt(VIRTUAL_SOL);

    // Invert the curve to turn "the market cap I want" into "the buying that has to happen".
    const targetVsol = vsolForMc(targetMcSol);
    const netToReachTarget = Math.max(0, targetVsol - VIRTUAL_SOL);
    const uncovered = Math.max(0, netToReachTarget - netInCurve);

    return {
      dev,
      bundle,
      devShare,
      bundleShare,
      teamShare,
      float,
      netInCurve,
      progress,
      entryPrice,
      priceAfterDevBuy,
      priceAfterBundle,
      mcAfterDevBuy,
      openMc,
      netToReachTarget,
      uncovered,
      vbPct: priceAfterDevBuy > 0 ? (priceAfterDevBuy - entryPrice) / priceAfterDevBuy : 0,
      solToGraduation: Math.max(0, GRADUATION_SOL - netInCurve),
      concentrated: teamShare * 100 >= CONCENTRATION_PCT,
      declaredExtra: declaredDevShare - devShare,
    };
  }, [devBuySol, bundles, declaredDevShare, targetMcSol]);

  const ladderRows = useMemo(() => {
    const counts = Array.from(new Set([...LADDER, bundles])).sort((a, b) => a - b);
    return counts.map((count) => {
      const b = bundleBuys(count, m.dev.vsolAfter, devBuySol);
      const bundleShare = b.tokens / TOTAL_SUPPLY;
      return {
        count,
        bundleTokens: b.tokens,
        bundleShare,
        teamShare: m.devShare + bundleShare,
        float: Math.max(0, 1 - m.devShare - bundleShare),
      };
    });
  }, [bundles, devBuySol, m.dev.vsolAfter, m.devShare]);

  const presets = [
    { label: "Stealth · 0.5", devBuy: "0.5", bundle: "0" },
    { label: "Conviction · 3", devBuy: "3", bundle: "0" },
    { label: "Bundled team · 4", devBuy: "1", bundle: "4" },
    { label: "Whale snipe · 5", devBuy: "5", bundle: "0" },
    { label: "Graduate it · 85", devBuy: "85", bundle: "0" },
  ];
  const activePreset = presets.find((p) => p.devBuy === devBuyRaw && p.bundle === bundlesRaw)?.label;

  return (
    <div className="mt-6 space-y-3">
      <Alert tone="info" title="Simulation — nothing is built, signed, or sent">
        Every number below is arithmetic over pump.fun&apos;s published curve constants, computed in
        this tab. No RPC call, no wallet, no network request, and no button that spends. The real
        curve has slippage, priority fees and snipers that this model does not price — use it to see
        the shape of your launch, not to promise an outcome.
      </Alert>

      {/* --------------------------------------------------------------- inputs */}
      <Card className="p-4">
        <SectionTitle aside="four inputs, stated defaults">Your launch</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            id="lab-dev-buy"
            label="Dev buy (SOL)"
            hint="Bought in the same transaction as the create. 1% of it leaves as fees before the curve sees it."
          >
            <input
              id="lab-dev-buy"
              name="devBuy"
              className={`${inputClass} tabular`}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              value={devBuyRaw}
              onChange={(e) => setDevBuyRaw(e.target.value)}
            />
          </Field>

          <Field
            id="lab-bundles"
            label="Bundled wallets"
            hint={`Wallets you fund, modelled at the same size as the dev buy (${devBuySol} SOL each) buying right after you.`}
          >
            <input
              id="lab-bundles"
              name="bundles"
              className={`${inputClass} tabular`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={bundlesRaw}
              onChange={(e) => setBundlesRaw(e.target.value)}
            />
          </Field>

          <Field
            id="lab-dev-pct"
            label="Dev's total supply (%)"
            hint="What you expect to end up holding: the buy plus anything reserved for you. The model compares it with what the curve buy really returns."
          >
            <input
              id="lab-dev-pct"
              name="devPct"
              className={`${inputClass} tabular`}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.5}
              value={devPctRaw}
              onChange={(e) => setDevPctRaw(e.target.value)}
            />
          </Field>

          <Field
            id="lab-target-mc"
            label="Initial market cap target (SOL)"
            hint={`The curve opens at ~${m.openMc.toFixed(2)} SOL by construction, so targets below that are already true.`}
          >
            <input
              id="lab-target-mc"
              name="targetMc"
              className={`${inputClass} tabular`}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={targetMcRaw}
              onChange={(e) => setTargetMcRaw(e.target.value)}
            />
          </Field>

          <Field
            id="lab-sol-usd"
            label="SOL price in USD (optional)"
            hint="Only converts the market cap to dollars. Left empty, every figure stays in SOL."
          >
            <input
              id="lab-sol-usd"
              name="solUsd"
              className={`${inputClass} tabular`}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              placeholder="e.g. 150"
              value={solUsdRaw}
              onChange={(e) => setSolUsdRaw(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant={activePreset === p.label ? "primary" : "secondary"}
              aria-pressed={activePreset === p.label}
              onClick={() => {
                setDevBuyRaw(p.devBuy);
                setBundlesRaw(p.bundle);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* ---------------------------------------------------- computed numbers */}
      <section aria-labelledby="lab-numbers">
        <SectionTitle aside={`entry ${nanosol(m.entryPrice)}`}>
          <span id="lab-numbers">What the curve does with your buy</span>
        </SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Tokens received for the dev buy"
            value={compact(m.dev.tokens)}
            hint={`${Math.round(m.dev.tokens).toLocaleString("en-US")} of ${TOTAL_SUPPLY.toLocaleString("en-US")} supply, after the 1% buy fee (${m.dev.net.toFixed(4)} SOL reaches the curve).`}
          />
          <Stat
            label="Effective entry price"
            value={nanosol(m.entryPrice)}
            hint={`What you pay per token on average: net SOL in the curve divided by tokens out, not the price printed after your own buy.`}
          />
          <Stat
            label="Price after the dev buy"
            value={nanosol(m.priceAfterDevBuy)}
            hint={
              bundles > 0
                ? `Your bundle lifts it further, to ${nanosol(m.priceAfterBundle)}.`
                : "The price the next buyer pays — your own buy is what moved it there."
            }
          />
          <Stat
            label="Market cap at that price"
            value={sol(m.mcAfterDevBuy, 2)}
            hint={
              solUsd > 0
                ? `≈ ${usd(m.mcAfterDevBuy * solUsd)} at $${solUsd.toLocaleString("en-US")}/SOL. Price x the full 1,000,000,000 supply.`
                : "Price x the full supply. Add a SOL price above to see dollars — and note that with a billion tokens the MC in SOL is numerically the price in nSOL."
            }
          />
          <Stat
            label="SOL still needed for graduation"
            value={sol(m.solToGraduation, 2)}
            hint={`${m.netInCurve.toFixed(2)} SOL of the ${GRADUATION_SOL} SOL threshold is in the curve. Threshold only — real graduations can differ.`}
          />
          <Stat
            label="Dev's share of supply after the buy"
            value={asPct(m.devShare)}
            hint={
              m.declaredExtra > 0
                ? `You declared ${asPct(declaredDevShare)}: the buy accounts for ${asPct(m.devShare)}, so the other ${asPct(m.declaredExtra)} has to come from supply the curve does not show.`
                : `You declared ${asPct(declaredDevShare)} — the buy already returns more than you planned, which is worth a second look.`
            }
          />
        </div>
      </section>

      {/* ----------------------------------------------------- graduation bar */}
      <Card className="p-4">
        <SectionTitle aside={`${m.netInCurve.toFixed(2)} / ${GRADUATION_SOL} SOL net in the curve`}>
          Graduation progress
        </SectionTitle>
        <div
          role="progressbar"
          aria-label={`Progress toward the ${GRADUATION_SOL} SOL graduation threshold`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number((m.progress * 100).toFixed(2))}
          aria-valuetext={`${(m.progress * 100).toFixed(2)} percent`}
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div
            className="h-full rounded-full bg-[#5e6ad2] transition-[width] duration-300"
            style={{ width: `${Math.max(m.progress * 100, 0.5)}%` }}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/60 tabular">
          {(m.progress * 100).toFixed(2)}% raised. {sol(m.solToGraduation, 2)} of buying by other
          people still has to arrive before the coin graduates into the reserved{" "}
          {compact(LIQUIDITY_RESERVE, 0)} tokens of liquidity. The dev buy and the bundle are not
          outside money — they are your own SOL, and they count toward this bar anyway.
        </p>
      </Card>

      {/* -------------------------------------------------------- market cap target */}
      <Card className="p-4">
        <SectionTitle aside={`model opens at ${sol(m.openMc, 2)} MC`}>Market cap target</SectionTitle>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-white/60">
          {targetMcSol <= m.openMc ? (
            <p>
              The curve prices the token at {nanosol(priceAt(VIRTUAL_SOL))} before anyone trades —
              that is the virtual 30 SOL over 1,073,000,000 tokens against a 1,000,000,000 supply, a{" "}
              {sol(m.openMc, 2)} market cap. A target at or below it needs no buying at all; it is
              where the coin starts.
            </p>
          ) : m.uncovered <= 0 ? (
            <p>
              Your dev buy alone clears this target: it puts the price at{" "}
              {nanosol(m.priceAfterDevBuy)}, a {sol(m.mcAfterDevBuy, 2)} market cap. The curve needed
              about {m.netToReachTarget.toFixed(2)} SOL of net buying to get there and your{" "}
              {m.netInCurve.toFixed(2)} SOL covers it.
            </p>
          ) : (
            <p>
              Reaching {sol(targetMcSol, 2)} MC needs roughly{" "}
              <span className="tabular">{m.netToReachTarget.toFixed(2)} SOL</span> of net buying in
              the curve. You and your bundle supply {m.netInCurve.toFixed(2)} SOL of that, so about{" "}
              <span className="tabular">{m.uncovered.toFixed(2)} SOL</span> has to come from other
              people — and those buyers pay a higher price than you did. That gap is the whole
              business model of a launch, and it is also the risk: the model cannot tell you whether
              the buying shows up.
            </p>
          )}
          {solUsd > 0 ? (
            <p className="text-xs text-white/40 tabular">
              {sol(targetMcSol, 2)} ≈ {usd(targetMcSol * solUsd)} at ${solUsd.toLocaleString("en-US")}
              /SOL.
            </p>
          ) : null}
        </div>
      </Card>

      {/* ------------------------------------------------------- bundled wallets */}
      <Card className="p-4">
        <SectionTitle aside={`${bundles} wallet${bundles === 1 ? "" : "s"}`}>
          Bundled wallets
        </SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          Assumption: each bundled wallet buys the same amount as your dev buy ({devBuySol} SOL),
          after you, in order — so each one gets fewer tokens than the one before it. Effective float
          is the supply neither you nor the bundle holds, i.e. what strangers actually get to buy.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Dev + bundle hold"
            value={asPct(m.teamShare)}
            hint={`${asPct(m.devShare)} dev + ${asPct(m.bundleShare)} across ${bundles} wallet${bundles === 1 ? "" : "s"}.`}
          />
          <Stat
            label="Effective float"
            value={asPct(m.float)}
            hint="Everything a stranger can buy before the coin graduates."
          />
          <Stat
            label="Bundle SOL into the curve"
            value={sol(m.bundle.net, 2)}
            hint="Your own SOL, but it still counts toward the graduation bar."
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm" aria-label="Holdings and float as the bundle grows">
            <caption className="sr-only">
              How the dev and bundle share of supply, and the effective float, change with each extra
              bundled wallet.
            </caption>
            <thead>
              <tr className="text-left text-xs text-white/40">
                <th scope="col" className="py-2 pr-3 font-normal">
                  Wallets
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Bundle tokens
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Dev + bundle
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Effective float
                </th>
                <th scope="col" className="py-2 font-normal">
                  Read
                </th>
              </tr>
            </thead>
            <tbody>
              {ladderRows.map((r) => (
                <tr
                  key={r.count}
                  className={`border-t border-white/10 ${r.count === bundles ? "bg-white/[0.04]" : ""}`}
                >
                  <th scope="row" className="py-2 pr-3 text-left font-normal tabular">
                    {r.count}
                    {r.count === bundles ? <span className="sr-only"> (your setting)</span> : null}
                  </th>
                  <td className="py-2 pr-3 text-white/60 tabular">{compact(r.bundleTokens)}</td>
                  <td className="py-2 pr-3 text-white/60 tabular">{asPct(r.teamShare)}</td>
                  <td className="py-2 pr-3 text-white/60 tabular">{asPct(r.float)}</td>
                  <td className="py-2">
                    {r.teamShare * 100 >= CONCENTRATION_PCT ? (
                      <Badge tone="warn">concentrated</Badge>
                    ) : (
                      <Badge tone="ok">spread</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Threshold for the flag: <span className="tabular">{CONCENTRATION_PCT}%</span> of the{" "}
          {TOTAL_SUPPLY.toLocaleString("en-US")} supply held by the dev plus the bundle — 1.5× the
          10% single-holder line screeners mark amber. Under it a bundle still front-runs strangers;
          over it, the dev and the bundle are the coin.
        </p>
      </Card>

      {/* ------------------------------------------------------------- risk panel */}
      <Card className="p-4">
        <SectionTitle aside="a model, not a promise">Who can dump first</SectionTitle>

        {m.concentrated ? (
          <div className="mt-3">
            <Alert tone="warn" title="This bundle makes the launch look concentrated">
              The dev slice plus {bundles} bundled wallet{bundles === 1 ? "" : "s"} is{" "}
              {asPct(m.teamShare)} of supply — at or above the {CONCENTRATION_PCT}% line this tab
              flags. Holders see one wallet at launch and {bundles} unknown-funded wallets behind it:
              anyone who checks will read that as a coordinated exit.
            </Alert>
          </div>
        ) : null}

        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-white/60">
          <li>
            You buy first, so you hold the cheapest tokens in the pool. Your effective entry of{" "}
            <span className="tabular">{nanosol(m.entryPrice)}</span> is{" "}
            <span className="tabular">{asPct(m.vbPct, 1)}</span> below the price your own buy leaves
            behind — that gap is the head start, and it is also what a sniper has to buy through
            before you are level.
          </li>
          <li>
            {bundles > 0 ? (
              <>
                Every bundled wallet buys after you and before the public, at the next best prices,
                together holding {asPct(m.bundleShare)}. They can exit into exactly the same fills
                you can, which is why a bundle is read as one seller with several addresses.
              </>
            ) : (
              <>
                With no bundle, everything bought after you is someone else&apos;s money. You are the
                only holder who bought below market — and therefore the first person able to sell
                without a loss.
              </>
            )}
          </li>
          <li>
            You declared {asPct(declaredDevShare)} of supply, while the curve buy returns{" "}
            {asPct(m.devShare)}.{" "}
            {m.declaredExtra > 0 ? (
              <>
                The remaining {asPct(m.declaredExtra)} has to exist somewhere — a reserved wallet, an
                additional bundle, a locked allocation. If it is not visible on the curve, holders
                cannot price it, and whoever holds it can sell into the same pool as everyone else.
              </>
            ) : (
              <>
                The buy already returns more than you planned, so part of what you meant to reserve
                is being bought on the curve instead.
              </>
            )}
          </li>
          <li>
            {sol(m.solToGraduation, 2)} of net buying by strangers still has to arrive for the coin to
            graduate. That buying is the only thing between your entry and the pool being seeded with
            the reserved {compact(LIQUIDITY_RESERVE, 0)} tokens — someone has to be the exit
            liquidity, and this model does not assume it is you.
          </li>
          <li>
            Not modelled: slippage on the way in, priority fees, sniper bots, and any fee change at
            pump.fun. The numbers are an estimate from published constants — treat them as a shape,
            never as a promise, and check the current parameters before spending anything.
          </li>
        </ul>
      </Card>

      {/* ------------------------------------------------------------ assumptions */}
      <Card className="p-4">
        <SectionTitle aside="what a number can be traced to">Assumptions</SectionTitle>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {(
            [
              ["Total supply", `${TOTAL_SUPPLY.toLocaleString("en-US")} tokens`],
              ["Sold on the curve", `${CURVE_SUPPLY.toLocaleString("en-US")} tokens`],
              ["Reserved for liquidity", `${LIQUIDITY_RESERVE.toLocaleString("en-US")} tokens`],
              ["Virtual SOL reserve", `${VIRTUAL_SOL} SOL`],
              ["Virtual token reserve", `${VIRTUAL_TOKENS.toLocaleString("en-US")} tokens`],
              ["Invariant k", `${K.toLocaleString("en-US")} (reserve SOL × reserve tokens, fixed)`],
              ["Buy fee", `${BUY_FEE_BPS / 100}% of every buy — a 1 SOL buy puts 0.99 SOL in the curve`],
              ["Graduation threshold", `${GRADUATION_SOL} SOL of real SOL in the curve`],
              ["Concentration flag", `${CONCENTRATION_PCT}% of supply between the dev and the bundle`],
              ["Curve shape", "constant product, so price = reserve SOL / reserve tokens"],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 border-t border-white/10 pt-2 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-white/40">{k}</dt>
              <dd className="font-mono text-white/60 tabular sm:text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          Everything above runs in this tab: no network call is made on this page, and none of these
          controls touches your wallet.
        </p>
      </Card>
    </div>
  );
}
