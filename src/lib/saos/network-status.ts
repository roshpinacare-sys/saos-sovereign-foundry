/**
 * Network status view (מצב רשתות חוץ) — computed, honest, zero live calls.
 * Iron rule for this stage: read-only computation only — no broadcast, no
 * signing, no wallet use. Every field is either a documented constant,
 * a measured historic fact, or derived from the provided (env) resource level.
 */

import { HIVE_RC_FLOOR_HEAVY, HIVE_RC_FLOOR_LIGHT, hiveRcHoursToTarget, BLURT_COOLDOWN_MIN, BLURT_FEE_FORMULA } from "./anchor-gates";
import { minStakeForSettlements } from "./tron-energize";
import { HISTORIC_ANCHORS } from "./historic";
import { externalSignerCached } from "./external-signer-client";
import { fleetCureStatus } from "./fleet-cure";
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
  // Task 26 (live forensics 2026-09-08): the external signer IS connected
  // (mini-services/external-signer :3033, envelope GCM-genuine), but the sealed
  // envelope's STEEM keys derive to pubkeys that are NOT the on-chain
  // authorities of any of the 11 fleet accounts — the live runtime anchors
  // with its own keys. The honest blocker is key-AUTHORIZATION, not key-ABSENCE.
  const signerConnected = externalSignerCached().connected;
  // Task 26-c forensics (2026-09-09, live-verified): the envelope keys match
  // HIVE chain authority for 9/9 fleet accounts (posting+active) and match
  // NOTHING on STEEM (headcorner+tov+fleet 0/11 — owner-held runtime keys,
  // disk wiped). The honest STEEM blocker is key-custody (owner), not software.
  const steemBlocker = "keys-owner-held: מפתחות STEEM בחזקת הבעלים (אומת 0/11 התאמות-סמכות בסביבה; המפתחות החיים היו runtime-only ונמחקו מהדיסק) — עיגון STEEM דורש טעינת מפתח-בעלים למעטפת דרך fleet_vault --seal";
  const vaultBlocker = signerConnected
    ? steemBlocker
    : "vault: אין מפתחות חתימה בסנדבוקס (שלב 2 — שחזור כספת)";

  const nowIso = new Date().toISOString();
  // Task 26-c: HIVE has a REAL broadcast path when the signer is connected —
  // the 9 fleet accounts' posting keys verify live, and the fleet-cure daemon
  // auto-executes the pending weave at the first RC window.
  const fc = fleetCureStatus();
  const dryRunOnly = true; // STEEM/BLURT/TRON: no working keys in-environment
  const hiveDryRunOnly = !signerConnected; // HIVE: real path via fleet + signer

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
      "טעינת מפתח-הבעלים (STEEM) למעטפת באמצעות fleet_vault --seal על הרנטיים החי",
      "השארת STEEM כרשת-גיבוי ובחירת HIVE (עיגון-צי) כיעד ראשון"
    ],
    ownerAction: "לטעון את מפתחות ה-STEEM שבחזקת הבעלים למעטפת (fleet_vault --seal) — המערכת מאמתת סמכות מול השרשרת לפני כל שידור",
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
  // Task 26-c: the fleet-cure daemon schedules the first REAL HIVE anchor
  // automatically (fleet keys verified 9/9; op-cost 225M RC measured).
  const fleetWindowH = fc.best ? fc.best.etaMin / 60 : null;
  const fleetLanded = Boolean(fc.lastTxid);
  const hiveBlocker = fleetLanded
    ? vaultBlocker
    : fc.best
      ? `rc-floor כבר לא חוסם-אוטומטי: חלון-עוגן-צי ראשון בעוד ~${fleetWindowH?.toFixed(1)} שע' (${fc.best.account}) — מתוזמן ע"י fleet-cure; סף-קל 8% לחשבון הראשי בעוד ~${lightH.toFixed(1)} שע' רגן`
      : `rc-floor: נוכחי ${rcPct}% < ${HIVE_RC_FLOOR_LIGHT}% (סף-קל) / ${HIVE_RC_FLOOR_HEAVY}% (סף-כבד) — ואין חלון צי פעיל`;
  const hive: NetworkStatusView = {
    network: "HIVE",
    status: fleetLanded || rcPct >= HIVE_RC_FLOOR_LIGHT ? "pending" : "gated",
    mode: "advisory",
    chainType: "graphene",
    chainId: null,
    anchorTypes: ["custom_json op (saos.weave.v1)"],
    rpcStatus: "public",
    liveProbePossible: true,
    lastChecked: nowIso,
    lastVerifiedAnchor: fleetLanded ? (fc.lastTxid as string) : null,
    nextAction: fleetLanded
      ? `עוגן-צי בוצע (txid ${String(fc.lastTxid).slice(0, 12)}…) — המשך קצב עם backoff לפי חלונות RC`
      : fc.best
        ? `fleet-cure מבצע אוטומטית את ה-weave הממתין בחלון הראשון (~${Math.round(fc.best.etaMin)} דק', ${fc.best.account}) — ריצה אוטומטית, ללא פעולת בעלים`
        : "המתנה לרגן או power-up; אין פעולה חיה עד לסף",
    blocker: hiveBlocker,
    requiredResource: fleetLanded
      ? null
      : `מנועת-עלות: RC ≥ 225M ל-op (מדוד) — רגן צי אוטומטי; לחשבון הראשי RC ≥ ${HIVE_RC_FLOOR_LIGHT}% (כ-${lightH.toFixed(1)} שע') או power-up 9.682 HIVE (דורש מפתח-בעלים)`,
    unblockPlan: fleetLanded
      ? [
          "1. קצב עיגון-צי קבוע עם backoff כלכלי (כמו relay ה-DEX)",
          "2. power-up 9.682 HIVE של הראשי בטעינת מפתח-בעלים (max_rc ×~1.6)",
          "3. מעקב rc-floor ב-/api/saos/energy?net=hive"
        ]
      : [
          `1. אוטומטי: fleet-cure משדר את ה-weave בחלון הצי הראשון (~${fleetWindowH !== null ? fleetWindowH.toFixed(1) : "?"} שע')`,
          "2. אוטומטי: רישום txid חזרה ל-SignRequest + עדכון סטטוס",
          "3. owner (אופציונלי): טעינת מפתח-בעלים → power-up 9.682 HIVE דרך נתיב ה-DEX (authority-gate מאמת)",
          `4. רגן טבעי: סף-קל 8% בעוד ~${lightH.toFixed(1)} שע'`
        ],
    isReadyForAnchor: false,
    isDryRunOnly: hiveDryRunOnly,
    ownerOptions: [
      `אוטומטי (ברירת-מחדל): עיגון-צי בחלון הראשון (~${fleetWindowH !== null ? fleetWindowH.toFixed(1) : "?"} שע')`,
      "טעינת מפתח-בעלים למעטפת → power-up 9.682 HIVE של הראשי (האצה ×~1.6)",
      "המתנה לרגן טבעי לסף-הקל (8%)"
    ],
    ownerAction: "אין פעולה נדרשת — התור האוטומטי מבצע; טעינת מפתח-הבעלים (fleet_vault --seal) מהירה את הקצב דרך power-up",
    estimatedTime: fleetLanded ? "מיידי (עוגן בוצע)" : `חלון-צי ~${fleetWindowH !== null ? fleetWindowH.toFixed(1) : "?"} שע' · סף-קל 8% ~${lightH.toFixed(1)} שע' · סף-כבד 12% ~${heavyH.toFixed(1)} שע'`,
    estimatedCost: null,
    resourceLiveChecked: true
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
    blocker: tronEnergy > 0 ? vaultBlocker : "transit לפי החלטת בעלים (decided-custom 2026-09-09): המשך רכבת tronbridge היומית — energy=0 מדידה חיה 2026-09-08T22:05Z, יתרה מרבית 17.6 TRX מתחת לסף-שריפה",
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
    ownerAction: "transit אושר כברירת-מחדל הכלכלית (החלטת בעלים); מימון TRX לעיגון-ישיר נשאר אופציונלי — פעולה כלכלית באישור בעלים בלבד",
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
