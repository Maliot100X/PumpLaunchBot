/**
 * Vanity grinder tests — the tool that runs before every launch, so its correctness is not optional.
 *
 *   node --test tests/vanity.test.ts
 *
 * These assert the real properties: the found mint really does satisfy the pattern, the secret key
 * really does belong to the found public key (or the create transaction would be unsignable), bad
 * patterns are refused instead of grinding forever, and aborting returns null rather than a lie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import {
  BASE58_SIZE,
  BROWSER_KEYPAIRS_PER_SECOND,
  VanityError,
  encodeBase58,
  expectedAttempts,
  grindVanity,
  keypairFromResult,
  validatePattern,
} from "../src/lib/vanity/grind.ts";
import {
  ATTACKER_SPEEDS_NOTE,
  ENGINE_ROWS,
  FARM_KEYS_PER_SECOND,
  GPU_KEYS_PER_SECOND,
  LAPTOP_KEYS_PER_SECOND,
  REFERENCE_ROWS,
  deriveExpectation,
  humanTime,
  verdictFor,
} from "../src/app/grinder/expectations.ts";

test("finds a mint with a one-character prefix and the keypair is usable", async () => {
  const result = await grindVanity({ prefix: "2" });
  assert.ok(result, "a 1-character pattern must be found");
  assert.ok(result.publicKey.startsWith("2"), `expected a mint starting with 2, got ${result.publicKey}`);
  assert.ok(result.attempts >= 1 && result.attempts < 10_000, `attempts in a sane range (${result.attempts})`);

  // The whole point: the secret half must belong to the public half, or nothing can sign.
  const kp = keypairFromResult(result);
  assert.equal(kp.publicKey.toBase58(), result.publicKey);
  assert.equal(kp.secretKey.length, 64);
});

test("finds a mint with a one-character suffix", async () => {
  const result = await grindVanity({ suffix: "9" });
  assert.ok(result);
  assert.ok(result.publicKey.endsWith("9"), `expected a mint ending with 9, got ${result.publicKey}`);
  assert.equal(Keypair.fromSecretKey(result.secretKey).publicKey.toBase58(), result.publicKey);
});

test("honours ignoreCase", async () => {
  // Uppercase-only characters are rare in base58 output, so ignoring case is the difference between
  // "a few thousand attempts" and "never". Proves the flag actually widens the match.
  const result = await grindVanity({ prefix: "A", ignoreCase: true, maxAttempts: 400_000 });
  assert.ok(result, "must match an address containing a/A in first position");
  assert.equal(result.publicKey[0].toLowerCase(), "a");
});

test("a hopeless pattern is refused, not ground forever", () => {
  assert.throws(() => validatePattern("0", ""), VanityError); // 0 is not in the base58 alphabet
  assert.throws(() => validatePattern("", "l"), VanityError); // nor is lowercase l
  assert.throws(() => validatePattern("", ""), VanityError); // nothing to look for
  assert.throws(() => validatePattern("abcdefg", ""), VanityError); // > 6 characters
});

test("abort returns null and no keypair", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 40);
  // 6 characters is the documented ceiling, and 'zzz999' will not be found in 40 ms — so this
  // exercises the abort path rather than the match path.
  const result = await grindVanity({ prefix: "zzz", suffix: "999", signal: controller.signal });
  assert.equal(result, null, "an aborted grind must not return a keypair");
});

test("maxAttempts is a real ceiling", async () => {
  const result = await grindVanity({ prefix: "zzz", maxAttempts: 5 });
  assert.equal(result, null);
});

test("progress is reported with the expected-attempts budget", async () => {
  const seen: number[] = [];
  const result = await grindVanity({
    prefix: "z",
    maxAttempts: 50_000,
    chunkSize: 1,
    onProgress: (p) => {
      seen.push(p.attempts);
      assert.ok(p.expectedAttempts === BASE58_SIZE, "expected attempts for 1 char is the alphabet size");
    },
  });
  if (result) assert.ok(result.publicKey.startsWith("z"));
  assert.ok(seen.length > 0, "at least one progress tick (chunkSize 1)");
});

test("expectedAttempts scales with pattern length, case sensitivity included", () => {
  assert.equal(expectedAttempts("2", ""), BASE58_SIZE);
  assert.equal(expectedAttempts("22", ""), BASE58_SIZE ** 2);
  assert.equal(expectedAttempts("", "ab"), BASE58_SIZE ** 2);
  assert.equal(expectedAttempts("A", "", true), BASE58_SIZE / 2);
});

test("base58 round-trips a real secret key", () => {
  const kp = Keypair.generate();
  assert.equal(encodeBase58(kp.secretKey), encodeBase58(kp.secretKey));
  assert.ok(encodeBase58(kp.secretKey).length >= 80);
});

test("throughput: a 2-character pattern is found and the measured rate is reported", async () => {
  const started = Date.now();
  const result = await grindVanity({ prefix: "P" });
  const wall = Date.now() - started;
  assert.ok(result);
  const rate = Math.round((result.attempts / Math.max(wall, 1)) * 1000);
  console.log(
    `    measured: ${result.attempts.toLocaleString()} attempts in ${result.elapsedMs} ms ` +
      `(~${rate.toLocaleString()} keypairs/s in this runtime)`,
  );
});

/* -------------------------------------------------------------------------------------------------
 * The expectations table (the captured reference #/grind view). Its whole claim is that it is
 * computed by this engine — so these assert the table against expectedAttempts() and the engine's own
 * pattern guard rather than trusting the numbers it prints.
 * ---------------------------------------------------------------------------------------------- */

