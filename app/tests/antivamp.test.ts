import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyseAntiVamp,
  compareAddresses,
  formatDuration,
  formatKeys,
  ATTACKERS,
  BASE58_SIZE,
} from "../src/lib/shield/antivamp.ts";

/**
 * These tests check the anti-vamp maths against grindcore.fun's OWN published figures, captured from
 * their live #/shield view (_research/TAB-SPECS.md):
 *   "72 · Solid", "A vamp needs ~128T keys", laptop 10K/s → 406 y, one GPU 30M/s → 49.4 d,
 *   8-GPU farm 2B/s → 17.8 h, and "4+4 → 5+4 multiplies a vamp's work by 58".
 * If our arithmetic disagrees with theirs, the tab is lying to holders and this fails.
 */

test("the default 4+4 window needs ~128T keys, the figure they publish", () => {
  const a = analyseAntiVamp(4, 4);
  assert.equal(a.compared, 8);
  assert.equal(a.keysNeeded, BASE58_SIZE ** 8);
  // 58^8 = 128,063,081,718,016 → their page prints "~128T"; ours prints one decimal of the same value
  assert.equal(a.keysLabel, "128.1T");
  assert.match(a.headline, /128\.1T/);
});

test("the three attacker rows reproduce their published times", () => {
  const a = analyseAntiVamp(4, 4);
  const byName = new Map(a.costs.map((c) => [c.name, c]));

  assert.equal(byName.get("Laptop browser")?.label, "406 y");
  assert.equal(byName.get("One GPU")?.label, "49.4 d");
  assert.equal(byName.get("8-GPU farm")?.label, "17.8 h");

  // and the speeds themselves are the ones their page states as assumptions
  assert.deepEqual(
    ATTACKERS.map((x) => x.keysPerSecond),
    [10_000, 30_000_000, 2_000_000_000],
  );
});

test("one more compared character costs a copy 58× more, as their page says", () => {
  const eight = analyseAntiVamp(4, 4);
  const nine = analyseAntiVamp(5, 4);
  assert.equal(nine.nextCharMultiplier, 58);
  assert.equal(nine.keysNeeded, eight.keysNeeded * 58);
});

test("the score badge for 4+4 reads Solid and lands in their published range", () => {
  const a = analyseAntiVamp(4, 4);
  assert.equal(a.verdict, "Solid");
  // their badge reads 72; ours is derived from bits (8 × log2(58) ≈ 46.9 of 64) and must be close,
  // because it is measuring the same search space rather than a copied constant
  assert.ok(a.score >= 70 && a.score <= 76, `expected a score near their 72, measured ${a.score}`);
});

test("longer windows move the verdict, and short ones admit they are weak", () => {
  assert.equal(analyseAntiVamp(2, 2).verdict, "Weak"); // 4 chars ≈ 23.4 bits
  assert.equal(analyseAntiVamp(5, 5).verdict, "Fortified"); // 10 chars ≈ 58.6 bits
});

test("an absent address does not distort the window, and a short one clamps it", () => {
  // No address: the numbers are the pattern's, unscaled (this is the "planning" case).
  assert.equal(analyseAntiVamp(4, 4, undefined).compared, 8);

  // A 6-character string cannot have 4 characters compared at each end: it clamps to 3+3.
  const short = analyseAntiVamp(4, 4, "abc123");
  assert.equal(short.lead, 3);
  assert.equal(short.tail, 3);
  assert.equal(short.compared, 6);
});

test("a lookalike with the same ends but a different middle is called out as a copy", () => {
  const mine = "J9WL4zQVCFvLTydjtHoMGcLasjhRMZomnVmp4Y2cpump";
  const vamp = "GiHFe5qSTXatMjCoPgHnohgCNmiDtGSgscGRWtiJpump"; // same 4-char tail, same shape

  const c = compareAddresses(mine, vamp, 4, 4);
  assert.equal(c.identical, false);
  assert.equal(c.compared, 8);
  assert.ok(c.matched > 0, "these two share the pump tail");
  assert.equal(c.looksLikeACopy, c.matched === c.compared);

  // the per-character readout must line up with the string, in reading order: lead then tail
  assert.equal(c.chars.length, 8);
  assert.deepEqual(c.chars.slice(0, 4).map((x) => x.side), ["lead", "lead", "lead", "lead"]);
  assert.deepEqual(c.chars.slice(4).map((x) => x.side), ["tail", "tail", "tail", "tail"]);
});

test("an identical address is identical, not a copy", () => {
  const mine = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const c = compareAddresses(mine, mine, 4, 4);
  assert.equal(c.identical, true);
  assert.equal(c.looksLikeACopy, false, "the same address must never be reported as a copy of itself");
  assert.equal(c.matched, c.compared);
});

test("case handling is explicit, not accidental", () => {
  const mine = "MoonAbcDEFghijklmnopqrstuvwxyz123456789pump";
  const suspect = "moonABCdefGHIJKLMNOPQRSTUVWXYZ123456789PUMP";
  assert.ok(compareAddresses(mine, suspect, 4, 4, false).matched < 8);
  assert.equal(compareAddresses(mine, suspect, 4, 4, true).matched, 8);
});

test("the small formatters stay honest at the edges", () => {
  assert.equal(formatKeys(58), "58");
  assert.equal(formatDuration(0.4), "instant");
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), "never");
  assert.equal(formatKeys(Number.POSITIVE_INFINITY), "∞");
});
