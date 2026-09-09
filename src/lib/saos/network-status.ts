/**
 * Network status view (מצב רשתות חוץ) — computed, honest, LIVE-DERIVED.
 * Task 33: the STEEM/HIVE/BLURT blockers are no longer hardcoded snapshots
 * (the "0/11 matches" text went stale the moment Task 32 re-ingested and
 * live-verified the owner's keys). They now derive from the signer's
 * /keys/status snapshot — public derived-pubkey match booleans vs the CURRENT
 * on-chain authorities (60s cache, fail-closed). No snapshot ⇒ honest
 * "not yet checked" text, never a fake ready.
 * Iron rule for this stage: read-only computation only — no broadcast, no
 * signing, no wallet use. Every field is either a documented constant,
 * a measured historic fact, or derived from live public state.
 */

import { HIVE_RC_FLOOR_HEAVY, HIVE_RC_FLOOR_LIGHT, hiveRcHoursToTarget, BLURT_COOLDOWN_MIN, BLURT_FEE_FORMULA } from "./anchor-gates";
import { minStakeForSettlements } from "./tron-energize";
import { HISTORIC_ANCHORS } from "./historic";
import { externalSignerKeyMatchesCached, type SignerKeyMatches } from "./external-signer-client";
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

export function networkStatuses(rcPct: number, tronEnergy: number, keys?: SignerKeyMatches | null): NetworkStatusView[] {
  const historicOf = (n: NetworkName) => HISTORIC_ANCHORS.find((h) => h.network === n);
  // Task 26 (live forensics 2026-09-08): the external signer IS connected
  // (mini-services/external-signer :3033, envelope GCM-genuine), but the sealed
  // envelope's STEEM keys derive to pubkeys that are NOT the on-chain
  // authorities of any of the 11 fleet accounts — the live runtime anchors
  // with its own keys. The honest blocker is key-AUTHORIZATION, not key-ABSENCE.
  const signer = keys ?? externalSignerKeyMatchesCached();
  const signerConnected = signer.connected;
  // Task 33: per-network live match summary from the signer (main account).
  const netMatch = (net: string) => signer.byNetwork[net] ?? null;
  const netReady = (net: string) => Boolean(signerConnected && netMatch(net)?.allMatched);
  const netMatchLabel = (net: string) => {
    const m = netMatch(net);
    return m ? `${m.matched}/${m.total}` : "0/0";
  };
  // Task 26-c forensics (2026-09-09, live-verified): the envelope keys match
  // HIVE chain authority for 9/9 fleet accounts (posting+active). The honest
  // blocker is key-custody (owner), not software — UNTIL the keys are loaded
  // AND verified live, after which the network reports READY (Task 33).
  const keysPendingBlocker = signerConnected
    ? "keys-owner-held: מפתחות בחזקת הבעלים; החותם-החיצוני מחובר אך אין סלוטים מאומתים לרשת זו — נדרש ingest (verify-then-write) דרך /keys/ingest"
    : "vault: אין מפתחות חתימה בסנדבוקס (שלב 2 — שחזור כספת)";

  const nowIso = new Date().toISOString();
  // Task 26-c: HIVE has a REAL broadcast path when the signer is connected —
  // the 9 fleet accounts' posting keys verify live, and the fleet-cure daemon
  // auto-executes the pending weave at the first RC window.
  const fc = fleetCureStatus();
  const steemReady = netReady("STEEM");
  const hiveReady = netReady("HIVE");
  const blurtReady = netReady("BLURT");
  const dryRunOnly = !steemReady; // Task 33: STEEM has a REAL broadcast path once its slots verify live
  const hiveDryRunOnly = !hiveReady; // HIVE: real path via main slots + fleet + signer

  const steem: NetworkStatusView = {
    network: "STEEM",
    status: "anchored",
    mode: steemReady ? "direct" : "advisory",
    chainType: "graphene",
    chainId: null,
    anchorTypes: ["custom_json op (saos.weave.v1)"],
    rpcStatus: "public",
    liveProbePossible: true,
    lastChecked: nowIso,
    lastVerifiedAnchor: historicOf("STEEM")?.txRef ?? null,
    nextAction: steemReady
      ? `מוכנה לעגן עכשיו — ${signer.mainAccount ?? "החשבון-הראשי"} מאומת חי מול השרשרת (סלוטים STEEM ${netMatchLabel("STEEM")}); הפעימה הבאה משדרת custom_json saos.weave.v1 דרך החותם-החיצוני ורושמת txid מלא`
      : "בפעימת live הבאה: שידור custom_json saos.weave.v1 + שמירת txid מלא ב-AnchorTx; בדיקת-קריאה חיה זמינה ב-/api/saos/live-proof",
    blocker: steemReady ? null : keysPendingBlocker,
    requiredResource: steemReady ? null : "posting key (active למבצעים מורחבים) — שחזור כספת",
    unblockPlan: steemReady
      ? []
      : [
          "1. שחזור מפתח מהכספת ההיסטורית (מחוץ לסנדבוקס)",
          "2. SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES",
          "3. פעימה: custom_json id=saos.weave.v1 עם ה-root",
          "4. עדכון AnchorTx: status=anchored, txid מלא"
        ],
    isReadyForAnchor: steemReady,
    isDryRunOnly: dryRunOnly,
    ownerOptions: steemReady
      ? [
          "עיגן STEEM דרך הפעימה הרגילה — אין מניעה טכנית (סלוטים מאומתים חי)",
          "שמירת STEEM כרשת-עוגן ראשית לצד HIVE (עיגון-צי)"
        ]
      : [
          "טעינת מפתח-הבעלים (STEEM) למעטפת באמצעות fleet_vault --seal על הרנטיים החי",
          "השארת STEEM כרשת-גיבוי ובחירת HIVE (עיגון-צי) כיעד ראשון"
        ],
    ownerAction: steemReady
      ? "אין פעולה נדרשת — המפתחות מחוברים ומאומתים מול השרשרת (חותם-חיצוני, authority-gate פעיל לפני כל שידור)"
      : "לטעון את מפתחות ה-STEEM שבחזקת הבעלים למעטפת (fleet_vault --seal) — המערכת מאמתת סמכות מול השרשרת לפני כל שידור",
    estimatedTime: null,
    estimatedCost: null,
    resourceLiveChecked: steemReady
  };

  const blurt: NetworkStatusView = {
    network: "BLURT",
    status: "anchored",
    mode: blurtReady ? "direct" : "advisory",
    chainType: "graphene",
    chainId: null,
    anchorTypes: ["custom_json op (canonical low-s)"],
    rpcStatus: "public",
    liveProbePossible: true,
    lastChecked: nowIso,
    lastVerifiedAnchor: historicOf("BLURT")?.txRef ?? null,
    nextAction: blurtReady
      ? `מוכנה לעגן עכשיו — סלוטים BLURT מאומתים חי (${netMatchLabel("BLURT")}); חתימה קנונית (low-s loop) בפעימה הבאה`
      : `בפעימת live הבאה: חתימה קנונית (low-s loop), עמלה ${BLURT_FEE_FORMULA}, שמירת cooldown ${BLURT_COOLDOWN_MIN} דק'`,
    blocker: blurtReady
      ? null
      : signerConnected
        ? `keys-missing-blurt: לחותם-החיצוני אין סלוטי BLURT מאומתים (רשתות-חותם פעילות: ${signer.networks.join(", ") || "—"}) — עיגון BLURT דורש ingest מפתח-active + יתרת עמלה`
        : keysPendingBlocker,
    requiredResource: blurtReady ? null : "active key + יתרת BLURT לעמלה",
    unblockPlan: blurtReady
      ? []
      : [
          "1. שחזור מפתח מהכספת",
          "2. בדיקת יתרה לכיסוי 0.05 + 0.2 × KB",
          "3. פעימה + קריאת-חזרה של הבלוק לאימות",
          "4. עדכון AnchorTx"
        ],
    isReadyForAnchor: blurtReady,
    isDryRunOnly: !blurtReady,
    ownerOptions: blurtReady
      ? ["עיגון BLURT דרך הפעימה הרגילה — אין מניעה טכנית"]
      : [
          "שחזור כספת (מחוץ למערכת) + בדיקת יתרה לכיסוי העמלה",
          "השארת BLURT כרשת-גיבוי"
        ],
    ownerAction: blurtReady
      ? "אין פעולה נדרשת — המפתחות מחוברים ומאומתים מול השרשרת"
      : "לשחזר את המפתח מהכספת מחוץ למערכת ולוודא יתרה לכיסוי העמלה — המערכת מקבלת רק txid",
    estimatedTime: null,
    estimatedCost: null,
    resourceLiveChecked: blurtReady
  };

  const lightH = hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_LIGHT);
  const heavyH = hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_HEAVY);
  // Task 26-c: the fleet-cure daemon schedules the first REAL HIVE anchor
  // automatically (fleet keys verified 9/9; op-cost 225M RC measured).
  const fleetWindowH = fc.best ? fc.best.etaMin / 60 : null;
  const fleetLanded = Boolean(fc.lastTxid);
  // Task 34: MAIN-account readiness is LIVE-DERIVED — keys verified against the
  // chain AND measured RC above the light floor ⇒ the main path genuinely
  // anchors NOW (op-cost ~225M RC ≈ 0.9% of headcorner's measured max_rc; the
  // 8% light floor exists precisely to keep cheap ops safe). No stale templates.
  const mainReady = hiveReady && rcPct >= HIVE_RC_FLOOR_LIGHT;
  const keysNote = hiveReady
    ? `מפתחות-ראשי מאומתים חי (HIVE ${netMatchLabel("HIVE")}) — נתיב-שידור אמיתי דרך החותם פתוח`
    : signerConnected
      ? `סלוטי HIVE בחותם: ${netMatchLabel("HIVE")} תואמים`
      : "אין חותם מחובר";
  const rcAboveLight = rcPct >= HIVE_RC_FLOOR_LIGHT;
  const hiveBlocker = fleetLanded || mainReady
    ? null
    : fc.best
      ? `rc-floor לחשבון-הראשי: נוכחי ${rcPct}% מתחת לסף-הקל ${HIVE_RC_FLOOR_LIGHT}% — אך זה כבר לא חוסם: חלון-עוגן-צי ראשון בעוד ~${fleetWindowH?.toFixed(1)} שע' (${fc.best.account}) מתוזמן אוטומטית; ${keysNote}`
      : `rc-floor: נוכחי ${rcPct}% מתחת לסף-הקל ${HIVE_RC_FLOOR_LIGHT}% / סף-הכבד ${HIVE_RC_FLOOR_HEAVY}% — ואין חלון צי פעיל; ${keysNote}`;
  const hive: NetworkStatusView = {
    network: "HIVE",
    status: mainReady ? "anchored" : fleetLanded || rcAboveLight ? "pending" : "gated",
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
      : mainReady
        ? `הראשי (headcorner) מוכן לעגן עכשיו — RC מדוד ${rcPct}% מעל סף-הקל ${HIVE_RC_FLOOR_LIGHT}% ומפתחות מאומתים חי; ה-weave מוכן לשידור דרך החותם${fc.best ? `; עוגן-צי אוטומטי נמשך בחלון הראשון (~${Math.round(fc.best.etaMin)} דק', ${fc.best.account})` : ""}`
        : fc.best
          ? `fleet-cure מבצע אוטומטית את ה-weave הממתין בחלון הראשון (~${Math.round(fc.best.etaMin)} דק', ${fc.best.account}) — ריצה אוטומטית, ללא פעולת בעלים${hiveReady ? "; נתיב-ראשי (headcorner) פתוח ומאומת לעיגון מיידי ברגע שה-RC מגיע לסף" : ""}`
          : "המתנה לרגן או power-up; אין פעולה חיה עד לסף",
    blocker: hiveBlocker,
    requiredResource: fleetLanded
      ? null
      : mainReady
        ? `אין משאב חוסם — RC מדוד ${rcPct}% ≥ סף-הקל ${HIVE_RC_FLOOR_LIGHT}% לחשבון-הראשי (עלות-op ~225M RC ≈ 0.9% מהמקסימום המדוד)`
        : `מנועת-עלות: RC ≥ 225M ל-op (מדוד) — רגן צי אוטומטי; לחשבון הראשי RC ≥ ${HIVE_RC_FLOOR_LIGHT}% (כ-${lightH.toFixed(1)} שע') או power-up 9.682 HIVE${hiveReady ? " (מפתח-ראשי כבר מחובר ומאומת — הנתיב מוכן)" : " (דורש מפתח-בעלים)"}`,
    unblockPlan: fleetLanded
      ? [
          "1. קצב עיגון-צי קבוע עם backoff כלכלי (כמו relay ה-DEX)",
          "2. power-up 9.682 HIVE של הראשי בטעינת מפתח-בעלים (max_rc ×~1.6)",
          "3. מעקב rc-floor ב-/api/saos/energy?net=hive"
        ]
      : [
          `1. אוטומטי: fleet-cure משדר את ה-weave בחלון הצי הראשון (~${fleetWindowH !== null ? fleetWindowH.toFixed(1) : "?"} שע')`,
          "2. אוטומטי: רישום txid חזרה ל-SignRequest + עדכון סטטוס",
          hiveReady
            ? "3. owner (אופציונלי): power-up 9.682 HIVE — המפתח-ראשי כבר מחובר ומאומת (נתיב ה-DEX, authority-gate מאמת)"
            : "3. owner (אופציונלי): טעינת מפתח-בעלים → power-up 9.682 HIVE דרך נתיב ה-DEX (authority-gate מאמת)",
          `4. רגן טבעי: סף-קל 8% בעוד ~${lightH.toFixed(1)} שע'`
        ],
    isReadyForAnchor: mainReady,
    isDryRunOnly: hiveDryRunOnly,
    ownerOptions: [
      mainReady
        ? `עגינה-ראשית עכשיו — RC מדוד ${rcPct}% ≥ סף-הקל ${HIVE_RC_FLOOR_LIGHT}% והמפתח מאומת חי (ה-weave נשלח דרך החותם, ללא עמלה)`
        : `אוטומטי (ברירת-מחדל): עיגון-צי בחלון הראשון (~${fleetWindowH !== null ? fleetWindowH.toFixed(1) : "?"} שע')`,
      hiveReady
        ? "power-up 9.682 HIVE של הראשי — המפתח כבר מחובר ומאומת חי (האצה ×~1.6, מוכן לביצוע)"
        : "טעינת מפתח-בעלים למעטפת → power-up 9.682 HIVE של הראשי (האצה ×~1.6)",
      "המתנה לרגן טבעי לסף-הקל (8%)"
    ],
    ownerAction: mainReady
      ? "אין פעולה נדרשת — הראשי מוכן לעגן עכשיו (RC מעל סף-הקל, מפתחות מאומתים חי); power-up אופציונלי להאצה"
      : hiveReady
        ? "אין פעולה נדרשת — התור האוטומטי מבצע; נתיב-הראשי מאומת ופתוח (power-up אופציונלי להאצה)"
        : "אין פעולה נדרשת — התור האוטומטי מבצע; טעינת מפתח-הבעלים (fleet_vault --seal) מהירה את הקצב דרך power-up",
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
    blocker: tronEnergy > 0 ? keysPendingBlocker : "transit לפי החלטת בעלים (decided-custom 2026-09-09): המשך רכבת tronbridge היומית — energy=0 מדידה חיה 2026-09-08T22:05Z, יתרה מרבית 17.6 TRX מתחת לסף-שריפה",
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
