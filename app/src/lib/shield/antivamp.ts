/**
 * Anti-vamp analysis — the arithmetic behind the Shield tab.
 *
 * Ported from what grindcore.fun's own #/shield view publishes (captured in _research/TAB-SPECS.md):
 *   - "Characters people actually compare at each end: 4"  → a lead+tail window, not the whole address
 *   - "72 · Solid"                                         → a score badge over that window
 *   - "A vamp needs ~128T keys to fake what holders see"    → 58^8 = 1.28e14, their own number
 *   - attacker table: laptop 10K/s → 406 y, one GPU 30M/s → 49.4 d, 8-GPU farm 2B/s → 17.8 h
 *   - "Raise the cost 58× per character. 4+4 → 5+4 multiplies a vamp's work by 58."
 *
 * Everything here is pure and unit-tested, because a score that cannot be reproduced is a score
 * nobody should trust. The verdict is entropy-based: bits = comparedCharacters × log2(58), so the
 * badge reads the actual search space rather than a hand-picked constant.
 */

/** Characters possible in base58 (Bitcoin alphabet — no 0, O, I, l). */
export const BASE58_SIZE = 58;
export const BITS_PER_CHAR = Math.log2(BASE58_SIZE); // ≈ 5.858

/** Assumed attacker speeds, the same three grindcore states. Named so the UI can print them. */
export const ATTACKERS = [
  { name: "Laptop browser", keysPerSecond: 10_000 },
  { name: "One GPU", keysPerSecond: 30_000_000 },
  { name: "8-GPU farm", keysPerSecond: 2_000_000_000 },
] as const;

export type Verdict = "Weak" | "Solid" | "Fortified";

export type AntiVampAnalysis = {
  /** How many characters at each end the reader is comparing. */
  lead: number;
  tail: number;
  /** lead + tail — the window a copy has to reproduce. */
  compared: number;
  /** 58^compared: the average number of keypairs a copy needs. */
  keysNeeded: number;
  /** compared × log2(58) — the honest measure of how much work that is. */
  bits: number;
  /** 0–100 over the compared window. */
  score: number;
  verdict: Verdict;
  /** Human-readable key count, e.g. "128.0T". */
  keysLabel: string;
  /** Per-attacker time to reproduce this window. */
  costs: { name: string; keysPerSecond: number; seconds: number; label: string }[];
  /** The one-line read for holders. */
  headline: string;
  /** The gain from adding one more compared character, as their page states it (58×). */
  nextCharMultiplier: number;
};

const round = (n: number, places = 1) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Compact large numbers: 1.28e14 → "128.0T". */
export function formatKeys(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n < 1_000) return String(Math.round(n));
  const units: [number, string][] = [
    [1e15, "Qa"],
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) return `${round(n / size)}${suffix}`;
  }
  return String(Math.round(n));
}

/** Seconds → their style: "406 y", "49.4 d", "17.8 h", "2.6 min", "9.8 s".
 *  Their table rounds whole numbers once the unit is years above 100 (406 y, 909 y) but keeps one
 *  decimal below that (14.2 y, 49.4 d, 17.8 h), so the rule is applied here rather than guessed. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "never";
  if (seconds < 1) return "instant";
  if (seconds < 60) return `${round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${round(hours)} h`;
  const days = hours / 24;
  if (days < 365) return `${round(days)} d`;
  const years = days / 365;
  return `${years >= 100 ? Math.round(years) : round(years)} y`;
}

/**
 * Analysis for a given window. `lead` and `tail` are clamped to at least 1 each and to the length of
 * the address when one is supplied, because "compare 4 at each end" of a 6-character string is not
 * four characters at each end.
 */
export function analyseAntiVamp(lead = 4, tail = 4, address?: string): AntiVampAnalysis {
  const max = address ? Math.max(1, Math.floor(address.length / 2)) : Number.POSITIVE_INFINITY;
  const leadClamped = Math.max(1, Math.min(Math.floor(lead), max === Number.POSITIVE_INFINITY ? 12 : max));
  const tailClamped = Math.max(1, Math.min(Math.floor(tail), max === Number.POSITIVE_INFINITY ? 12 : max));
  const compared = leadClamped + tailClamped;

  const keysNeeded = BASE58_SIZE ** compared;
  const bits = compared * BITS_PER_CHAR;
  const score = Math.max(0, Math.min(100, Math.round((bits / 64) * 100)));
  const verdict: Verdict = bits >= 55 ? "Fortified" : bits >= 40 ? "Solid" : "Weak";

  const costs = ATTACKERS.map((a) => {
    const seconds = keysNeeded / a.keysPerSecond;
    return { name: a.name, keysPerSecond: a.keysPerSecond, seconds, label: formatDuration(seconds) };
  });

  return {
    lead: leadClamped,
    tail: tailClamped,
    compared,
    keysNeeded,
    bits: round(bits, 2),
    score,
    verdict,
    keysLabel: formatKeys(keysNeeded),
    costs,
    headline: `A copy needs about ${formatKeys(keysNeeded)} keypairs to fake the ${compared} characters holders actually compare.`,
    nextCharMultiplier: BASE58_SIZE, // their published figure: one more compared character = 58×
  };
}

export type CharComparison = {
  /** Per-character match flags for the compared windows, in reading order. */
  chars: { char: string; matches: boolean; side: "lead" | "tail" }[];
  matched: number;
  compared: number;
  /** Same address string, ignoring nothing. */
  identical: boolean;
  /** Same first and last `lead`/`tail` characters but a different middle — the classic vamp. */
  looksLikeACopy: boolean;
};

/** Compare a suspect address against yours over the compared windows only. */
export function compareAddresses(
  mine: string,
  suspect: string,
  lead = 4,
  tail = 4,
  ignoreCase = false,
): CharComparison {
  const a = ignoreCase ? mine.toLowerCase() : mine;
  const b = ignoreCase ? suspect.toLowerCase() : suspect;
  const leadN = Math.min(lead, a.length, b.length);
  const tailN = Math.min(tail, a.length, b.length);

  const chars: CharComparison["chars"] = [];
  let matched = 0;

  for (let i = 0; i < leadN; i++) {
    const m = a[i] === b[i];
    if (m) matched++;
    chars.push({ char: suspect[i] ?? "", matches: m, side: "lead" });
  }
  for (let i = 0; i < tailN; i++) {
    const m = a[a.length - 1 - i] === b[b.length - 1 - i];
    if (m) matched++;
    chars.push({ char: suspect[suspect.length - 1 - i] ?? "", matches: m, side: "tail" });
  }

  const compared = leadN + tailN;
  const identical = a === b;
  return {
    chars,
    matched,
    compared,
    identical,
    looksLikeACopy: !identical && compared > 0 && matched === compared,
  };
}
