/**
 * Shared types for the per-network modules (Task 12 — Ethereum & Solana).
 *
 * Iron rules inherited from network-status.ts:
 *   - read-only computation, zero live calls by default
 *   - every value is a documented constant, an explicit env input, or null
 *   - "not-configured" is a STATE, never an error; nothing is invented
 *   - secrets never enter this layer: RPC URLs are consumed by the probe
 *     functions only, never stored, echoed or logged.
 */

/** chain family of the network */
export type ChainType = "graphene" | "tvm" | "evm" | "solana-runtime";

/** RPC availability state — presence only, NEVER the URL itself */
export type RpcStatus = "not-configured" | "public" | "configured";

/** extra per-network fields beyond the shared NetworkStatusView (Task 12) */
export interface ExtendedNetworkFields {
  /** chain family */
  chainType: ChainType;
  /** chain id / cluster identifier — public constant only; null when unknown */
  chainId: string | null;
  /** possible anchor commitment kinds on this chain (plan vocabulary) */
  anchorTypes: string[];
  /** RPC presence state (never the URL) */
  rpcStatus: RpcStatus;
  /** true when a read-only live probe is possible right now (public/keyless RPC present) */
  liveProbePossible: boolean;
}
