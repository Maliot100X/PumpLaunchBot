import { KoraClient } from "@solana/kora";
const apiKey = process.env.PIMLICO_API_KEY;
if (!apiKey) throw new Error("PIMLICO_API_KEY missing");
const rpcUrl = `https://solana.pimlico.io/v1/mainnet/rpc?apikey=${apiKey}`;
const client = new KoraClient({ rpcUrl }) as unknown as Record<string, unknown>;
console.log("methods:", Object.keys(client).join(", "));
for (const m of ["getPayerSigner", "getSupportedTokens", "getConfig", "getPaymentInstruction", "estimateTransactionFee"]) {
  const fn = client[m];
  if (typeof fn !== "function") { console.log(`  ${m}: not available`); continue; }
  try {
    const res = await (fn as (...a: unknown[]) => Promise<unknown>).call(client, ...(m === "getPaymentInstruction" ? [{}] : m === "estimateTransactionFee" ? ["", undefined] : []));
    console.log(`  ${m}: OK -> ${JSON.stringify(res).slice(0, 300)}`);
  } catch (e) {
    console.log(`  ${m}: FAILED -> ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
}
