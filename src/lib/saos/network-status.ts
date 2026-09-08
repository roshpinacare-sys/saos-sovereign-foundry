/**
 * Network status view (מצב רשתות חוץ) — computed, honest, zero live calls.
 * Iron rule for this stage: read-only computation only — no broadcast, no
 * signing, no wallet use. Every field is either a documented constant,
 * a measured historic fact, or derived from the provided (env) resource level.
 */

import { HIVE_RC_FLOOR_HEAVY, HIVE_RC_FLOOR_LIGHT, hiveRcHoursToTarget, BLURT_COOLDOWN_MIN, BLURT_FEE_FORMULA } from "./anchor-gates";
import { minStakeForSettlements } from "./tron-energize";
import { HISTORIC_ANCHORS } from "./historic";
import { ethereumStatus } from "./networks/ethereum";
import { solanaStatus } from "./networks/solana";
import type { ChainType, RpcStatus } from "./networks/types";

export type NetworkName = "STEEM" | "BLURT" | "HIVE" | "TRON" | "ETHEREUM" | "SOLANA";

export interface NetworkStatusView {
  network: NetworkName;
  status: "anchored" | "pending" | "gated" | "transit";
  /** advisory = compute+record only (no signing keys here); direct = real broadcast path exists */
  mode: "advisory" | "direct";
  /** when this view was computed (ISO) — per-network freshness stamp (Task 6) */
  lastChecked: string;
  lastVerifiedAnchor: string | null;
  nextAction: string;
  blocker: string | null;
  requiredResource: string | null;
  /** ordered, concrete steps to clear the blocker — plan only, not executed */
  unblockPlan: string[];
  /** true only when the network can receive a real anchor NOW (resource + signer + mode all clear) */
  isReadyForAnchor: boolean;
  /** true while every anchor on this network is compute/plan-only (no broadcast path) — honest stage flag */
  isDryRunOnly: boolean;
  // ── Task 11: decision-grade blocker disclosure ──
  /** the discrete owner options for this network (wait / fund / delegate / switch...) */
  ownerOptions: string[];
  /** what the owner personally must do — the system never executes it */
  ownerAction: string;
  /** estimated time to clear the blocker, when known — null = unknown, never invented */
  estimatedTime: string | null;
  /** estimated cost to clear the blocker, when known — null = unknown, never invented */
  estimatedCost: string | null;
  /** false = the resource figure is env/historic, NOT a live probe (honest disclosure) */
  resourceLiveChecked: boolean;
  // ── Task 12: chain identity & RPC presence (Ethereum/Solana + full matrix) ──
  /** chain family — graphene (STEEM/BLURT/HIVE), tvm (TRON), evm, solana-runtime */
  chainType?: ChainType;
  /** chain id / cluster name — public constant only; null when unknown/not set */
  chainId?: string | null;
  /** possible anchor commitment kinds on this chain (plan vocabulary, no execution) */
  anchorTypes?: string[];
  /** RPC presence state — NEVER the URL itself */
  rpcStatus?: RpcStatus;
  /** true when a read-only live probe is possible right now (opt-in, keyless RPC) */
  liveProbePossible?: boolean;
}

