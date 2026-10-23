/**
 * Phase 2 smoke test — proves the Pinata pinning path end to end.
 * Run:  node --env-file=.env.local scripts/pinata-smoke.ts
 */
import { pinTokenMetadata } from "../src/lib/pinata.ts";

const pinned = await pinTokenMetadata({
  name: "PumpLaunchBot Smoke Test",
  symbol: "PLBSMOKE",
  description: "Pinned by the PumpLaunchBot build to verify the metadata path. Safe to ignore.",
  imageUri: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
  website: "https://example.com",
});

console.log("pinned cid:", pinned.cid);
console.log("ipfs uri  :", pinned.ipfsUri);
console.log("gateway   :", pinned.uri);
console.log("bytes     :", pinned.size);

const back = await fetch(pinned.uri);
const text = await back.text();
const parsed = JSON.parse(text) as { name?: string; symbol?: string };
console.log("read back :", back.status, "| name:", parsed.name, "| symbol:", parsed.symbol);
console.log(back.ok && parsed.symbol === "PLBSMOKE" ? "PINATA SMOKE: PASS" : "PINATA SMOKE: FAIL");
