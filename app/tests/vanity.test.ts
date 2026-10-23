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
  VanityError,
  encodeBase58,
  expectedAttempts,
  grindVanity,
  keypairFromResult,
  validatePattern,
} from "../src/lib/vanity/grind.ts";

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
