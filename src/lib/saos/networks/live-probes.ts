/**
 * LIVE READ-ONLY NETWORK PROBES (Task 13 — live-proof).
 *
 * Purpose: prove — honestly — which networks are reachable for READ-ONLY
 * checks right now. This is level-2 liveness ("רשתות חיות לקריאה בלבד"):
 *   - READ ONLY: no transaction, no broadcast, no signing, no wallet, no
 *     state change of any kind on any network. Ever.
 *   - KEYLESS ONLY: well-known public endpoints (or an env-configured RPC
 *     that carries no embedded credentials — safeRpcUrl refuses keyed URLs).
 *     Endpoints constants carry no secrets; RPC URLs are never echoed —
 *     hostname only.
 *   - SHORT TIMEOUT: 2.5s per endpoint; BLURT tries its candidates in order.
 *   - NEVER THROWS: every failure resolves into an honest ok:false result
 *     with a reason. "Not attempted" and "attempted but unreachable" are
 *     distinct, labeled states — data is never invented.
 *   - OPT-IN BY CALLER: the default /status computation stays zero-live-calls
 *     (Task 12 contract). Only /api/saos/live-proof (and the explicit
 *     /status?probe=1) invoke these. Results are cached 60s so the public
 *     endpoints are never hammered.
 */

import type { NetworkName } from "../network-status";
import { probeEthereumReadonly, ethereumReadRpcCandidate, ethereumRpcStatus } from "./ethereum";
import { probeSolanaReadonly, solanaReadRpcCandidate, solanaRpcStatus } from "./solana";

/** one live read-only probe result — public chain data only */
export interface LiveProbeResult {
  network: NetworkName;
  /** false when the probe was skipped entirely (nothing to try) */
  attempted: boolean;
  /** true only when a read succeeded against a live endpoint */
  ok: boolean;
  /** where the read went: env-configured RPC, a well-known public fallback, or none */
  source: "env" | "public-fallback" | "none";
  /** hostname only — never the full URL, never credentials */
  sourceHost: string | null;
  /** last head/slot/block number when readable (public data) */
  headBlock: number | null;
  /** ethereum eth_chainId hex when readable (public data) */
  chainIdHex: string | null;
  /** graphene head block time when readable (public data) */
  headTime: string | null;
  latencyMs: number | null;
  /** honest human-readable outcome — never invented data */
  reason: string;
}

/** well-known KEYLESS public read endpoints — rotation (roast 51, the Task-50
 *  ETH doctrine applied to the remaining chains): a single hardcoded endpoint
 *  made "network dead" an intermittent lie (publicnode 403'd solo; trongrid
 *  429-storms are proven on this env). All candidates below answered LIVE
 *  2026-09-10 with fresh heads:
 *  STEEM  steemit 109449504 · steem.fans 109449504 · justyy 109449504 · boylikegirl 109449505
 *  HIVE   hive.blog 109784074 · deathwing 109784074 · openhive 109784075
 *         (hive-api.arcange.eu FAILED live — excluded, never a dead name)
 *  TRON   trongrid 86115748 · tronstack 86115750
 *  BLURT  beblurt + saboin alive (Task 39); world/btsd/coruscant DEAD (kept
 *         as trailing fallbacks — reached only if both live endpoints fail) */
const GRAPHENE_ENDPOINTS: Record<"STEEM" | "BLURT" | "HIVE", string[]> = {
  STEEM: ["https://api.steemit.com", "https://api.steem.fans", "https://api.justyy.com", "https://steemapi.boylikegirl.club"],
  BLURT: [
    "https://rpc.beblurt.com",
    "https://blurt-rpc.saboin.com",
    "https://rpc.blurt.world",
    "https://rpc.blurt.btsd.io",
    "https://blurt-rpc.coruscant.io"
  ],
  HIVE: ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"]
};
const TRON_ENDPOINTS = ["https://api.trongrid.io", "https://api.tronstack.io"];

const PROBE_TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 60_000;

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** one condenser read against one endpoint — null on any failure, never throws */
async function grapheneReadOnce(
  url: string
): Promise<{ headBlock: number; headTime: string | null } | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store"
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { head_block_number?: unknown; time?: unknown } };
    const head = data?.result?.head_block_number;
    if (typeof head !== "number") return null;
    return { headBlock: head, headTime: typeof data?.result?.time === "string" ? (data.result.time as string) : null };
  } catch {
    return null;
  }
}

/** STEEM / BLURT / HIVE — condenser head block, candidates tried in order */
async function probeGraphene(network: "STEEM" | "BLURT" | "HIVE"): Promise<LiveProbeResult> {
  const candidates = GRAPHENE_ENDPOINTS[network];
  const started = Date.now();
  for (const url of candidates) {
    const read = await grapheneReadOnce(url);
    if (read !== null) {
      return {
        network,
        attempted: true,
        ok: true,
        source: "public-fallback",
        sourceHost: hostOf(url),
        headBlock: read.headBlock,
        chainIdHex: null,
        headTime: read.headTime,
        latencyMs: Date.now() - started,
        reason: `קריאה-בלבד הצליחה (condenser_api.get_dynamic_global_properties ← ${hostOf(url)}) — בלוק ראש ${read.headBlock}`
      };
    }
  }
  return {
    network,
    attempted: true,
    ok: false,
    source: "public-fallback",
    sourceHost: null,
    headBlock: null,
    chainIdHex: null,
    headTime: null,
    latencyMs: Date.now() - started,
    reason: `קריאה נכשלה/פסק-זמן מול כל ה-endpoints הציבוריים (${candidates.length}) — הרשת אינה מאומתת חי כרגע (לא נחסם, לא הומצא)`
  };
}

