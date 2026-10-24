/**
 * Grinder expectations — the pre-run table the captured reference view (#/grind) publishes, with
 * every number recomputed by THIS engine instead of copied from theirs.
 *
 * The rule this file exists to keep: the table must be unable to disagree with the grinder. So the
 * "average keys" figure is `expectedAttempts()` and the runnability of a row is decided by the
 * engine's own validator (`patternRefusal`) — the same two functions a real run uses. Nothing here
 * re-states the alphabet size, the case-folding rule or the 6-character ceiling, so none of them can
 * drift.
 *
 * Kept free of JSX on purpose: the markup lives in expectations-table.tsx, and this module is plain
 * enough for `node --test tests/vanity.test.ts` to assert it against the engine.
 *
 * Sources, labelled as honestly as the view labels them:
 *  - "on this device"  → measured here, from the engine's own progress rate (see BROWSER_KEYPAIRS_PER_SECOND)
 *  - "one GPU"         → an ASSUMPTION from the reference view, never measured here (see ATTACKER_SPEEDS_NOTE)
 */
import {
  BASE58_ALPHABET,
  BROWSER_KEYPAIRS_PER_SECOND,
  expectedAttempts,
  patternRefusal,
} from "../../lib/vanity/grind.ts";

/** The reference view's own note, verbatim: every GPU-shaped figure below rests on it. */
export const ATTACKER_SPEEDS_NOTE =
  "Attacker speeds are assumptions: laptop browser ~10K/s, one GPU ~30M/s, 8-GPU farm ~2B/s.";

/** The three attacker speeds their note names. None of these were measured in this repo. */
export const LAPTOP_KEYS_PER_SECOND = 10_000;
export const GPU_KEYS_PER_SECOND = 30_000_000;
export const FARM_KEYS_PER_SECOND = 2_000_000_000;

export type ExpectationRow = {
  /** How the reference view writes the pattern. */
  pattern: string;
  prefix: string;
  suffix: string;
  ignoreCase?: boolean;
  /** Set when the pattern uses notation this engine cannot express at all (wildcards). */
  unsupported?: string;
  /** Why the row is in the table — shown small under the pattern. */
  note?: string;
};

/**
 * The reference view's published rows, translated into engine parameters.
 *
 * Two of them are deliberately kept even though this engine cannot run them: `Holy…Fun` contains
 * `l`, which is not in base58 (no address can ever match it), and `A#####…` uses the `#` wildcard,
 * which the engine has no notion of (the tab searches one literal prefix/suffix pair per run).
 * Both are marked rather than quietly dropped, so nobody reads the other rows as "the tab supports
 * wildcards".
 */
export const REFERENCE_ROWS: ExpectationRow[] = [
  { pattern: "…pump", prefix: "", suffix: "pump", note: "the familiar launch suffix" },
  {
    pattern: "…pump, any case",
    prefix: "",
    suffix: "pump",
    ignoreCase: true,
    note: "ignore case — the checkbox in the form above",
  },
  { pattern: "Moon…", prefix: "Moon", suffix: "" },
  { pattern: "moon…", prefix: "moon", suffix: "" },
  { pattern: "moon…pump", prefix: "moon", suffix: "pump" },
  { pattern: "Moon…pump", prefix: "Moon", suffix: "pump" },
  { pattern: "Holy…Fun", prefix: "Holy", suffix: "Fun" },
  {
    pattern: "A#####…",
    prefix: "A",
    suffix: "",
    unsupported: "# and * wildcards are not in this engine — one literal prefix/suffix pair per run",
  },
  { pattern: "Moonshot…", prefix: "Moonshot", suffix: "" },
];

/**
 * Rows that pin the ends of the verdict scale for THIS engine. The reference view's rows all land
 * on Easy/Medium/GPU-only under a 1-in-58 model; these three show where Instant actually starts and
 * what a Medium pattern looks like in the same arithmetic.
 */
export const ENGINE_ROWS: ExpectationRow[] = [
  { pattern: "p…", prefix: "p", suffix: "", note: "one character: the engine's floor" },
  {
    pattern: "…pmp, any case",
    prefix: "",
    suffix: "pmp",
    ignoreCase: true,
    note: "three characters, ignore case — still Instant",
  },
  { pattern: "pumpk…", prefix: "pumpk", suffix: "", note: "five characters — Medium, and useful" },
];

