import { getPimlicoStatus } from "../src/lib/pimlico.ts";
import { getTrackerToken, latestLaunches, lifecycleFeed } from "../src/lib/tokens/solanatracker.ts";

const pim = await getPimlicoStatus();
console.log("Pimlico:", pim.reachable ? `OK payer=${pim.payerSigner} feeTokens=${pim.supportedFeeTokens.length}` : `FAILED ${pim.error}`);

const bonk = await getTrackerToken("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
console.log("Tracker token:", bonk ? `${bonk.name} (${bonk.symbol}) image:${bonk.image ? "yes" : "no"}` : "null");

const latest = await latestLaunches(5);
console.log("latest launches:", latest.length);
console.log("sample keys:", latest[0] ? Object.keys(latest[0]).slice(0, 10).join(",") : "none");

const feed = await lifecycleFeed();
console.log(`lifecycle: latest=${feed.latest.length} graduating=${feed.graduating.length} graduated=${feed.graduated.length}`);
const first = feed.latest[0] ?? latest[0];
console.log("first entry:", first ? JSON.stringify({ mint: first.mint, name: first.name, symbol: first.symbol }).slice(0, 160) : "none");