export function networkStatuses(rcPct: number, tronEnergy: number): NetworkStatusView[] {
  const historicOf = (n: NetworkName) => HISTORIC_ANCHORS.find((h) => h.network === n);
  const vaultBlocker = "vault: אין מפתחות חתימה בסנדבוקס (שלב 2 — שחזור כספת)";

  const nowIso = new Date().toISOString();
  // honest stage flag: no vault/signer is connected in this sandbox — every
  // network is compute/plan-only until an external signer is actually attached.
  const dryRunOnly = true;

  const steem: NetworkStatusView = {
    network: "STEEM",
    status: "anchored",
    mode: "advisory",
    chainType: "graphene",
    chainId: null,
    anchorTypes: ["custom_json op (saos.weave.v1)"],
    rpcStatus: "public",
    liveProbePossible: true,
    lastChecked: nowIso,
    lastVerifiedAnchor: historicOf("STEEM")?.txRef ?? null,
    nextAction: "בפעימת live הבאה: שידור custom_json saos.weave.v1 + שמירת txid מלא ב-AnchorTx; בדיקת-קריאה חיה זמינה ב-/api/saos/live-proof",
    blocker: vaultBlocker,
    requiredResource: "posting key (active למבצעים מורחבים) — שחזור כספת",
    unblockPlan: [
      "1. שחזור מפתח מהכספת ההיסטורית (מחוץ לסנדבוקס)",
      "2. SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES",
      "3. פעימה: custom_json id=saos.weave.v1 עם ה-root",
      "4. עדכון AnchorTx: status=anchored, txid מלא"
    ],
    isReadyForAnchor: false,
    isDryRunOnly: dryRunOnly,
    ownerOptions: [
      "שחזור כספת (מחוץ למערכת) והפעלת מחזור העוגן הראשון על STEEM",
      "השארת STEEM כרשת-גיבוי ובחירת רשת אחרת כיעד ראשון"
    ],
    ownerAction: "לשחזר את המפתח מהכספת ההיסטורית מחוץ למערכת (docs/external-signer.md) — המערכת מקבלת רק txid",
    estimatedTime: null,
    estimatedCost: null,
    resourceLiveChecked: false
  };

  const blurt: NetworkStatusView = {
    network: "BLURT",
    status: "anchored",
    mode: "advisory",
    chainType: "graphene",
    chainId: null,
    anchorTypes: ["custom_json op (canonical low-s)"],
    rpcStatus: "public",
    liveProbePossible: true,
    lastChecked: nowIso,
    lastVerifiedAnchor: historicOf("BLURT")?.txRef ?? null,
    nextAction: `בפעימת live הבאה: חתימה קנונית (low-s loop), עמלה ${BLURT_FEE_FORMULA}, שמירת cooldown ${BLURT_COOLDOWN_MIN} דק'`,
    blocker: vaultBlocker,
    requiredResource: "active key + יתרת BLURT לעמלה",
    unblockPlan: [
      "1. שחזור מפתח מהכספת",
      "2. בדיקת יתרה לכיסוי 0.05 + 0.2 × KB",
      "3. פעימה + קריאת-חזרה של הבלוק לאימות",
      "4. עדכון AnchorTx"
    ],
    isReadyForAnchor: false,
    isDryRunOnly: dryRunOnly,
    ownerOptions: [
      "שחזור כספת (מחוץ למערכת) + בדיקת יתרה לכיסוי העמלה",
      "השארת BLURT כרשת-גיבוי"
    ],
    ownerAction: "לשחזר את המפתח מהכספת מחוץ למערכת ולוודא יתרה לכיסוי העמלה — המערכת מקבלת רק txid",
    estimatedTime: null,
    estimatedCost: null,
    resourceLiveChecked: false
  };

  const lightH = hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_LIGHT);
  const heavyH = hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_HEAVY);
  const hive: NetworkStatusView = {
    network: "HIVE",
    status: rcPct >= HIVE_RC_FLOOR_LIGHT ? "pending" : "gated",
    mode: "advisory",
    chainType: "graphene",
    chainId: null,
    anchorTypes: ["custom_json op (saos.weave.v1)"],
    rpcStatus: "public",
    liveProbePossible: true,
    lastChecked: nowIso,
    lastVerifiedAnchor: null,
    nextAction:
      rcPct >= HIVE_RC_FLOOR_LIGHT
        ? "הפעימה הבאה תעגן בפועל (custom_json קל) — הסף עבר"
        : "המתנה לרגן או power-up מיידי; אין פעולה חיה עד לסף",
    blocker: rcPct >= HIVE_RC_FLOOR_LIGHT ? vaultBlocker : `rc-floor: נוכחי ${rcPct}% < ${HIVE_RC_FLOOR_LIGHT}% (סף-קל) / ${HIVE_RC_FLOOR_HEAVY}% (סף-כבד)`,
    requiredResource: `RC ≥ ${HIVE_RC_FLOOR_LIGHT}% — רגן ~20%/יום (כ-${lightH.toFixed(1)} שעות לסף-קל, ${heavyH.toFixed(1)} לכבד) או power-up/delegate`,
    unblockPlan: [
      `1. התאוששות טבעית: ~${lightH.toFixed(1)} שעות עד ${HIVE_RC_FLOOR_LIGHT}%`,
      "2. האצה ריבונית: SWAP.HIVE→HIVE→vesting (power-up) או delegate VESTS",
      "3. אחרי הסף: פעימת עגינה רגילה + שמירת txid"
    ],
    // HIVE resource level is measurable (env rc%) — but without a connected signer it still cannot anchor
    isReadyForAnchor: false,
    isDryRunOnly: dryRunOnly,
    ownerOptions: [
      `המתנה להתאוששות טבעית (רגן ~20%/יום — כ-${lightH.toFixed(1)} שעות לסף-הקל)`,
      "power-up (SWAP.HIVE→HIVE→vesting) להאצה מיידית",
      "delegate VESTS מחייל בריא לחשבון",
      "מעבר לחשבון HIVE אחר עם RC פנוי"
    ],
    ownerAction: `לבחור: המתנה (כ-${lightH.toFixed(1)} שעות) או מימון power-up/delegate — פעולה כלכלית מחוץ למערכת, באישור בעלים בלבד`,
    estimatedTime: `כ-${lightH.toFixed(1)} שעות רגן לסף-הקל (8%) · ${heavyH.toFixed(1)} לסף-הכבד (12%)`,
    estimatedCost: null,
    resourceLiveChecked: false
  };

  const minStake = minStakeForSettlements(4); // 4 settlements/day — the working target
  const tron: NetworkStatusView = {
    network: "TRON",
    status: tronEnergy > 0 ? "pending" : "transit",
    mode: "advisory",
    chainType: "tvm",
    chainId: null,
    anchorTypes: ["TriggerSmartContract (stateRoot in calldata)", "tronbridge daily train"],
    rpcStatus: "public",
    liveProbePossible: true,
    lastChecked: nowIso,
    lastVerifiedAnchor: null,
    nextAction:
      tronEnergy > 0
        ? "מסלול ישיר פתוח: TriggerSmartContract עם stateRoot בנתוני הקריאה"
        : "הישארות ברכבת tronbridge היומית (root בתוך stateRoot) עד מימון ההימור",
    blocker: tronEnergy > 0 ? vaultBlocker : `energy-0: אפס אנרגיה בכל 6 כתובות הכספת (מדידה היסטורית)`,
    requiredResource: `TRX stake ≥ ${minStake.toLocaleString()} TRX ל-4 יישובי USDT/יום (או שריפה ~27.26 TRX/tx)`,
    unblockPlan: [
      `1. מימון הימור: ≥ ${minStake.toLocaleString()} TRX`,
      "2. freezeBalanceV2(resource=ENERGY) + delegateResource לכתובת המשדר",
      "3. יישוב USDT נושא-stateRoot — ללא שריפה",
      "4. עדכון AnchorTx ל-anchored עם txid"
    ],
    isReadyForAnchor: false,
    isDryRunOnly: dryRunOnly,
    ownerOptions: [
      "הישארות ברכבת tronbridge היומית (אפס עלות ישירה — ה-root נסחר בתוך stateRoot)",
      "הימור freezeBalanceV2 + delegateResource — אנרגיה קבועה",
      "האצלת אנרגיה (delegate מחשבון אחר)",
      "מימון חיצוני / שריפת TRX לכל עסקה"
    ],
    ownerAction: "לממן TRX ולבחור מסלול (הימור/שריפה/האצלה) או לאשר המשך transit — פעולה כלכלית מחוץ למערכת, באישור בעלים בלבד",
    estimatedTime: "מיידי אחרי מימון האנרגיה",
    estimatedCost: `הימור ≥ ${minStake.toLocaleString()} TRX ל-4 יישובי USDT/יום · שריפה ~27.26 TRX/tx`,
    resourceLiveChecked: false
  };

  // Task 12: Ethereum & Solana join the matrix — dry-run only, keyless,
  // `not-configured` is a state (never an error); zero live calls by default.
  const ethereum = ethereumStatus(nowIso);
  const solana = solanaStatus(nowIso);

  return [steem, blurt, hive, tron, ethereum, solana];
}
