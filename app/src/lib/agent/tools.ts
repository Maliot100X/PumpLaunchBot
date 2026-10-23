/**
 * Phase 6 — the tools the in-repo bot can actually call.
 *
 * Every tool is a thin wrapper over the SAME server code the dashboard uses, so the bot cannot
 * do anything the UI cannot, and the two can never drift. Tools return plain data; they never
 * sign, never send, and never read a private key except through the treasury module's own gate
 * (which requires TREASURY_LIVE=true AND live:true to send anything).
 */

import { getTreasuryStatus } from "../treasury";
import { getFullTokenSnapshot } from "../tokens/snapshot";
import { lifecycleFeed, searchTracker } from "../tokens/solanatracker";
import { pinImageFromUrl, pinTokenMetadata } from "../pinata";
import { runSponsoredLaunch } from "../pump/sponsored";
import { resolveSplit, TOTAL_BPS, MAX_SHAREHOLDERS } from "../pump/fee-sharing";
import { tokenLinks } from "../links";
import { getPimlicoStatus } from "../pimlico";

export type ToolResult = { ok: boolean; data?: unknown; error?: string };

/** OpenAI-style function definitions handed to the model. */
export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_vault_status",
      description:
        "Read the platform treasury: address, live SOL balance, rent needed per sponsored launch, and how many sponsored launches the balance can actually pay for.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_fee_logic",
      description:
        "Explain and return the creator-fee split rules: the configured basis points, the treasury-only case when no fee receiver is given, and the on-chain constraints.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "lookup_token",
      description:
        "Look up any Solana token by mint: real name, symbol, description, image and links (on-chain metadata) plus market data.",
      parameters: {
        type: "object",
        properties: { mint: { type: "string", description: "base58 mint address" } },
        required: ["mint"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_tokens",
      description: "Search Solana tokens by name or symbol using the tracker index.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "lifecycle_feed",
      description:
        "Get the current launch feed: newest coins, coins about to graduate and coins that graduated.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pin_metadata",
      description:
        "Pin a token image and its metadata JSON to IPFS and return the uri that a launch requires. Nothing is launched by this call.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          symbol: { type: "string" },
          description: { type: "string" },
          imageUrl: { type: "string", description: "public image URL (e.g. a media.pollinations.ai link)" },
          twitter: { type: "string" },
          website: { type: "string" },
        },
        required: ["name", "symbol", "description", "imageUrl"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "prepare_sponsored_launch",
      description:
        "Build and SIMULATE a platform-sponsored launch with the treasury as payer and signer. Returns the transaction, the simulation result, the fee split and the real pump.fun links. It only sends when live sending is enabled in the environment AND live=true is passed.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          symbol: { type: "string" },
          uri: { type: "string", description: "IPFS metadata URI from pin_metadata" },
          feeReceiver: {
            type: "string",
            description: "wallet that receives the user's share; omit and the treasury keeps 100%",
          },
          live: { type: "boolean", description: "explicit request to send (still gated by the env)" },
        },
        required: ["name", "symbol", "uri"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_gas_sponsorship",
      description: "Report Pimlico's Solana gas-sponsorship status (fee payer address and tokens).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Execute one tool call. Errors are returned as data, never thrown, so the model can explain a
 * failure instead of the whole request dying.
 */
export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_vault_status": {
        const status = await getTreasuryStatus();
        return { ok: true, data: status };
      }
      case "get_fee_logic": {
        const treasury = (await getTreasuryStatus()).address ?? "unconfigured";
        const withReceiver = resolveSplit({ feeReceiver: "So11111111111111111111111111111111111111112", platformTreasury: treasury });
        const withoutReceiver = resolveSplit({ feeReceiver: undefined, platformTreasury: treasury });
        return {
          ok: true,
          data: {
            defaultSplitBps: withReceiver.shares,
            noReceiverSplitBps: withoutReceiver.shares,
            totalBps: TOTAL_BPS,
            maxShareholders: MAX_SHAREHOLDERS,
            permanence:
              "update_fee_shares_v2 can be called once and revokes the admin, so the split is permanent",
            onChainInstructions: ["createFeeSharingConfig", "updateFeeSharesV2"],
            note: "creator fees stay on the curve until swept (transfer_creator_fees_to_pump_v2) and paid out (distribute_creator_fees_v2)",
          },
        };
      }
      case "lookup_token": {
        const mint = str(args, "mint");
        if (!mint) return { ok: false, error: "mint is required" };
        const token = await getFullTokenSnapshot(mint);
        return { ok: true, data: { ...token, links: tokenLinks(mint) } };
      }
      case "search_tokens": {
        const query = str(args, "query");
        if (!query) return { ok: false, error: "query is required" };
        const results = await searchTracker(query);
        return { ok: true, data: results.slice(0, 10) };
      }
      case "lifecycle_feed": {
        const feed = await lifecycleFeed();
        return {
          ok: true,
          data: {
            latestCount: feed.latest.length,
            graduatingCount: feed.graduating.length,
            graduatedCount: feed.graduated.length,
            newest: feed.latest.slice(0, 10).map((t) => ({ mint: t.mint, name: t.name, symbol: t.symbol })),
          },
        };
      }
      case "pin_metadata": {
        const name = str(args, "name");
        const symbol = str(args, "symbol");
        const imageUrl = str(args, "imageUrl");
        if (!name || !symbol || !imageUrl) return { ok: false, error: "name, symbol and imageUrl are required" };
        const image = await pinImageFromUrl(imageUrl);
        const metadata = await pinTokenMetadata({
          name,
          symbol,
          description: str(args, "description") ?? "",
          imageUri: image.uri,
          twitter: str(args, "twitter"),
          website: str(args, "website"),
        });
        return { ok: true, data: { image, metadata } };
      }
      case "prepare_sponsored_launch": {
        const name = str(args, "name");
        const symbol = str(args, "symbol");
        const uri = str(args, "uri");
        if (!name || !symbol || !uri) return { ok: false, error: "name, symbol and uri are required" };
        const plan = await runSponsoredLaunch({
          name,
          symbol,
          uri,
          feeReceiver: str(args, "feeReceiver"),
          live: args.live === true,
        });
        return { ok: true, data: plan };
      }
      case "get_gas_sponsorship": {
        return { ok: true, data: await getPimlicoStatus() };
      }
      default:
        return { ok: false, error: `unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "tool failed" };
  }
}
