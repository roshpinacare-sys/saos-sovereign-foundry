/**
 * Anchor preflight — core computation (Task 6, extracted to lib in Task 13).
 *
 * Answers ONE question honestly: is the system ready for a REAL anchor right
 * now — without performing one, without touching keys, without broadcasting.
 * Read-only: no auth needed to READ readiness (no secret here), and it never
 * performs an anchor and never mutates state.
 *
 * Consumed by:
 *   - GET /api/saos/anchor-preflight (full contract, shape unchanged)
 *   - GET /api/saos/live-proof (compact readiness view)
 *
 * The 10 checks (each → pass/warn/fail):
 *   1. backup-fresh-verified   fresh verified backup (<7d, per backup manifest + OpLog)
 *   2. auth-ready              SAOS_ADMIN_KEY_HASH configured (fail-closed otherwise)
 *   3. rate-limit-ready        limiter active with per-route rules
 *   4. seal-present            at least one valid seal exists in the chain
 *   5. chain-intact            receipt chain digests+links verify (forks disclosed)
 *   6. network-status-clear    target network has an explicit status (not unknown)
 *   7. network-resources       STEEM/BLURT state+permissions / HIVE RC / TRON energy
 *   8. signature-request-open  an open SignRequest exists (or can be created)
 *   9. security-open-items     known open security items (warn, never hidden)
 *  10. mode-allows-broadcast   current mode permits real broadcast (live + confirm)
 *
 * readyForAnchor=false ⇒ NOT ready: blockers[] says exactly what is missing, and
 * recommendedNextAction names the single next step. Fail-closed by design.
 */

import { statSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { adminKeyHash } from "@/lib/saos/auth";
import { saosMode } from "@/lib/saos/modes";
import { verifyChainDag } from "@/lib/saos/evidence";
import { networkStatuses, type NetworkStatusView } from "@/lib/saos/network-status";
import { signerRegistry, effectiveStatus, type SignRequest } from "@/lib/saos/signer";
import { OWNER_DECISIONS } from "@/lib/saos/owner-decisions";

export type CheckStatus = "pass" | "warn" | "fail";
export interface PreflightCheck {
  id: string;
  status: CheckStatus;
  detail: string;
}
export interface PreflightBlocker {
  id: string;
  detail: string;
}

const BACKUP_MAX_AGE_MS = 7 * 24 * 3_600_000;

/**
 * First-anchor readiness (מוכנות לעוגן ראשון — Task 11 part ה).
 * Honest, three-value status — never "ready" here: even a fully green gate
 * stays "conditional" until the owner approves live AND signs outside the
 * system. Computed from the same checks as the preflight itself — no new
 * claims, no new calls, no broadcast.
 */
function firstAnchorReadiness(
  hardBlockers: PreflightBlocker[],
  networks: NetworkStatusView[],
  externalSignerConnected: boolean,
  openCriticalDecisions: number
): {
  status: "not-ready" | "partial" | "conditional";
  recommendedNetwork: string | null;
  recommendedReason: string;
  blockers: { id: string; detail: string }[];
  requiredResource: string;
  ownerAction: string;
  openCriticalDecisions: number;
  runbook: string;
} {
  // recommended network: among networks with NO resource blocker of their own
  // (status anchored), prefer the one with a verified historic anchor.
  const resourceReady = networks.filter((n) => n.status === "anchored");
  const historicReady = resourceReady.filter((n) => n.lastVerifiedAnchor !== null);
  const recommended = historicReady[0] ?? resourceReady[0] ?? null;
  const recommendedReason = recommended
    ? `${recommended.network}: אין חוסם-משאב ייחודי (סטטוס anchored)${recommended.lastVerifiedAnchor ? " וקיים עוגן היסטורי מאומת" : ""} — החסם היחיד הוא חיבור כספת חתימה חיצונית`
    : "אין רשת ללא חוסם-משאב — יש להשלים משאבים (HIVE RC / TRON energy) לפני בחירה";

  const status: "not-ready" | "partial" | "conditional" =
    hardBlockers.length > 0 ? "not-ready" : !externalSignerConnected || openCriticalDecisions > 0 ? "partial" : "conditional";

  return {
    status,
    recommendedNetwork: recommended?.network ?? null,
    recommendedReason,
    blockers: hardBlockers,
    requiredResource: recommended
      ? "כספת חתימה חיצונית (מפתח רשת משוחזר מחוץ למערכת) — המערכת מקבלת רק את התוצאה הציבורית"
      : "משאבי רשת (HIVE RC ≥ 8% או TRON stake) + כספת חתימה חיצונית",
    ownerAction:
      "לאשר את רשת-היעד, לשחזר את הכספת מחוץ למערכת (docs/external-signer.md), לסגור החלטות קריטיות פתוחות, ולאשר live רק אחרי שהשער ירוק — הליך מלא: docs/first-anchor-runbook.md",
    openCriticalDecisions,
    runbook: "docs/first-anchor-runbook.md"
  };
}

/** SH-7 disclosure: is the local admin-key file still inside the project tree?
 *  EXISTENCE ONLY via stat — the content is never read, printed or stored. */
function adminKeyFileInTree(): boolean {
  try {
    return statSync(path.join(process.cwd(), "upload", "saos-admin-key.txt")).isFile();
  } catch {
    return false;
  }
}

export interface PreflightResult {
  mode: ReturnType<typeof saosMode>;
  checks: PreflightCheck[];
  readyForAnchor: boolean;
  blockers: PreflightBlocker[];
  warnings: PreflightBlocker[];
  backupFresh: boolean;
  authReady: boolean;
  sealCount: number;
  receiptsCount: number;
  chainOk: boolean;
  chainForks: unknown[];
  networks: NetworkStatusView[];
  rcPct: number;
  tronEnergy: number;
  signatureQueue: {
    open: number;
    signedExternally: number;
    recorded: number;
    expired: number;
    cancelled: number;
    failed: number;
  };
  externalSignerConnected: boolean;
  signerReady: boolean;
  openCriticalDecisions: number;
  openCriticalDecisionKeys: string[];
  needsResourceDecisionKeys: string[];
  firstAnchorReadiness: ReturnType<typeof firstAnchorReadiness>;
  recommendedNextAction: string;
}

export async function computePreflight(target: SignRequest["network"] | null): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const add = (id: string, status: CheckStatus, detail: string) => checks.push({ id, status, detail });
  const mode = saosMode();

  // 1. fresh verified backup
  const lastBackup = await db.opLog.findFirst({ where: { op: "backup" }, orderBy: { createdAt: "desc" } });
  let backupFresh = false;
  if (lastBackup) {
    backupFresh = Date.now() - lastBackup.createdAt.getTime() < BACKUP_MAX_AGE_MS;
  }
  add(
    "backup-fresh-verified",
    backupFresh ? "pass" : "fail",
    backupFresh
      ? `גיבוי מאומת טרי: ${lastBackup?.detail ?? ""}`
      : "אין גיבוי טרי ומאומת (<7 ימים) — הרץ bun run backup (אין עוגן אמיתי בלי גיבוי)"
  );

  // 2. access control
  const authReady = adminKeyHash() !== null;
  add("auth-ready", authReady ? "pass" : "fail", authReady ? "שכבת-הרשאות מוגדרת (SAOS_ADMIN_KEY_HASH)" : "SAOS_ADMIN_KEY_HASH חסר — כל פעולה רגישה נדחית (fail-closed)");

  // 3. rate limiting
  add("rate-limit-ready", "pass", "הגבלת-קצב פעילה על כל /api/saos/* (60s חלון קבוע, 429 + Retry-After)");

  // 4. at least one valid seal
  const sealCount = await db.sealRecord.count();
  add("seal-present", sealCount > 0 ? "pass" : "fail", sealCount > 0 ? `${sealCount} חותמות בשרשרת` : "אין חותמות — אין מה לעגן (הרץ POST /seal)");

  // 5. chain records intact
  const receipts = await db.evidenceReceipt.findMany({ orderBy: { createdAt: "asc" } });
  const chain = await verifyChainDag(
    receipts.map((r) => ({ kind: r.kind, at: r.at?.toISOString() ?? r.createdAt.toISOString(), payload: JSON.parse(r.payload) as Record<string, unknown>, prevDigest: r.prevDigest, digest: r.digest }))
  );
  const chainIntact = chain.ok;
  add(
    "chain-intact",
    chainIntact ? "pass" : "fail",
    chainIntact ? `שרשרת-הקבלות תקינה (${receipts.length} קבלות, פיצולים מדווחים: ${chain.forks.length})` : `שרשרת פגומה: digestErrors=${chain.digestErrors.length} linkErrors=${chain.linkErrors.length} — איסור עגינה`
  );

  // 6. target network with clear status + 7. resources
  const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
  const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
  const networks: NetworkStatusView[] = networkStatuses(rcPct, tronEnergy);
  const chosen = target ? networks.filter((n) => n.network === target) : networks;
  const statusClear = chosen.length > 0 && chosen.every((n) => ["anchored", "pending", "gated", "transit"].includes(n.status));
  add(
    "network-status-clear",
    statusClear ? "pass" : "fail",
    statusClear
      ? `סטטוס מפורש לכל רשת-יעד: ${chosen.map((n) => `${n.network}=${n.status}`).join(", ")}${target ? ` (יעד: ${target})` : " (כל הרשתות)"}`
      : `אין סטטוס ברור לרשת-היעד${target ? ` (${target} לא מוכרת או חסרה)` : ""}`
  );

  const resourceFails: string[] = [];
  const resourceWarns: string[] = [];
  for (const n of chosen) {
    if (n.network === "HIVE" && rcPct < 8) resourceFails.push(`HIVE RC ${rcPct}% < 8% (סף-קל)`);
    if (n.network === "TRON" && tronEnergy <= 0) resourceFails.push("TRON energy=0 (נדרש הימור או שריפה)");
    if (n.network === "STEEM" || n.network === "BLURT") {
      resourceWarns.push(`${n.network}: בדיקת-קריאה חיה זמינה ב-/api/saos/live-proof; הרשאות-שידור (state/permissions) מאומתות רק סמוך לעוגן אמיתי (advisory)`);
    }
    // Task 12: Ethereum/Solana — not-configured is a WARN-state, never a fail:
    // missing RPC is the expected dry-run posture, not a broken gate.
    if (n.network === "ETHEREUM") {
      resourceWarns.push(
        n.rpcStatus === "not-configured"
          ? "ETHEREUM: not-configured — אין ETH_RPC_URL; dry-run בלבד, אין בדיקת קריאה (לא חסימה קשה)"
          : "ETHEREUM: RPC ציבורי מוגדר — קריאה-בלבד אפשרית; עדיין dry-run עד חותם חיצוני ואישור בעלים"
      );
    }
    if (n.network === "SOLANA") {
      resourceWarns.push(
        n.rpcStatus === "not-configured"
          ? "SOLANA: not-configured — אין SOL_RPC_URL; dry-run בלבד, אין בדיקת קריאה (לא חסימה קשה)"
          : "SOLANA: RPC ציבורי מוגדר — קריאה-בלבד אפשרית; עדיין dry-run עד חותם חיצוני ואישור בעלים"
      );
    }
  }
  add(
    "network-resources",
    resourceFails.length > 0 ? "fail" : resourceWarns.length > 0 ? "warn" : "pass",
    resourceFails.length > 0
      ? `משאבי רשת חסרים: ${resourceFails.join(" · ")}`
      : resourceWarns.length > 0
        ? resourceWarns.join(" · ")
        : "משאבי רשת בסף הנדרש לכל רשת-יעד"
  );

  // 8. open signature request?
  const sigRows = await db.pendingSignature.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const statuses = sigRows.map((r) => effectiveStatus(r));
  const openQueue = statuses.filter((s) => s === "pending" || s === "awaiting-approval").length;
  const signedExternally = statuses.filter((s) => s === "signed-externally").length;
  const recordedCount = statuses.filter((s) => s === "recorded").length;
  const expiredCount = statuses.filter((s) => s === "expired").length;
  const cancelledCount = statuses.filter((s) => s === "cancelled").length;
  const failedCount = statuses.filter((s) => s === "failed").length;
  add(
    "signature-request-open",
    openQueue > 0 ? "pass" : "warn",
    openQueue > 0
      ? `יש בקשת חתימה פתוחה (${openQueue}) — ממתינה לחתימה חיצונית ולרישום תוצאה ציבורית`
      : "אין בקשת חתימה פתוחה — צור אחת ב-POST /api/saos/signer (חתימה מחוץ למערכת)"
  );

  // 9. open security items — DYNAMIC (Task 13: doc-reality alignment).
  //    Stale claims are lies; each item here reflects measured reality:
  //    CI exists and ran green (run #4, 4e853a9); SH-7 shows only when the
  //    admin-key file is actually back inside the project tree.
  const openSecurity: string[] = [
    "SQLite single-writer — לא לפריסה אופקית",
    "secure-cookie דורש HTTPS בפריסה אמיתית"
  ];
  if (adminKeyFileInTree()) {
    openSecurity.push("קובץ מפתח-אדמין מקומי בתוך עץ הפרויקט — נדרשת העברה מחוץ לעץ (SH-7, החלטת בעלים)");
  }
  add("security-open-items", "warn", `פריטי אבטחה פתוחים (${openSecurity.length}): ${openSecurity.join(" · ")}`);

  // 10. mode allows real broadcast
  const broadcastOk = mode.mode === "live" && mode.broadcastCapable;
  add(
    "mode-allows-broadcast",
    broadcastOk ? "pass" : mode.mode === "live" ? "warn" : "fail",
    broadcastOk
      ? "מצב live פעיל ומאפשר שידור"
      : mode.mode === "live"
        ? "live מאושר אך broadcastCapable=false — אין חותם חיצוני מחובר"
        : `מצב ${mode.mode} — אין שידור אמיתי; עוגן אמיתי דורש SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES ואישור בעלים מפורש`
  );

  // signer readiness summary
  const registry = signerRegistry();
  const signerReady = registry.some((s) => s.signer !== "none" && (s.status === "ready" || s.status === "awaiting-approval"));
  const externalSignerConnected = registry.some((s) => (s.signer === "external" || s.signer === "hardware") && s.status !== "disconnected");

  const readyForAnchor = checks.every((c) => c.status !== "fail");
  const blockers: PreflightBlocker[] = checks.filter((c) => c.status === "fail").map((c) => ({ id: c.id, detail: c.detail }));
  const warnings: PreflightBlocker[] = checks.filter((c) => c.status === "warn").map((c) => ({ id: c.id, detail: c.detail }));

  // open CRITICAL owner decisions (registry is doc-compiled; recorded status lives in DB)
  const recordedDecisions = await db.decisionRecord.findMany();
  const statusOf = (key: string) => recordedDecisions.find((r) => r.key === key)?.status ?? "open";
  const openCriticalDecisions = OWNER_DECISIONS.filter((d) => d.critical && statusOf(d.key) === "open").length;
  const openCriticalDecisionKeys = OWNER_DECISIONS.filter((d) => d.critical && statusOf(d.key) === "open").map((d) => d.key);
  const needsResourceDecisionKeys = OWNER_DECISIONS.filter((d) => statusOf(d.key) === "needs-resource").map((d) => d.key);

  const recommendedNextAction = blockers.some((b) => b.id === "backup-fresh-verified")
    ? "הרץ bun run backup ואמת את הגיבוי (manifest + integrity)"
    : blockers.some((b) => b.id === "auth-ready")
      ? "הגדר SAOS_ADMIN_KEY_HASH (רק hash — לעולם לא המפתח עצמו)"
      : blockers.some((b) => b.id === "seal-present")
        ? "הרץ פעימה (POST /api/saos/seal) כדי ליצור חותמה לעיגון"
        : blockers.some((b) => b.id === "chain-intact")
          ? "עצור — שרשרת פגומה; חקור לפני כל עגינה (docs/runbook.md)"
          : blockers.some((b) => b.id === "network-resources")
            ? "השלם משאבי רשת (HIVE RC ≥ 8% / TRON stake) — תוכניות ב-status.networks[].unblockPlan"
            : blockers.some((b) => b.id === "mode-allows-broadcast")
              ? "עוגן אמיתי דורש אישור בעלים + הפעלה-מחדש עם SAOS_MODE=live ו-SAOS_LIVE_CONFIRM=YES; בינתיים: תרגול יבש לפי docs/anchor-preflight.md §5"
              : openQueue === 0
                ? "צור בקשת חתימה (POST /api/saos/signer), חתום מחוץ למערכת, ורשום את התוצאה הציבורית (PATCH /api/saos/signer)"
                : "חתום מחוץ למערכת ורשום את התוצאה הציבורית (PATCH /api/saos/signer {id, txid, proofRef, verify:true})";

  return {
    mode,
    checks,
    readyForAnchor,
    blockers,
    warnings,
    backupFresh,
    authReady,
    sealCount,
    receiptsCount: receipts.length,
    chainOk: chainIntact,
    chainForks: chain.forks,
    networks,
    rcPct,
    tronEnergy,
    signatureQueue: {
      open: openQueue,
      signedExternally,
      recorded: recordedCount,
      expired: expiredCount,
      cancelled: cancelledCount,
      failed: failedCount
    },
    externalSignerConnected,
    signerReady,
    openCriticalDecisions,
    openCriticalDecisionKeys,
    needsResourceDecisionKeys,
    firstAnchorReadiness: firstAnchorReadiness(blockers, networks, externalSignerConnected, openCriticalDecisions),
    recommendedNextAction
  };
}
