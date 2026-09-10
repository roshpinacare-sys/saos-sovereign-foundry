/**
 * ETHEREUM network module (Task 12) — dry-run only, keyless, honest.
 *
 * Iron rules:
 *   - No transaction, no broadcast, no signing, no wallet use — EVER (the
 *     system prepares data; the owner signs outside; only the public result
 *     (tx hash) ever returns — see docs/external-signer.md).
 *   - Zero live calls by default. The read-only probe below exists, is
 *     explicitly opt-in, short-timeout, keyless-only, and never throws.
 *   - No RPC configured → `not-configured` STATE (no error, no invented data).
 *   - RPC URLs with embedded credentials or key-like query params are refused.
 *     The URL itself is never echoed, stored or logged — hostname only.
 *
 * Anchor commitment vocabulary (plan-only, no execution):
 *   - tx-hash:      the anchor tx hash itself
 *   - calldata-hash: stateRoot/seal-root carried in tx calldata
 *   - memo/log-commitment: commitment inside an event log or memo field
 */

import type { NetworkStatusView } from "../network-status";
import type { ExtendedNetworkFields, RpcStatus } from "./types";

export const ETHEREUM_ANCHOR_TYPES = ["tx-hash", "calldata-hash", "memo/log-commitment"] as const;

export type EthereumStatusView = NetworkStatusView & ExtendedNetworkFields;

/** read-only probe result — public chain data only */
export interface EthereumProbeResult {
  /** false when no keyless RPC is configured (probe not attempted) */
  probed: boolean;
  ok: boolean;
  /** hex chain id as returned by eth_chainId (public) */
  chainId: string | null;
  /** hex block number as returned by eth_blockNumber (public) */
  blockNumber: string | null;
  /** hostname only — never the full URL, never credentials */
  sourceHost: string | null;
  reason: string;
}

/** validated RPC URL or null — refuses credentials and key-like query params */
function safeRpcUrl(): string | null {
  const raw = (process.env.ETH_RPC_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null; // embedded credentials — refuse
    for (const key of [...u.searchParams.keys()]) {
      if (/key|token|secret|auth/i.test(key)) return null; // key in query — refuse
    }
    return raw;
  } catch {
    return null; // unparsable — treat as not-configured, never throw
  }
}

/**
 * Keyless public read candidates (roast 50): a single hardcoded endpoint made
 * "ETH unreachable" an intermittent LIE — publicnode 403'd from this env during
 * Task 49 while the chain itself was fine, and answered again right after.
 * Rotation is the honest fix: try candidates in order, report where it worked.
 * All four answered live 2026-09-10 (eth_chainId → 0x1); llamarpc/ankr/blockpi
 * were rejected (CF-challenge / auth-gated / dead) and are not included.
 */
const ETH_PUBLIC_READ_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://cloudflare-eth.com",
  "https://rpc.flashbots.net",
  "https://eth.drpc.org"
];

/** env RPC first (when valid), then the public keyless candidates — in order */
export function ethereumReadRpcCandidates(): string[] {
  const env = safeRpcUrl();
  return env ? [env, ...ETH_PUBLIC_READ_ENDPOINTS] : [...ETH_PUBLIC_READ_ENDPOINTS];
}

/** RPC presence state (never the URL) */
export function ethereumRpcStatus(): RpcStatus {
  return safeRpcUrl() === null ? "not-configured" : "public";
}

/**
 * Keyless read endpoint for public tx verification: first candidate (env if
 * valid, else public). Callers that need resilience should use
 * ethereumReadRpcCandidates() and rotate. Never carries credentials (safeRpcUrl
 * refuses keyed URLs) — used by verifyTxidPublic for read-only lookups only.
 */
export function ethereumReadRpcCandidate(): string {
  return ethereumReadRpcCandidates()[0]!;
}

/** true when a read-only probe is possible right now */
export function ethereumLiveProbePossible(): boolean {
  return safeRpcUrl() !== null;
}

/** ETH_CHAIN_ID from env — plausible numeric/hex only; null when unset/invalid */
export function ethereumChainIdFromEnv(): string | null {
  const raw = (process.env.ETH_CHAIN_ID ?? "").trim();
  return /^(0x[0-9a-fA-F]+|[1-9]\d*)$/.test(raw) ? raw : null;
}

/**
 * Ethereum status view — computed, honest, dry-run only.
 * `not-configured` is a state, not an error; values are never invented.
 */
