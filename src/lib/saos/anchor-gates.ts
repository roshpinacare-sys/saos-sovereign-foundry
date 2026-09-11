/**
 * Anchor gates — honest resource gating (שערי-העגינה: כנות, לא תיאטרון).
 * Ported from: steem-main `agent/hive_rc.cjs` (RC floors), `agent/blurt_health.json`
 * (measured cooldowns), weave_batch honesty notes ("rc-gated: honest skip, parity waits").
 *
 * Why HIVE was pending (from the live run, weave_last.json):
 *   "hive: rc-gated: rc-floor(0.6%<12%) (regen budget — honest skip, parity waits)"
 * Hive RC regenerates ≈20%/day; floors are 8% (light) / 12% (heavy) + 2× headroom.
 */

import { ethereumRpcStatus } from "./networks/ethereum";
import { solanaRpcStatus } from "./networks/solana";
import type { TronEnergyMeasure } from "./tron-energize-live";

export interface ChainGate {
  network: "STEEM" | "BLURT" | "HIVE" | "TRON" | "ETHEREUM" | "SOLANA";
  status: "anchored" | "pending" | "gated" | "transit";
  gate: string | null;
  detail: string;
  recovery: string | null;
}

export const HIVE_RC_REGEN_PCT_PER_DAY = 20;
export const HIVE_RC_FLOOR_LIGHT = 8;
export const HIVE_RC_FLOOR_HEAVY = 12;
export const BLURT_COOLDOWN_MIN = 30;
export const BLURT_FEE_FORMULA = "0.05 + 0.2 × KB"; // measured blurt fee law

/** hours until Hive RC reaches a target percent (linear 20%/day regen) */
export function hiveRcHoursToTarget(currentPct: number, targetPct: number): number {
  if (currentPct >= targetPct) return 0;
  return ((targetPct - currentPct) / HIVE_RC_REGEN_PCT_PER_DAY) * 24;
}

export interface HiveRcPlan {
  currentPct: number;
  lightFloorHours: number;
  heavyFloorHours: number;
  verdict: string;
  path: { step: string; detail: string; hours: number }[];
}

export function hiveRcRecoveryPlan(currentPct: number): HiveRcPlan {
  const lightH = hiveRcHoursToTarget(currentPct, HIVE_RC_FLOOR_LIGHT);
  const heavyH = hiveRcHoursToTarget(currentPct, HIVE_RC_FLOOR_HEAVY);
  const path: HiveRcPlan["path"] = [
    {
      step: "התאוששות טבעית (regen)",
      detail: `RC מתחדש ~${HIVE_RC_REGEN_PCT_PER_DAY}%/יום — ללא הוצאה`,
      hours: 0
    },
    {
      step: "סף קל (8%) — custom_json עדין",
      detail: `עוד ${lightH.toFixed(1)} שעות עד לעגינת weave קלה`,
      hours: Number(lightH.toFixed(1))
    },
    {
      step: "סף כבד (12%) — weave מלא + account_update",
      detail: `עוד ${heavyH.toFixed(1)} שעות עד פעולות כבדות`,
      hours: Number(heavyH.toFixed(1))
    },
    {
      step: "האצה ריבונית: power-up / delegate",
      detail:
        "rc_sovereign --hive-powerup: SWAP.HIVE→HIVE→vesting (הכלי קיים בקוד ההיסטורי) או delegate VESTS מחייל בריא",
      hours: 1
    }
  ];
  const verdict =
    currentPct < HIVE_RC_FLOOR_LIGHT
      ? "gated — עוגן בכנות: רגן-תקציב, לא תיאטרון"
      : currentPct < HIVE_RC_FLOOR_HEAVY
        ? "light ops possible — weave אפשרי, כבד נשאר נעול"
        : "open — כל פעולות העגינה זמינות";
  return { currentPct, lightFloorHours: Number(lightH.toFixed(1)), heavyFloorHours: Number(heavyH.toFixed(1)), verdict, path };
}

/**
 * the full anchoring matrix as the platform sees it today.
 *
 * Truth contract (roast 50): a matrix row can NEVER be "anchored" — that
 * status means "a live verified txid exists on an external chain", and only
 * the verified broadcast path (anchor-pulse → PATCH signer → verifyTxidPublic)
 * may set it. A capability snapshot that fabricates "anchored" wrote lies into
 * AnchorTx rows (txid:null + status:anchored — the seal-1 legacy bug).
 * Capable networks are "pending" (ready, awaiting broadcast).
 *
 * `tronMeasure` (optional, live): when present the TRON row discloses a LIVE
 * getaccount measurement instead of the frozen 2026-09-08 field claim.
 */
/**
 * Task 87 — fleet-effective HIVE gate. The 8% floor was calibrated for ONE account's
 * stored RC; the fleet rotation (h17 wic → h18 woq → h19 cashmachine → h20 woq → h21 tov,
 * 5/5 verified broadcasts) proved the EFFECTIVE fleet RC is the real resource. When the
 * main account is below the floor but a fleet account is measured READY, the honest
 * matrix says "pending via fleet rotation" — not a bare "gated" that hides a working
 * path. Fail-closed preserved: no fleet measurement → old behavior, unchanged.
 */
