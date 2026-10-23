"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

/**
 * Wallet layer (Phase 2). Client-only.
 *
 * RPC comes from NEXT_PUBLIC_SOLANA_RPC_URL when set (Helius, verified live in Phase 1/2);
 * it falls back to the public cluster so a fresh clone still renders — the launch flow
 * refuses to build a transaction without a real RPC configured.
 */
export function SolanaProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => {
    const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
    if (configured && configured.length > 0) return configured;
    const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || "mainnet-beta") as
      | "mainnet-beta"
      | "devnet"
      | "testnet";
    return clusterApiUrl(cluster);
  }, []);

  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