export function ethereumStatus(nowIso: string): EthereumStatusView {
  const rpcStatus = ethereumRpcStatus();
  const configured = rpcStatus !== "not-configured";
  const chainId = ethereumChainIdFromEnv();
  const vaultBlocker = "vault: אין מפתחות חתימה בסנדבוקס (חתימה חיצונית בלבד — docs/external-signer.md)";
  const notConfigured = "not-configured: אין ETH_RPC_URL מוגדר — הרשת מוכרת אך לא ניתנת לבדיקת-קריאה";

  return {
    network: "ETHEREUM",
    status: "gated",
    mode: "advisory",
    chainType: "evm",
    chainId,
    anchorTypes: [...ETHEREUM_ANCHOR_TYPES],
    rpcStatus,
    liveProbePossible: configured,
    lastChecked: nowIso,
    lastVerifiedAnchor: null,
    nextAction: configured
      ? "אימות-קריאה אפשרי מול ה-RPC הציבורי (probe אופציונלי); אין שידור — dry-run בלבד עד חותם חיצוני ואישור בעלים"
      : "אין פעולה חיה — הרשת במצב not-configured; הגדרת RPC ציבורי (ללא מפתח) מאפשרת קריאה-בלבד",
    blocker: configured ? vaultBlocker : notConfigured,
    requiredResource: "gas (ETH) לכל עסקת עיגון — מימון חיצוני על-ידי הבעלים בלבד",
    unblockPlan: [
      "1. הגדרת ETH_RPC_URL ציבורי ללא מפתח (קריאה-בלבד) — לעולם לא RPC עם מפתח בקוד/בריפו",
      "2. קריאת-אימות בלבד (eth_chainId / eth_blockNumber — probe אופציונלי)",
      "3. חתימה חיצונית של עסקת עיגון (calldata = stateRoot) מחוץ למערכת",
      "4. רישום התוצאה הציבורית בלבד (tx hash) — PATCH /api/saos/signer"
    ],
    isReadyForAnchor: false,
    isDryRunOnly: true,
    ownerOptions: [
      "השארת אתריום במצב not-configured / dry-run (ברירת-מחדל הבטוחה)",
      "הגדרת RPC ציבורי ללא מפתח לאימות-קריאה בלבד",
      "מימון gas (ETH) + חתימה חיצונית — נדרש אישור בעלים מפורש ולא מבוצע אוטומטית"
    ],
    ownerAction: "להחליט אם להגדיר RPC ציבורי (ללא מפתח) ולממן gas — פעולה כלכלית מחוץ למערכת; המערכת אינה משדרת ואינה חותמת",
    estimatedTime: null,
    estimatedCost: null, // gas price is market data — never invented
    resourceLiveChecked: false
  };
}

/**
 * READ-ONLY probe — eth_chainId + eth_blockNumber on the configured keyless
 * RPC. Opt-in (never called by the default status computation), 2.5s timeout,
 * every failure resolves to an honest ok:false. No transaction, no signing.
 *
 * Task 13: `allowPublicFallback` lets the live-proof path read from the
 * well-known KEYLESS public endpoint when no env RPC is configured. Default
 * (false) keeps the Task-12 contract: not-configured → probe not attempted.
 * Both paths are keyless — a URL with embedded credentials is always refused.
 */
export async function probeEthereumReadonly(opts?: { allowPublicFallback?: boolean }): Promise<EthereumProbeResult> {
  const envUrl = safeRpcUrl();
  // roast 50: rotation across candidates — one blocked/hostile endpoint no
  // longer fakes a "network down" (Task 49 proved publicnode can 403 alone)
  const candidates = opts?.allowPublicFallback
    ? ethereumReadRpcCandidates()
    : envUrl
      ? [envUrl]
      : [];
  if (candidates.length === 0) {
    return { probed: false, ok: false, chainId: null, blockNumber: null, sourceHost: null, reason: "not-configured: אין ETH_RPC_URL" };
  }
  const call = async (url: string, method: string): Promise<string | null> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
        signal: AbortSignal.timeout(2_500),
        cache: "no-store"
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { result?: unknown };
      return typeof data?.result === "string" ? data.result : null;
    } catch {
      return null;
    }
  };
  for (const url of candidates) {
    const chainId = await call(url, "eth_chainId");
    if (chainId === null) continue; // endpoint hostile/unreachable — next candidate
    const blockNumber = await call(url, "eth_blockNumber");
    const ok = blockNumber !== null;
    const host = await new Promise<string | null>((r) => {
      try {
        r(new URL(url).host);
      } catch {
        r(null);
      }
    });
    return {
      probed: true,
      ok,
      chainId,
      blockNumber,
      sourceHost: host,
      reason: ok
        ? `קריאה-בלבד הצליחה (eth_chainId + eth_blockNumber ← ${host}${candidates.length > 1 ? ", סיבוב-נקודות קריאה" : ""})`
        : "chainId נענה אך blockNumber נכשל — הרשת אינה מאומתת חי במלואה (לא נחסם, לא הומצא)"
    };
  }
  return {
    probed: true,
    ok: false,
    chainId: null,
    blockNumber: null,
    sourceHost: null,
    reason: `קריאה נכשלה/פסק-זמן מול כל ${candidates.length} נקודות-הקריאה — הרשת אינה מאומתת חי כרגע (לא נחסם, לא הומצא)`
  };
}
