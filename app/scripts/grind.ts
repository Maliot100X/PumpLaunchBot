/**
 * `npm run grind` — the vanity mint grinder from the terminal.
 *
 * It calls THE SAME `grindVanity` the Grinder tab calls, so the browser and the CLI cannot drift:
 * one implementation, one set of rules, one validation error.
 *
 * Usage (mirrors the grindcore-style CLI the spec asked for):
 *   node scripts/grind.ts --start moon --end pump
 *   node scripts/grind.ts --end pump --ignore-case --count 3 --out ./keys
 *   node scripts/grind.ts --start A --json
 *   node scripts/grind.ts --start moon --end pump --max 20000000 --json
 *
 * With --out it writes standard 64-byte Solana keypair JSON files, which solana-keygen, Phantom and
 * every other wallet can import. Without --out it prints the address, and the secret only when
 * --json is set, because printing a secret key to a terminal by default is how keys leak into logs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { grindVanity, encodeBase58, expectedAttempts, VanityError } from "../src/lib/vanity/grind.ts";

type Args = {
  start: string;
  end: string;
  ignoreCase: boolean;
  count: number;
  out: string | null;
  json: boolean;
  max: number;
  quiet: boolean;
};

const HELP = `vanity mint grinder — same engine as the Grinder tab

  --start <chars>      base58 prefix the mint must start with
  --end <chars>        base58 suffix the mint must end with
  --ignore-case        compare case-insensitively (widens the search space)
  --count <n>          how many keypairs to find (default 1)
  --out <dir>          write standard keypair JSON files into <dir>
  --max <n>            attempt ceiling per keypair (default 5000000)
  --json               machine-readable output, includes the secret key
  --quiet              no progress lines
  --help               this text

base58 has no 0, O, I or l. A pattern longer than 6 characters is refused: it is
58^7 ≈ 2.2e12 combinations, which is not a thing to run in the foreground.`;

function parse(argv: string[]): Args {
  const args: Args = {
    start: "",
    end: "",
    ignoreCase: false,
    count: 1,
    out: null,
    json: false,
    max: 5_000_000,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--start":
        args.start = argv[++i] ?? "";
        break;
      case "--end":
        args.end = argv[++i] ?? "";
        break;
      case "--ignore-case":
        args.ignoreCase = true;
        break;
      case "--count":
        args.count = Math.max(1, Number(argv[++i] ?? 1) || 1);
        break;
      case "--out":
        args.out = argv[++i] ?? null;
        break;
      case "--max":
        args.max = Math.max(1, Number(argv[++i] ?? 0) || 5_000_000);
        break;
      case "--json":
        args.json = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag ${a}\n\n${HELP}`);
          process.exit(2);
        }
    }
  }
  return args;
}

async function main() {
  const args = parse(process.argv.slice(2));

  if (!args.start && !args.end) {
    console.error(HELP);
    process.exit(2);
  }

  // Fail with the engine's own message, not a re-worded copy of it.
  try {
    const expected = expectedAttempts(args.start, args.end, args.ignoreCase);
    if (!args.quiet && !args.json) {
      console.error(
        `pattern "${args.start}…${args.end}"${args.ignoreCase ? " (ignore case)" : ""}: ` +
          `~${expected.toExponential(1)} keypairs expected, up to ${args.count} to find`,
      );
    }
  } catch (err) {
    console.error(err instanceof VanityError ? err.message : String(err));
    process.exit(1);
  }

  const found: { address: string; secretKey: number[]; attempts: number; elapsedMs: number }[] = [];
  let totalAttempts = 0;
  const started = Date.now();

  while (found.length < args.count) {
    let result;
    try {
      result = await grindVanity({
        prefix: args.start,
        suffix: args.end,
        ignoreCase: args.ignoreCase,
        maxAttempts: args.max,
        onProgress: args.quiet || args.json
          ? undefined
          : (p) =>
              process.stderr.write(
                `\r  ${p.attempts.toLocaleString()} tried · ${p.rate.toLocaleString()}/s · ${(p.elapsedMs / 1000).toFixed(1)}s   `,
              ),
      });
    } catch (err) {
      if (!args.json) process.stderr.write("\n");
      console.error(err instanceof VanityError ? err.message : String(err));
      process.exit(1);
    }

    if (!result) {
      if (!args.json) process.stderr.write("\n");
      console.error(
        `stopped without a match after ${args.max.toLocaleString()} attempts for this keypair — ` +
          `raise --max or shorten the pattern`,
      );
      process.exit(3);
    }

    totalAttempts += result.attempts;
    found.push({
      address: result.publicKey,
      secretKey: Array.from(result.secretKey),
      attempts: result.attempts,
      elapsedMs: result.elapsedMs,
    });

    if (args.out) {
      mkdirSync(args.out, { recursive: true });
      // Standard Solana keypair file: a JSON array of the 64 secret-key bytes.
      const file = join(args.out, `${result.publicKey}.json`);
      writeFileSync(file, JSON.stringify(Array.from(result.secretKey)), { mode: 0o600 });
      if (!args.json) process.stderr.write(`\n  wrote ${file}\n`);
    }
    if (!args.json) {
      process.stderr.write(`\n  found ${result.publicKey} (${result.attempts} attempts, ${result.elapsedMs} ms)\n`);
    }
  }

  const totalMs = Date.now() - started;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          pattern: { start: args.start, end: args.end, ignoreCase: args.ignoreCase },
          count: found.length,
          totalAttempts,
          totalMs,
          rate: totalMs > 0 ? Math.round((totalAttempts / totalMs) * 1000) : 0,
          keys: args.out
            ? found.map(({ address, attempts, elapsedMs }) => ({ address, attempts, elapsedMs }))
            : found.map(({ address, attempts, elapsedMs, secretKey }) => ({
                address,
                attempts,
                elapsedMs,
                // base58 is what a wallet import usually wants; the 64-byte array is the file format.
                secretKeyBase58: encodeBase58(Uint8Array.from(secretKey)),
              })),
          note: args.out
            ? "secret keys were written to files, not printed here"
            : "secret keys are in this output — treat this terminal as sensitive",
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n${found.length} keypair${found.length === 1 ? "" : "s"} found · ${totalAttempts.toLocaleString()} attempts · ` +
        `${(totalMs / 1000).toFixed(2)}s · ${Math.round((totalAttempts / totalMs) * 1000).toLocaleString()}/s`,
    );
  }
}

void main();
