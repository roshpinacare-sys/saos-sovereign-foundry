/**
 * Network status view (מצב רשתות חוץ) — computed, honest, zero live calls.
 * Iron rule for this stage: read-only computation only — no broadcast, no
 * signing, no wallet use. Every field is either a documented constant,
 * a measured historic fact, or derived from the provided (env) resource level.
 */

import { HIVE_RC_FLOOR_HEAVY, HIVE_RC_FLOOR_LIGHT, hiveRcHoursToTarget, BLURT_COOLDOWN_MIN, BLURT_FEE_FORMULA } from "./anchor-gates";
import { minStakeForSettlements } from "./tron-energize";
import { HISTORIC_ANCHORS } from "./historic";

export type NetworkName = "STEEM" | "BLURT" | "HIVE" | "TRON";

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
    lastChecked: nowIso,
    lastVerifiedAnchor: historicOf("STEEM")?.txRef ?? null,
    nextAction: "בפעימת live הבאה: שידור custom_json saos.weave.v1 + שמירת txid מלא ב-AnchorTx",
    blocker: vaultBlocker,
    requiredResource: "posting key (active למבצעים מורחבים) — שחזור כספת",
    unblockPlan: [
      "1. שחזור מפתח מהכספת ההיסטורית (מחוץ לסנדבוקס)",
      "2. SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES",
      "3. פעימה: custom_json id=saos.weave.v1 עם ה-root",
      "4. עדכון AnchorTx: status=anchored, txid מלא"
    ],
    isReadyForAnchor: false,
    isDryRunOnly: dryRunOnly
  };

  const blurt: NetworkStatusView = {
    network: "BLURT",
    status: "anchored",
    mode: "advisory",
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
    isDryRunOnly: dryRunOnly
  };

  const lightH = hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_LIGHT);
  const heavyH = hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_HEAVY);
  const hive: NetworkStatusView = {
    network: "HIVE",
    status: rcPct >= HIVE_RC_FLOOR_LIGHT ? "pending" : "gated",
    mode: "advisory",
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
    isDryRunOnly: dryRunOnly
  };

  const minStake = minStakeForSettlements(4); // 4 settlements/day — the working target
  const tron: NetworkStatusView = {
    network: "TRON",
    status: tronEnergy > 0 ? "pending" : "transit",
    mode: "advisory",
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
    isDryRunOnly: dryRunOnly
  };

  return [steem, blurt, hive, tron];
}