export interface HiveFleetBest {
  account: string;
  rcPct: number;
}

export function anchoringMatrix(
  rcPct: number,
  tronEnergy: number,
  tronMeasure?: TronEnergyMeasure,
  hiveFleet?: HiveFleetBest | null
): ChainGate[] {
  const steem: ChainGate = {
    network: "STEEM",
    status: "pending",
    gate: null,
    detail: "custom_json id=saos.weave.v1 (active, חינם-RC) + קריאת-היסטוריה לאימות",
    recovery: null
  };
  const blurt: ChainGate = {
    network: "BLURT",
    status: "pending",
    gate: null,
    detail: `חתימה קנונית ידנית (low-s loop), עמלה ${BLURT_FEE_FORMULA}, cooldown ${BLURT_COOLDOWN_MIN} דק׳ מדוד`,
    recovery: null
  };
  const mainRcOk = rcPct >= HIVE_RC_FLOOR_LIGHT;
  const fleetRcOk = !!hiveFleet && hiveFleet.rcPct >= HIVE_RC_FLOOR_LIGHT;
  const hive: ChainGate = {
    network: "HIVE",
    status: mainRcOk || fleetRcOk ? "pending" : "gated",
    gate: mainRcOk
      ? null
      : fleetRcOk
        ? `rc-floor-ראשי(${rcPct}%<${HIVE_RC_FLOOR_LIGHT}%) — נעקף-ברוטציית-צי: ${hiveFleet!.account} אפקטיבי ${hiveFleet!.rcPct}%≥${HIVE_RC_FLOOR_LIGHT}% (דפוס-מוכח h17→h21)`
        : `rc-floor(${rcPct}%<${HIVE_RC_FLOOR_LIGHT}%)`,
    detail: "אותה משפחת Graphene — dhive raw sign, chain_id קבוע; הקוד מוכח, החסם הוא RC בלבד",
    recovery:
      mainRcOk
        ? "הפעמה הבאה תעגן בפועל"
        : fleetRcOk
          ? `עיגון-מיידי דרך רוטציית-הצי (${hiveFleet!.account})`
          : `התאוששות: ${hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_LIGHT).toFixed(1)} שעות, או power-up מיידי`
  };
  const tronGateText =
    tronEnergy > 0
      ? null
      : tronMeasure?.probed
        ? `energy-0 (נמדד חי @ ${tronMeasure.at} — כל ${tronMeasure.addresses} כתובות הכספת, אפס frozenV2-אנרגיה)`
        : "energy-0 (כל 6 כתובות הכספת — מדידת-שדה 08.09)";
  const tron: ChainGate = {
    network: "TRON",
    status: tronEnergy > 0 ? "pending" : "transit",
    gate: tronGateText,
    detail:
      tronEnergy > 0
        ? "מסלול ישיר פתוח: TriggerSmartContract עם stateRoot בנתוני הקריאה"
        : "מעבר: root נסחר בתוך stateRoot → רכבת tronbridge היומית (קידוד 6 תווי hash בשבר ה-TRX)",
    recovery:
      tronEnergy > 0
        ? null
        : "energize: freezeBalanceV2 + delegateResource — המודול מוכן בפלטפורמה זו"
  };
  // Task 12: Ethereum & Solana join the gate matrix — dry-run only, keyless.
  // `not-configured` is a state (never an error); nothing is invented.
  const ethRpc = ethereumRpcStatus() !== "not-configured";
  const solRpc = solanaRpcStatus() !== "not-configured";
  const ethereum: ChainGate = {
    network: "ETHEREUM",
    status: "gated",
    gate: ethRpc ? null : "not-configured (אין ETH_RPC_URL) — dry-run בלבד",
    detail: ethRpc
      ? "EVM — עיגון אפשרי: tx hash / calldata hash / memo-log commitment; קריאה-בלבד אפשרית, אין שידור"
      : "EVM — עיגון אפשרי: tx hash / calldata hash / memo-log commitment; אין RPC — אין בדיקת קריאה",
    recovery: "הגדרת ETH_RPC_URL ציבורי (ללא מפתח) לקריאה-בלבד + gas (ETH) ממומן על-ידי הבעלים + חתימה חיצונית"
  };
  const solana: ChainGate = {
    network: "SOLANA",
    status: "gated",
    gate: solRpc ? null : "not-configured (אין SOL_RPC_URL) — dry-run בלבד",
    detail: solRpc
      ? "Solana runtime — עיגון אפשרי: signature / blockhash commitment / memo program; קריאה-בלבד אפשרית, אין שידור"
      : "Solana runtime — עיגון אפשרי: signature / blockhash commitment / memo program; אין RPC — אין בדיקת קריאה",
    recovery: "הגדרת SOL_RPC_URL ציבורי (ללא מפתח) לקריאה-בלבד + SOL (עמלות/rent) ממומן על-ידי הבעלים + חתימה חיצונית"
  };
  return [steem, blurt, hive, tron, ethereum, solana];
}
