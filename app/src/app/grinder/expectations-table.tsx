import { Badge, Card, Panel, SectionTitle } from "@/components/ui";
import {
  ATTACKER_SPEEDS_NOTE,
  ENGINE_ROWS,
  REFERENCE_ROWS,
  deriveRows,
  rateLabel,
  type ExpectationRow,
} from "./expectations";

/**
 * The pre-run expectations table (captured reference #/grind view), with every number computed by
 * this repo's engine — see expectations.ts for the arithmetic and the sources of each column.
 *
 * Layout note: the table is wide by nature (five columns of numbers), so it scrolls inside its own
 * container rather than pushing the page sideways on a 390px phone. The container is focusable so
 * it can be scrolled from the keyboard too.
 */

const GROUPS: { title: string; rows: ExpectationRow[] }[] = [
  { title: "The reference view's rows, recomputed by this engine", rows: REFERENCE_ROWS },
  { title: "Where Instant and Medium actually sit for this engine", rows: ENGINE_ROWS },
];

const VERDICT_TONE = {
  Instant: "ok",
  Easy: "ok",
  Medium: "warn",
  "GPU only": "neutral",
  "—": "neutral",
} as const;

/** The reference view's three reassurances, each stated as what this tab actually does. */
const CLAIMS = [
  {
    title: "Keys made in your browser",
    line: "Every keypair is generated and matched in this tab's own loop. No key material is uploaded, and the secret key is never stored for you.",
  },
  {
    title: "Standard keypair files",
    line: "A result downloads as the standard 64-byte Solana keypair array — the same file solana-keygen and any wallet import.",
  },
  {
    title: "Nothing hidden",
    line: "These figures come from the grinder's own expectedAttempts() and a rate measured on this device, not from a marketing number.",
  },
];

export function ExpectationsTable({ rate, measured }: { rate: number; measured: boolean }) {
  return (
    <Card className="p-4">
      <SectionTitle aside={rateLabel(rate, measured)}>Expected effort, before you run</SectionTitle>
      <p className="mt-1 text-[11px] leading-relaxed text-white/45">
        &ldquo;Average keys&rdquo; is what expectedAttempts() in the grinder asks for — the same figure the
        progress bar budgets against — and the device column divides it by the rate named above. A row this
        engine refuses is marked with the engine&apos;s own words; it stays in the table so nothing looks
        supported when it is not.
      </p>

      <div
        role="region"
        aria-label="Expected effort by pattern"
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded-md border border-white/10"
      >
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr className="bg-white/[0.02] text-[11px] text-white/40">
              <th scope="col" className="px-3 py-2 font-medium">
                Pattern
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Average keys
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                On this device
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                One GPU
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Verdict
              </th>
            </tr>
          </thead>
          {GROUPS.map((group) => (
            <tbody key={group.title}>
              <tr className="border-t border-white/10">
                <th
                  scope="colgroup"
                  colSpan={5}
                  className="px-3 py-2 text-left text-[11px] font-normal text-white/40"
                >
                  {group.title}
                </th>
              </tr>
              {deriveRows(group.rows, rate).map((row, i) => (
                <tr key={`${group.title}-${i}`} className="border-t border-white/10 align-top">
                  <td className="px-3 py-2">
                    <span className="font-mono text-white/85">{row.pattern}</span>
                    {row.blocked ? (
                      <span className="mt-1 block text-[11px] leading-snug text-amber-300">{row.blocked}</span>
                    ) : null}
                    {row.note ? (
                      <span className="mt-1 block text-[11px] leading-snug text-white/40">{row.note}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono tabular text-white/70">{row.expectedText}</td>
                  <td className="px-3 py-2 font-mono tabular text-white/70">{row.deviceText}</td>
                  <td className="px-3 py-2 font-mono tabular text-white/70">{row.gpuText}</td>
                  <td className="px-3 py-2">
                    <Badge tone={VERDICT_TONE[row.verdict as keyof typeof VERDICT_TONE] ?? "neutral"}>
                      {row.verdict}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="mt-3 space-y-1.5">
        <p className="text-[11px] leading-relaxed text-white/45">{ATTACKER_SPEEDS_NOTE}</p>
        <p className="text-[11px] leading-relaxed text-white/45">
          The GPU column is that assumption divided into the same expected keys — no GPU was run for this
          table. The device column is the one column measured in a browser: {rateLabel(rate, measured)}.
          Verdicts are the form&apos;s own ladder: Instant ≤ 100K keys · Easy ≤ 10M · Medium ≤ 10B · above
          that only a GPU, or their 8-GPU farm, has an opinion.
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {CLAIMS.map((claim) => (
          <Panel key={claim.title} title={claim.title} line={claim.line} />
        ))}
      </div>
    </Card>
  );
}
