/**
 * SOLANA network module (Task 12) — dry-run only, keyless, honest.
 *
 * Iron rules:
 *   - No transaction, no broadcast, no signing, no wallet use — EVER (the
 *     system prepares data; the owner signs outside; only the public result
 *     (signature) ever returns — see docs/external-signer.md).
 *   - Zero live calls by default. The read-only probe below exists, is
 *     explicitly opt-in, short-timeout, keyless-only, and never throws.
 *   - No RPC configured → `not-configured` STATE (no error, no invented data).
 *   - RPC URLs with embedded credentials or key-like query params are refused.
 *     The URL itself is never echoed, stored or logged — hostname only.
 *
 * Anchor commitment vocabulary (plan-only, no execution):
 *   - signature:           the anchor transaction signature itself
 *   - blockhash-commitment: root committed against a finalized blockhash
 *   - memo-program:        root inside a SplMemo instruction
 */

import type { NetworkStatusView } from "../network-status";
import type { ExtendedNetworkFields, RpcStatus } from "./types";

export const SOLANA_ANCHOR_TYPES = ["signature", "blockhash-commitment", "memo-program"] as const;

export type SolanaStatusView = NetworkStatusView & ExtendedNetworkFields;

/** allowed cluster names (identifier only — no URLs) */
export const SOL_CLUSTERS = ["mainnet-beta", "devnet", "testnet", "localnet"] as const;
export type SolCluster = (typeof SOL_CLUSTERS)[number];

/** read-only probe result — public chain data only */
export interface SolanaProbeResult {
  /** false when no keyless RPC is configured (probe not attempted) */
  probed: boolean;
  ok: boolean;
  /** current slot as returned by getSlot (public) */
  slot: number | null;
  /** hostname only — never the full URL, never credentials */
  sourceHost: string | null;
  reason: string;
}

/** validated RPC URL or null — refuses credentials and key-like query params */
function safeRpcUrl(): string | null {
  const raw = (process.env.SOL_RPC_URL ?? "").trim();
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

/** RPC presence state (never the URL) */
export function solanaRpcStatus(): RpcStatus {
  return safeRpcUrl() === null ? "not-configured" : "public";
}

/**
 * Keyless read endpoint for public tx verification: the configured env URL if
 * valid, else the public mainnet endpoint. Never carries credentials — used
 * by verifyTxidPublic for read-only lookups only.
 */
export function solanaReadRpcCandidate(): string {
  return safeRpcUrl() ?? "https://api.mainnet-beta.solana.com";
}

/** true when a read-only probe is possible right now */
export function solanaLiveProbePossible(): boolean {
  return safeRpcUrl() !== null;
}

/** SOL_CLUSTER from env — cluster NAME only; null when unset/unknown */
export function solanaClusterFromEnv(): SolCluster | null {
  const raw = (process.env.SOL_CLUSTER ?? "").trim().toLowerCase();
  return (SOL_CLUSTERS as readonly string[]).includes(raw) ? (raw as SolCluster) : null;
}

/**
 * Solana status view — computed, honest, dry-run only.
 * `not-configured` is a state, not an error; values are never invented.
 */
export function solanaStatus(nowIso: string): SolanaStatusView {
  const rpcStatus = solanaRpcStatus();
  const configured = rpcStatus !== "not-configured";
  const cluster = solanaClusterFromEnv();
  const vaultBlocker = "vault: אין מפתחות חתימה בסנדבוקס (חתימה חיצונית בלבד — docs/external-signer.md)";
  const notConfigured = "not-configured: אין SOL_RPC_URL מוגדר — הרשת מוכרת אך לא ניתנת לבדיקת-קריאה";

  return {
    network: "SOLANA",
    status: "gated",
    mode: "advisory",
    chainType: "solana-runtime",
    chainId: cluster,
    anchorTypes: [...SOLANA_ANCHOR_TYPES],
    rpcStatus,
    liveProbePossible: configured,
    lastChecked: nowIso,
    lastVerifiedAnchor: null,
    nextAction: configured
      ? "אימות-קריאה אפשרי מול ה-RPC הציבורי (probe אופציונלי); אין שידור — dry-run בלבד עד חותם חיצוני ואישור בעלים"
      : "אין פעולה חיה — הרשת במצב not-configured; הגדרת RPC ציבורי (ללא מפתח) מאפשרת קריאה-בלבד",
    blocker: configured ? vaultBlocker : notConfigured,
    requiredResource: "SOL לעמלות עסקה + rent לחשבונות + compute units — מימון חיצוני על-ידי הבעלים בלבד",
    unblockPlan: [
      "1. הגדרת SOL_RPC_URL ציבורי ללא מפתח (קריאה-בלבד) — לעולם לא RPC עם מפתח בקוד/בריפו",
      "2. קריאת-אימות בלבד (getSlot — probe אופציונלי)",
      "3. חתימה חיצונית של עסקת עיגון (memo program / blockhash commitment) מחוץ למערכת",
      "4. רישום התוצאה הציבורית בלבד (signature) — PATCH /api/saos/signer"
    ],
    isReadyForAnchor: false,
    isDryRunOnly: true,
    ownerOptions: [
      "השארת סולנה במצב not-configured / dry-run (ברירת-מחדל הבטוחה)",
      "הגדרת RPC ציבורי ללא מפתח לאימות-קריאה בלבד",
      "מימון SOL (עמלות/rent) + חתימה חיצונית — נדרש אישור בעלים מפורש ולא מבוצע אוטומטית"
    ],
    ownerAction: "להחליט אם להגדיר RPC ציבורי (ללא מפתח) ולממן SOL — פעולה כלכלית מחוץ למערכת; המערכת אינה משדרת ואינה חותמת",
    estimatedTime: null,
    estimatedCost: null, // fee/rent market data — never invented
    resourceLiveChecked: false
  };
}

/**
 * READ-ONLY probe — getSlot on the configured keyless RPC. Opt-in (never
 * called by the default status computation), 2.5s timeout, every failure
 * resolves to an honest ok:false. No transaction, no signing.
 *
 * Task 13: `allowPublicFallback` lets the live-proof path read from the
 * well-known KEYLESS public endpoint when no env RPC is configured. Default
 * (false) keeps the Task-12 contract: not-configured → probe not attempted.
 */
export async function probeSolanaReadonly(opts?: { allowPublicFallback?: boolean }): Promise<SolanaProbeResult> {
  let url = safeRpcUrl();
  if (!url && opts?.allowPublicFallback) url = "https://api.mainnet-beta.solana.com";
  if (!url) {
    return { probed: false, ok: false, slot: null, sourceHost: null, reason: "not-configured: אין SOL_RPC_URL" };
  }
  let host: string | null = null;
  try {
    host = new URL(url).host;
  } catch {
    host = null;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
      signal: AbortSignal.timeout(2_500),
      cache: "no-store"
    });
    if (!res.ok) {
      return { probed: true, ok: false, slot: null, sourceHost: host, reason: "קריאה נכשלה (HTTP) — הרשת אינה מאומתת חי" };
    }
    const data = (await res.json()) as { result?: unknown };
    const slot = typeof data?.result === "number" ? data.result : null;
    return {
      probed: true,
      ok: slot !== null,
      slot,
      sourceHost: host,
      reason: slot !== null ? "קריאה-בלבד הצליחה (getSlot)" : "תשובה לא צפויה — הרשת אינה מאומתת חי (לא נחסם, לא הומצא)"
    };
  } catch {
    return { probed: true, ok: false, slot: null, sourceHost: host, reason: "קריאה נכשלה/פסק-זמן — הרשת אינה מאומתת חי" };
  }
}
