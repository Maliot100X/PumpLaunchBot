import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { tokenLinks } from "@/lib/links";
import {
  Alert,
  Badge,
  Button,
  Card,
  LinkButton,
  PageHeader,
  SectionTitle,
  Skeleton,
  Stat,
} from "@/components/ui";
import { CopyAddress } from "./copy-address";

export const metadata: Metadata = {
  title: "Token · PumpLaunchBot",
  description:
    "The platform's own token — and, until it is announced, the plain statement that there is no contract to verify yet, no price and nothing to buy.",
};

/**
 * Token tab — the platform's coin.
 *
 * ============================================================================================
 * THE ONE PLACE TO FILL IN — the only edit this file needs when the token exists:
 *
 *     NEXT_PUBLIC_PLATFORM_TOKEN_MINT=<the platform token's Solana mint>
 *
 *     a base58 address, 32–44 characters, exactly as the launch printed it. Set it in the
 *     deployment environment (and locally in .env.local) and redeploy. Nothing else here changes:
 *     the contract gate below stops saying "Not published yet", prints that address as the
 *     contract address, and the Copy / Vamp Shield / Buy / chart / X actions appear with it.
 *
 *     Optional companion, only to decorate the published gate:
 *     NEXT_PUBLIC_PLATFORM_TOKEN_X=<the official account URL>  — the X button renders only when
 *     it is set; no handle is ever guessed.
 *
 * From the top of this file down to the gate there is no other place an address is written or
 * inferred: one variable, read once, printed once.
 * ============================================================================================
 *
 * Why the empty state is worded the way it is: today the variable is unset, and a placeholder
 * address on this page would be a string a reader could act on — they would paste it into a
 * wallet and buy a coin that is not ours. So while it is unset the page renders NO address, NO
 * price, NO market cap and NO buy link, states "Not published yet" as its primary fact, and says
 * why. The section shape and the "Before you buy" teaching block stay, because teaching people to
 * check an address is what this tab is for — it just has nothing to check yet.
 *
 * Build rules that apply here (both measured, both in this repo's history):
 *  - `export const dynamic = "force-dynamic"` fails the build with nextConfig.cacheComponents on.
 *  - `await connection()` must sit inside a <Suspense> boundary, so the shell (header, teaching
 *    block, drafts) is prerendered and streams immediately while the gate resolves per request.
 *    That per-request read is deliberate: a build made while the variable was empty must never be
 *    served as "not published" after an address exists.
 */

/** A Solana mint: base58 (no 0, O, I, l) and 32–44 characters. Anything else is not an address. */
const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Gate =
  | { state: "unpublished" }
  | { state: "unusable" }
  | { state: "published"; mint: string };

/**
 * Reads the single source of the contract address and decides which state the gate is in.
 * `unusable` exists so a typo'd value cannot reach the screen: a malformed string still looks
 * like an address to a human, which is the worst of both worlds.
 */
function readGate(): Gate {
  const raw = process.env.NEXT_PUBLIC_PLATFORM_TOKEN_MINT?.trim();
  if (!raw) return { state: "unpublished" };
  if (!BASE58_MINT.test(raw)) return { state: "unusable" };
  return { state: "published", mint: raw };
}

/* ------------------------------------------------------------------ the gate, published ---- */

