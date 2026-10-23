/**
 * Pimlico on Solana — gas sponsorship (SOL fee payer). Tested live with the project's key:
 *
 *   endpoint   https://solana.pimlico.io/v1/mainnet/rpc?apikey=…
 *   SDK        @solana/kora 0.2.1 (KoraClient) — built on @solana/kit 6
 *   getPayerSigner -> pimXbt2GBQQGvZyDrxcKjepQ4JWZ7maqhvrqKYm3uQC   (the paymaster fee payer)
 *   getSupportedTokens -> USDC EPjFWdd5… and USDT Es9vMFrza…          (pay gas in an SPL token)
 *
 * What it does and does NOT do, measured from the docs and the live calls:
 *   - It sponsors the TRANSACTION FEE. The paymaster becomes the fee payer, the user (or the
 *     treasury) signs, @solana/kora submits, the paymaster signs as fee payer and broadcasts.
 *   - It does NOT pay account RENT. A pump.fun create needs ~3,342,480 lamports of rent for the
 *     mint, the bonding curve and the token accounts — that still comes from the treasury.
 *
 * Integration note, deliberately not wired into the launch path yet: the pump SDK builds with
 * @solana/web3.js 1.x, while Kora works on @solana/kit 6 transactions. Swapping the fee payer
 * therefore means converting the create transaction between the two stacks — a change that must
 * be done with a passing simulation behind it, not blind. This module exposes the live status so
 * the UI/bot can show what is available today.
 */

export type PimlicoStatus = {
  configured: boolean;
  endpoint: string | null;
  payerSigner: string | null;
  supportedFeeTokens: string[];
  /** True when the key answered; false with a reason when it did not. */
  reachable: boolean;
  error: string | null;
};

export function pimlicoApiKey(): string | null {
  return process.env.PIMLICO_API_KEY?.trim() || null;
}

export function pimlicoUrl(): string | null {
  const key = pimlicoApiKey();
  return key ? `https://solana.pimlico.io/v1/mainnet/rpc?apikey=${key}` : null;
}

type KoraClientLike = {
  getPayerSigner: () => Promise<{ signer_address?: string; payment_address?: string }>;
  getSupportedTokens: () => Promise<{ tokens?: string[] }>;
};

/**
 * Live status probe. Never throws: a dead key is reported as a status with the reason, because
 * "gas sponsorship unavailable, here is why" is what the UI needs.
 */
export async function getPimlicoStatus(): Promise<PimlicoStatus> {
  const key = pimlicoApiKey();
  const url = pimlicoUrl();
  if (!key || !url) {
    return {
      configured: false,
      endpoint: null,
      payerSigner: null,
      supportedFeeTokens: [],
      reachable: false,
      error: "PIMLICO_API_KEY is not set",
    };
  }

  try {
    const { KoraClient } = await import("@solana/kora");
    const client = new KoraClient({ rpcUrl: url }) as unknown as KoraClientLike;
    const [signer, tokens] = await Promise.all([client.getPayerSigner(), client.getSupportedTokens()]);
    return {
      configured: true,
      endpoint: url.replace(key, "pim_***"),
      payerSigner: signer.signer_address ?? signer.payment_address ?? null,
      supportedFeeTokens: tokens.tokens ?? [],
      reachable: true,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      endpoint: url.replace(key, "pim_***"),
      payerSigner: null,
      supportedFeeTokens: [],
      reachable: false,
      error: err instanceof Error ? err.message : "unknown Pimlico error",
    };
  }
}
