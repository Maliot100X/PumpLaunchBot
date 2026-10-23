import { Transaction } from "@solana/web3.js";

/**
 * The transaction size ceiling, in bytes.
 *
 * From OTC's own integration docs (scraped, not guessed): combining pump's `create_v2` with the two
 * fee-sharing instructions lands at roughly **1,280 bytes against a 1,232 limit and always fails**.
 * Their prescribed shape — which this project already uses — is create in one transaction and the
 * fee-sharing instructions in another.
 *
 * That shape is easy to break by accident later: someone adds one more instruction, or a bigger
 * metadata URI, and the failure only shows up as a rejected simulation on mainnet. So every builder
 * that produces a transaction passes it through here first, and an oversized transaction is refused
 * with a message that names the cause instead of failing opaquely at submit time.
 */
export const MAX_TRANSACTION_BYTES = 1232;

export class TransactionTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionTooLargeError";
  }
}

/**
 * Serialised size of an unsigned transaction, exactly as it would be submitted.
 *
 * web3.js enforces the 1,232-byte packet limit inside `serialize()` and throws rather than returning
 * an oversized buffer, so a plain call cannot be used to *measure* an oversized transaction. This
 * takes the size out of that error instead, which keeps the number reportable.
 */
export function transactionSize(tx: Transaction): number {
  try {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  } catch (err) {
    const m = /Transaction too large: (\d+) > (\d+)/.exec((err as Error).message ?? "");
    if (m) return Number(m[1]);
    throw err;
  }
}

/**
 * Throws when a transaction cannot fit in a Solana packet.
 * `what` is used in the message so the caller knows which transaction is the problem.
 */
export function assertTxFits(tx: Transaction, what: string): number {
  const size = transactionSize(tx);
  if (size > MAX_TRANSACTION_BYTES) {
    throw new TransactionTooLargeError(
      `${what} serialises to ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit — split it ` +
        `into separate transactions (pump's create and its fee-sharing instructions must not share one)`,
    );
  }
  return size;
}