/** Rendered only when a real mint is configured. Every link below is derived from that mint. */
function GatePublished({ mint }: { mint: string }) {
  const links = tokenLinks(mint);
  const account = process.env.NEXT_PUBLIC_PLATFORM_TOKEN_X?.trim();

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          label="Contract published"
          value="published"
          hint="Read from this deployment's environment on this request — not from a hard-coded string."
        />
        <Stat
          label="Contract address"
          value={mint}
          hint="The only address this page publishes. Compare it character by character — start, middle and end — with what Vamp Shield shows."
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyAddress address={mint} />
        <LinkButton href={`/shield?mint=${mint}`} size="sm">
          Check in Vamp Shield
        </LinkButton>
        <LinkButton href={links.pumpFun} size="sm" variant="ghost" external>
          Buy on pump.fun
        </LinkButton>
        <LinkButton href={links.dexScreener} size="sm" variant="ghost" external>
          Chart
        </LinkButton>
        <LinkButton href={links.explorer} size="sm" variant="ghost" external>
          Explorer
        </LinkButton>
        {account ? (
          <LinkButton href={account} size="sm" variant="ghost" external>
            X
          </LinkButton>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-white/40">
        Buying is your own transaction on a public venue. This page holds no key, signs nothing and
        takes no cut of it.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- the gate, unpublished ---- */

function GateUnpublished({ unusable }: { unusable: boolean }) {
  return (
    <div className="mt-3 space-y-3">
      <Alert tone="warn" title="Not published yet">
        There is no platform token, so there is no contract address to verify — and this page will
        not print one anyway. A placeholder address is a string someone can act on: they would paste
        it into a wallet, buy a coin that is not ours, and this tab would be the reason. Until an
        address appears in the Contract address row below, anything claiming to be our token is not
        it.
      </Alert>

      {unusable ? (
        <Alert tone="error" title="A configured value was not an address — ignored">
          A platform token mint is set for this deployment, but it is not a well-formed Solana
          address (base58, 32–44 characters), so it is not printed here. A string that looks like an
          address but cannot be verified is worse than none. Correct the value and rebuild; the gate
          will then publish it.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          label="Contract published"
          value="not published yet"
          hint="This line flips the day a real contract is announced — and not one moment before."
        />
        <Stat
          label="Contract address"
          value="—"
          hint="The one address this page is for. It is filled from the deployment's environment when the token exists; until then it is empty on purpose."
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled title="There is nothing to copy — no address is published yet.">
          Copy address
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled
          title="Vamp Shield needs a mint to check, and there is none yet."
        >
          Check in Vamp Shield
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-white/40">
        No buy link, no price and no market cap are rendered while this is the state — there is
        nothing to buy and nothing to price. When a contract is announced, this gate prints the
        address and the actions next to it switch on in place.
      </p>
    </div>
  );
}

async function ContractGate() {
  await connection(); // decide the gate on every request, never from a prerender frozen while empty
  const gate = readGate();
  const published = gate.state === "published";

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={published ? "ok" : "warn"}>
          {published ? "address published" : "no contract to verify"}
        </Badge>
        <span className="font-mono text-[11px] text-white/35">
          {published ? "source: this deployment" : "source: this deployment, unset"}
        </span>
      </div>

      {gate.state === "published" ? (
        <GatePublished mint={gate.mint} />
      ) : (
        <GateUnpublished unusable={gate.state === "unusable"} />
      )}
    </>
  );
}

function GateSkeleton() {
  return (
    <div className="mt-3 space-y-3">
      <Skeleton className="h-16" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-[4.5rem]" />
        <Skeleton className="h-[4.5rem]" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the teaching block ------ */

const STEPS: { title: string; body: string; href?: string; label?: string }[] = [
  {
    title: "Get the real address",
    body: "Only copy it from this page or the official account — copies run lookalike tokens. A screenshotted address, a DM, a reply under a post: none of those are a source.",
  },
  {
    title: "Check it",
    body: "Paste it in Vamp Shield. If the ends match but the middle does not, it is a copy — the lookalike trick is choosing a mint whose first and last characters are identical.",
    href: "/shield",
    label: "Open Vamp Shield",
  },
  {
    title: "Size it like a memecoin",
    body: "Only money you can afford to lose. Simulate your entry in the Launch Lab before you size anything, and check what your own buy does to the price.",
    href: "/lab",
    label: "Open the Launch Lab",
  },
];

/* ------------------------------------------------------------------- what it's for ------- */

/** Every field is "—" because the owner has announced none of them. Guessing here is the lie. */
const FACTS: { label: string }[] = [
  { label: "Supply and distribution" },
  { label: "Utility in the toolkit" },
  { label: "Where it trades" },
  { label: "Fee sharing, if any" },
  { label: "Announcement" },
];

export default function TokenPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="The community token">
        The token behind the toolkit. Always verify the contract address on this page before you buy
        anything.
      </PageHeader>

      <section className="mt-8">
        <SectionTitle aside="this page is the source">Contract gate</SectionTitle>
        <Suspense fallback={<GateSkeleton />}>
          <ContractGate />
        </Suspense>
      </section>

      <section className="mt-10">
        <SectionTitle aside="3 steps">Before you buy</SectionTitle>
        <ol className="mt-3 space-y-2">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="flex flex-wrap items-start gap-3 p-4">
                <span aria-hidden className="mt-px w-6 shrink-0 font-mono text-xs tabular text-white/40">
                  {`0${i + 1}`}
                </span>
                <div className="min-w-0 flex-1 basis-52">
                  <h3 className="text-sm font-medium">{step.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-white/60">{step.body}</p>
                  {step.href && step.label ? (
                    <LinkButton href={step.href} size="sm" className="mt-2">
                      {step.label}
                    </LinkButton>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <SectionTitle aside={<Badge tone="warn">draft</Badge>}>What it&apos;s for</SectionTitle>

        <div className="mt-3">
          <Alert tone="warn" title="Nothing below is live until it&apos;s announced.">
            The owner has not announced the token&apos;s purpose, supply or economics, so the list
            below is a placeholder with the shape of the answer already in it.
          </Alert>
        </div>

        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
          The intent captured so far is one line: the token behind the toolkit. What exactly that
          means — what it does inside the app, how much of it exists, whether holding it changes
          anything — is not announced, so it is not written here with a confident number attached.
        </p>

        <dl className="mt-3 divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
          {FACTS.map((fact) => (
            <div key={fact.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
              <dt className="text-xs text-white/45">{fact.label}</dt>
              <dd className="ml-auto font-mono text-xs tabular text-white/55">—</dd>
            </div>
          ))}
        </dl>

        <p className="mt-2 text-[11px] leading-relaxed text-white/35">
          — means the owner has not announced it. A guess in that column would be the same lie as a
          placeholder address in the gate above.
        </p>
      </section>

      <p className="mt-10 text-xs leading-relaxed text-white/40">
        Nothing on this page gates a feature: no tab in this app asks you to hold anything. The live
        numbers elsewhere come from the chain and from public APIs, and they do not depend on a
        token.
      </p>
    </div>
  );
}