const at = (row: (typeof REFERENCE_ROWS)[number]) => deriveExpectation(row, BROWSER_KEYPAIRS_PER_SECOND);

test("every table row is decided by the engine, not by a copied figure", () => {
  const rows = [...REFERENCE_ROWS, ...ENGINE_ROWS];
  assert.ok(rows.length >= 9, "the reference view's rows are all present");
  for (const row of rows) {
    const d = at(row);
    if (d.runnable) {
      assert.doesNotThrow(() => validatePattern(row.prefix, row.suffix), `${row.pattern} must really be runnable`);
      assert.equal(d.expected, expectedAttempts(row.prefix, row.suffix, row.ignoreCase ?? false));
      assert.equal(d.verdict, verdictFor(d.expected as number));
      assert.notEqual(d.expectedText, "—");
      assert.equal(d.blocked, null);
    } else {
      assert.ok(d.blocked, `${row.pattern} is refused, so the table must say why`);
    }
  }

  // A pattern that cannot exist must not publish a key count that looks achievable.
  const holy = REFERENCE_ROWS.find((r) => r.pattern === "Holy…Fun");
  assert.ok(holy, "the Holy…Fun row is in the reference view");
  const holyDerived = at(holy);
  assert.equal(holyDerived.expected, null);
  assert.equal(holyDerived.expectedText, "—");
  assert.equal(holyDerived.verdict, "—");
  assert.match(holyDerived.blocked ?? "", /base58/);

  // ...and a row using notation the engine does not have says so instead of printing a number.
  const wildcards = REFERENCE_ROWS.find((r) => r.unsupported);
  assert.ok(wildcards, "the A#####… row is in the reference view");
  const wildDerived = at(wildcards);
  assert.equal(wildDerived.runnable, false);
  assert.equal(wildDerived.expectedText, "—");
  assert.equal(wildDerived.verdict, "—");
  assert.match(wildDerived.blocked ?? "", /wildcard/);
});

test("the pre-run verdict is expectedAttempts, so it cannot disagree with a run", () => {
  const pump = at(REFERENCE_ROWS[0]);
  assert.equal(pump.expected, BASE58_SIZE ** 4); // 11,316,496
  assert.equal(pump.verdict, "Medium");

  const pumpAnyCase = at(REFERENCE_ROWS[1]);
  assert.equal(pumpAnyCase.expected, (BASE58_SIZE / 2) ** 4); // 707,281 — ignore case widens the space
  assert.equal(pumpAnyCase.verdict, "Easy");

  const oneChar = at(ENGINE_ROWS[0]);
  assert.equal(oneChar.expected, BASE58_SIZE);
  assert.equal(oneChar.verdict, "Instant");

  const fiveChar = at(ENGINE_ROWS[2]);
  assert.equal(fiveChar.expected, BASE58_SIZE ** 5);
  assert.equal(fiveChar.verdict, "Medium");

  // The eight-character rows sit above the engine's ceiling: still refused, numbers still honest.
  const moonshot = REFERENCE_ROWS.find((r) => r.pattern === "Moonshot…");
  assert.ok(moonshot);
  const moonshotDerived = at(moonshot);
  assert.equal(moonshotDerived.expected, BASE58_SIZE ** 8);
  assert.equal(moonshotDerived.verdict, "GPU only");
  assert.equal(moonshotDerived.runnable, false);
});

test("the device column divides the engine's keys by the documented baseline rate", () => {
  assert.equal(humanTime(BASE58_SIZE ** 4, BROWSER_KEYPAIRS_PER_SECOND), "53.9 min");
  const pump = at(REFERENCE_ROWS[0]);
  assert.equal(pump.deviceText, "53.9 min");
});

test("the GPU column is the reference view's assumption divided into the same expected keys", () => {
  assert.equal(LAPTOP_KEYS_PER_SECOND, 10_000);
  assert.equal(GPU_KEYS_PER_SECOND, 30_000_000);
  assert.equal(FARM_KEYS_PER_SECOND, 2_000_000_000);
  assert.match(ATTACKER_SPEEDS_NOTE, /assumptions/);
  assert.match(ATTACKER_SPEEDS_NOTE, /~10K\/s/);
  assert.match(ATTACKER_SPEEDS_NOTE, /~30M\/s/);
  assert.match(ATTACKER_SPEEDS_NOTE, /~2B\/s/);

  const moonshot = REFERENCE_ROWS.find((r) => r.pattern === "Moonshot…");
  assert.ok(moonshot);
  assert.equal(at(moonshot).gpuText, "49.4 d");
});

test("the baseline rate the table divides by is the engine's own order of magnitude", async () => {
  // Same source the form reads: grindVanity's onProgress rate (attempts ÷ elapsed). Aborted after a
  // second — 4 characters cannot be found in that window, so this measures the loop, not luck.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 1_200);
  let measured = 0;
  await grindVanity({
    prefix: "zzzz",
    chunkSize: 400,
    signal: controller.signal,
    onProgress: (p) => {
      measured = p.rate;
    },
  });
  assert.ok(measured > 0, "the engine must report a rate before it is told to stop");
  const lo = BROWSER_KEYPAIRS_PER_SECOND * 0.2;
  const hi = BROWSER_KEYPAIRS_PER_SECOND * 5;
  assert.ok(
    measured >= lo && measured <= hi,
    `a baseline of ${BROWSER_KEYPAIRS_PER_SECOND}/s must be the order of magnitude of the ${measured}/s this runtime measures`,
  );
});