/** The verdict ladder the grinder shows, kept here so the table and the form cannot drift apart. */
const VERDICT_LADDER = [
  { max: 1e5, label: "Instant" },
  { max: 1e7, label: "Easy" },
  { max: 1e10, label: "Medium" },
  { max: Infinity, label: "GPU only" },
] as const;

/** Instant ≤ 100K keys · Easy ≤ 10M · Medium ≤ 10B · above that a GPU is the only honest answer. */
export function verdictFor(expected: number): string {
  return VERDICT_LADDER.find((v) => expected <= v.max)?.label ?? "GPU only";
}

/** Whole-run-seconds → readable time. "instant" under a second, never a false sense of speed. */
export function humanTime(expected: number, perSecond: number): string {
  if (!Number.isFinite(expected)) return "never";
  if (!(perSecond > 0)) return "—";
  const s = expected / perSecond;
  if (s < 1) return "instant";
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)} h`;
  if (s < 31_536_000) return `${(s / 86_400).toFixed(1)} d`;
  return `${(s / 31_536_000).toFixed(1)} y`;
}

/** Compact key count: 11.3M, 707K, 128.1T. Underscores nothing — the table is narrow. */
export function formatKeys(expected: number | null): string {
  if (expected === null || !Number.isFinite(expected)) return "—";
  for (const [div, suffix] of [
    [1e15, "Qa"],
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const) {
    if (expected >= div) return `${(expected / div).toFixed(1)}${suffix}`;
  }
  return expected.toLocaleString();
}

/** The rate the table divided by, named in the header so the reader knows what it is. */
export function rateLabel(rate: number, measured: boolean): string {
  const rounded = rate >= 1_000 ? Math.round(rate / 100) * 100 : Math.round(rate);
  const where = measured ? "measured on this device" : "in this browser";
  return `at ~${rounded.toLocaleString()} keys/s ${where}`;
}

/** The default rate: the engine's own measured baseline, until a run measures this device. */
export function baselineRate(measuredRate: number): { rate: number; measured: boolean } {
  return measuredRate > 0
    ? { rate: measuredRate, measured: true }
    : { rate: BROWSER_KEYPAIRS_PER_SECOND, measured: false };
}

export type DerivedExpectation = {
  pattern: string;
  /** expectedAttempts() for the row, or null when the pattern cannot exist (never a guess). */
  expected: number | null;
  expectedText: string;
  /** Time at the rate given to deriveExpectation — the device's own once measured. */
  deviceText: string;
  /** Time at the reference view's assumed one-GPU speed. An assumption, not a measurement. */
  gpuText: string;
  verdict: string;
  /** True when the engine will actually run this pattern in the tab. */
  runnable: boolean;
  /** The engine's own words for why it would refuse, when it would. */
  blocked: string | null;
  note?: string;
};

function containsNonBase58(value: string): string | null {
  for (const ch of value) {
    if (!BASE58_ALPHABET.includes(ch)) return ch;
  }
  return null;
}

export function deriveExpectation(row: ExpectationRow, rate: number): DerivedExpectation {
  if (row.unsupported) {
    return {
      pattern: row.pattern,
      expected: null,
      expectedText: "—",
      deviceText: "—",
      gpuText: "—",
      verdict: "—",
      runnable: false,
      blocked: row.unsupported,
      note: row.note,
    };
  }

  const bad = containsNonBase58(`${row.prefix}${row.suffix}`);
  if (bad) {
    // A character outside base58 means no address can match, so there is no "average keys" to print.
    return {
      pattern: row.pattern,
      expected: null,
      expectedText: "—",
      deviceText: "—",
      gpuText: "—",
      verdict: "—",
      runnable: false,
      blocked: `${patternRefusal(row.prefix, row.suffix) ?? `"${bad}" is not base58`}`,
      note: row.note,
    };
  }

  const expected = expectedAttempts(row.prefix, row.suffix, row.ignoreCase ?? false);
  const refusal = patternRefusal(row.prefix, row.suffix);

  return {
    pattern: row.pattern,
    expected,
    expectedText: formatKeys(expected),
    deviceText: humanTime(expected, rate),
    gpuText: humanTime(expected, GPU_KEYS_PER_SECOND),
    verdict: verdictFor(expected),
    runnable: refusal === null,
    blocked: refusal,
    note: row.note,
  };
}

export function deriveRows(rows: ExpectationRow[], rate: number): DerivedExpectation[] {
  return rows.map((row) => deriveExpectation(row, rate));
}