/** TRON — solidity head block via keyless public endpoint */
async function probeTron(): Promise<LiveProbeResult> {
  const started = Date.now();
  for (const url of TRON_ENDPOINTS) {
    try {
      const res = await fetch(`${url}/walletsolidity/getnowblock`, {
        method: "GET",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: "no-store"
      });
      if (res.ok) {
        const data = (await res.json()) as { block_header?: { raw_data?: { number?: unknown } } };
        const num = data?.block_header?.raw_data?.number;
        if (typeof num === "number") {
          return {
            network: "TRON",
            attempted: true,
            ok: true,
            source: "public-fallback",
            sourceHost: hostOf(url),
            headBlock: num,
            chainIdHex: null,
            headTime: null,
            latencyMs: Date.now() - started,
            reason: `קריאה-בלבד הצליחה (getnowblock ← ${hostOf(url)}) — בלוק סולידיטי ראש ${num}`
          };
        }
      }
    } catch {
      // next candidate — trongrid 429 must never fake a dead TRON chain (roast 51)
    }
  }
  return {
    network: "TRON",
    attempted: true,
    ok: false,
    source: "public-fallback",
    sourceHost: null,
    headBlock: null,
    chainIdHex: null,
    headTime: null,
    latencyMs: Date.now() - started,
    reason: "קריאה נכשלה/פסק-זמן מול ה-endpoint הציבורי — הרשת אינה מאומתת חי כרגע (לא נחסם, לא הומצא)"
  };
}

/** ETHEREUM — env RPC when configured, else the well-known keyless public fallback */
async function probeEthereumLive(): Promise<LiveProbeResult> {
  const configured = ethereumRpcStatus() !== "not-configured";
  // reuse the Task-12 probe with fallback enabled — it already never throws
  const eth = await probeEthereumReadonly({ allowPublicFallback: true });
  return {
    network: "ETHEREUM",
    attempted: eth.probed,
    ok: eth.ok,
    source: configured ? "env" : eth.probed ? "public-fallback" : "none",
    sourceHost: eth.sourceHost,
    headBlock: eth.blockNumber !== null ? safeHexToNumber(eth.blockNumber) : null,
    chainIdHex: eth.chainId,
    headTime: null,
    latencyMs: null,
    reason: eth.reason
  };
}

/** SOLANA — env RPC when configured, else the well-known keyless public fallback */
async function probeSolanaLive(): Promise<LiveProbeResult> {
  const configured = solanaRpcStatus() !== "not-configured";
  const sol = await probeSolanaReadonly({ allowPublicFallback: true });
  return {
    network: "SOLANA",
    attempted: sol.probed,
    ok: sol.ok,
    source: configured ? "env" : sol.probed ? "public-fallback" : "none",
    sourceHost: sol.sourceHost,
    headBlock: sol.slot,
    chainIdHex: null,
    headTime: null,
    latencyMs: null,
    reason: sol.reason
  };
}

/** hex quantity (0x…) → number, or null — never throws, never guesses */
function safeHexToNumber(hex: string): number | null {
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    const n = Number.parseInt(hex, 16);
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/** the probe plan (for disclosure) — hostnames only, never URLs with credentials */
export function liveProbePlan(): { network: NetworkName; source: "env" | "public-fallback" | "none"; host: string | null }[] {
  const ethConfigured = ethereumRpcStatus() !== "not-configured";
  const solConfigured = solanaRpcStatus() !== "not-configured";
  return [
    { network: "STEEM", source: "public-fallback", host: hostOf(GRAPHENE_ENDPOINTS.STEEM[0]) },
    { network: "BLURT", source: "public-fallback", host: hostOf(GRAPHENE_ENDPOINTS.BLURT[0]) },
    { network: "HIVE", source: "public-fallback", host: hostOf(GRAPHENE_ENDPOINTS.HIVE[0]) },
    { network: "TRON", source: "public-fallback", host: hostOf(TRON_ENDPOINTS[0]) },
    { network: "ETHEREUM", source: ethConfigured ? "env" : "public-fallback", host: hostOf(ethereumReadRpcCandidate()) },
    { network: "SOLANA", source: solConfigured ? "env" : "public-fallback", host: hostOf(solanaReadRpcCandidate()) }
  ];
}

let probeCache: { at: number; results: LiveProbeResult[] } | null = null;

/** run ALL 6 read-only probes in parallel (60s cache) — never throws */
export async function runLiveNetworkProbes(): Promise<{ results: LiveProbeResult[]; cached: boolean; at: string }> {
  if (probeCache && Date.now() - probeCache.at < CACHE_TTL_MS) {
    return { results: probeCache.results, cached: true, at: new Date(probeCache.at).toISOString() };
  }
  const [steem, blurt, hive, tron, ethereum, solana] = await Promise.all([
    probeGraphene("STEEM"),
    probeGraphene("BLURT"),
    probeGraphene("HIVE"),
    probeTron(),
    probeEthereumLive(),
    probeSolanaLive()
  ]);
  const results = [steem, blurt, hive, tron, ethereum, solana];
  probeCache = { at: Date.now(), results };
  return { results, cached: false, at: new Date(probeCache.at).toISOString() };
}
