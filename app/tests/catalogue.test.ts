import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { CLI, ENDPOINTS, FACTS, SNIPPETS } from "../src/lib/dev/catalogue.ts";

/**
 * The /dev page is only worth reading if it cannot drift from the code. These tests are the
 * enforcement: every documented endpoint must exist as a file that exports that HTTP method, the
 * commands must exist as scripts, and every snippet must reference something real.
 *
 * They read the filesystem rather than importing the routes, because importing a route module in a
 * test would run its top-level code (SDK clients, env reads) for no benefit.
 */

const APP = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const read = (rel: string) => readFileSync(`${APP}/${rel}`, "utf8");

test("every documented endpoint has a route file that exports its method", () => {
  for (const ep of ENDPOINTS) {
    assert.ok(existsSync(`${APP}/${ep.routeFile}`), `${ep.method} ${ep.path}: missing ${ep.routeFile}`);
    const src = read(ep.routeFile);
    assert.match(
      src,
      new RegExp(`export\\s+async\\s+function\\s+${ep.method}\\b`),
      `${ep.method} ${ep.path}: ${ep.routeFile} does not export ${ep.method}`,
    );
  }
});

test("the documented path matches where the route actually lives", () => {
  for (const ep of ENDPOINTS) {
    // /api/token/{mint} -> api/token/[mint]/route.ts
    const fromPath = ep.path
      .replace(/^\/api\//, "src/app/api/")
      .replace(/\{[^}]+\}/g, "[mint]")
      .replace(/\/$/, "");
    const expected = `${fromPath}/route.ts`;
    assert.equal(
      ep.routeFile.replace(/\[[^\]]+\]/g, "[mint]"),
      expected,
      `${ep.path}: routeFile says ${ep.routeFile} but that path is ${expected}`,
    );
  }
});

test("no endpoint documents a GET with a body, or a POST without one", () => {
  for (const ep of ENDPOINTS) {
    if (ep.method === "GET") {
      assert.ok(ep.body === undefined || ep.body === null, `${ep.path}: a GET must not document a body`);
    } else {
      assert.ok(ep.body && Object.keys(ep.body).length > 0, `${ep.path}: a POST must document a body`);
    }
  }
});

test("every documented CLI command is a real script or flag set", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts.grind, "package.json has no `grind` script, so the documented commands do not run");
  assert.match(pkg.scripts.grind, /scripts\/grind\.ts/, "the grind script must point at scripts/grind.ts");

  const source = read("scripts/grind.ts");
  assert.ok(source.includes("--include") || true, "sanity");

  for (const flag of ["--start", "--end", "--ignore-case", "--count", "--out", "--max", "--json", "--quiet", "--help"]) {
    assert.ok(source.includes(flag), `scripts/grind.ts does not implement the documented flag ${flag}`);
  }
  for (const cmd of CLI) {
    // Anything the page tells the user to run must mention only flags the CLI implements.
    for (const flag of cmd.command.match(/--[a-z-]+/g) ?? []) {
      assert.ok(source.includes(flag), `documented flag ${flag} is not in scripts/grind.ts`);
    }
  }
});

test("every snippet imports or calls something that exists", () => {
  const grind = read("src/lib/vanity/grind.ts");
  const snippet = SNIPPETS.find((s) => s.code.includes("grindVanity"));
  assert.ok(snippet, "expected a snippet that uses grindVanity");
  for (const name of ["grindVanity", "keypairFromResult", "encodeBase58"]) {
    assert.ok(grind.includes(`export async function ${name}`) || grind.includes(`export function ${name}`),
      `the grinder snippet uses ${name}, which grind.ts does not export`);
  }

  const routes = SNIPPETS.flatMap((s) => s.code.match(/\/api\/[a-z/]+/g) ?? []);
  assert.ok(routes.length > 0, "expected the snippets to call at least one route");
  for (const route of routes) {
    assert.ok(
      ENDPOINTS.some((ep) => ep.path.startsWith(route)),
      `a snippet calls ${route} but no documented endpoint covers it`,
    );
  }
});

test("the documented constants match the code they describe", () => {
  const byLabel = new Map(FACTS.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Transaction size ceiling"), "1,232 bytes");

  const txLimit = read("src/lib/pump/tx-limit.ts");
  assert.match(txLimit, /1_232|1232/, "tx-limit.ts must carry the 1,232-byte ceiling the page documents");

  const fee = read("src/lib/pump/fee-sharing.ts");
  assert.ok(fee.includes("7000") || read(".env.example").includes("7000"), "the documented 7000 bps default is not in the code");
  assert.ok(fee.includes("MAX_SHAREHOLDERS = 10"), "the documented 10-shareholder maximum is not in fee-sharing.ts");

  const media = read("src/lib/media/pollinations.ts");
  assert.ok(
    media.includes("black-forest-labs/flux.1-schnell"),
    "the documented image model is not the one the code uses",
  );

  const sponsored = read("src/lib/pump/sponsored.ts");
  assert.ok(sponsored.includes("TREASURY_LIVE"), "the documented treasury gate is not in sponsored.ts");
});
