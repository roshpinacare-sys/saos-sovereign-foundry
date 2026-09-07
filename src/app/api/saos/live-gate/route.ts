import { NextResponse } from "next/server";
import { existsSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { audit, adminKeyHash, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { saosMode } from "@/lib/saos/modes";
import { verifyChainDag } from "@/lib/saos/evidence";
import { networkStatuses } from "@/lib/saos/network-status";
import { signerRegistry } from "@/lib/saos/signer";

export const dynamic = "force-dynamic";

/**
 * /api/saos/live-gate — the go-live checklist (Task 5, mission 3).
 *
 * GET   → full check run: ok / readyForLive / blockers[] / warnings[] / checks[]
 * POST  → go-live ATTEMPT: same run + auth required + audited. Activation itself
 *         still requires the server restart with SAOS_MODE=live AND
 *         SAOS_LIVE_CONFIRM=YES (double-flag, no runtime shortcut — by design).
 *
 * Fail-closed: any fail check ⇒ readyForLive=false with the exact missing list.
 */

type CheckStatus = "pass" | "warn" | "fail";
interface GateCheck {
  id: string;
  status: CheckStatus;
  detail: string;
}
interface GateBlocker {
  id: string;
  detail: string;
}

const BACKUP_MAX_AGE_MS = 7 * 24 * 3_600_000;
const SIGN_TTL_H = Number(process.env.SAOS_SIGN_TTL_H ?? 24);

async function runGate(deep: boolean) {
  const checks: GateCheck[] = [];
  const add = (id: string, status: CheckStatus, detail: string) => checks.push({ id, status, detail });

  // 1. access control configured
  add(
    "auth-configured",
    adminKeyHash() ? "pass" : "fail",
    adminKeyHash() ? "SAOS_ADMIN_KEY_HASH מוגדר — שכבת-הרשאות פעילה" : "SAOS_ADMIN_KEY_HASH חסר — פעולות רגישות נדחות ולא ניתן להתחבר"
  );

  // 2. rate limiting active (compiled-in module with per-route defaults)
  add("rate-limit-active", "pass", "הגבלת-קצב בזיכרון פעילה על כל נקודות /api/saos/* (ברירות-מחדל + אחלפי SAOS_RL_*)");

  // 3. mode gate — double-flag protection
  const mode = saosMode();
  add(
    "mode-gate",
    "pass",
    `מצב=${mode.mode}; מעבר ל־live דורש SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES (הגנת-להבה-כפולה) — broadcastCapable=${mode.broadcastCapable}`
  );

  // 4. verified backup exists (fresh within 7 days)
  const lastBackup = await db.opLog.findFirst({ where: { op: "backup" }, orderBy: { createdAt: "desc" } });
  let backupFresh = false;
  let backupDetail = "אין רישום גיבוי מאומת (הרץ bun run backup)";
  if (lastBackup) {
    const ageMs = Date.now() - lastBackup.createdAt.getTime();
    backupFresh = ageMs < BACKUP_MAX_AGE_MS;
    backupDetail = backupFresh
      ? `גיבוי מאומת: ${lastBackup.detail ?? ""} (${Math.round(ageMs / 3_600_000)} שעות)`
      : `גיבוי אחרון בן ${Math.round(ageMs / 86_400_000)} ימים — דורש גיבוי חדש`;
  }
  add("backup-verified", backupFresh ? "pass" : "fail", backupDetail);

  // 5. restore plan present (docs deployed with the runtime)
  const runbookPath = path.join(process.cwd(), "docs", "runbook.md");
  const restoreDoc = existsSync(runbookPath);
  add(
    "restore-plan",
    restoreDoc ? "pass" : "warn",
    restoreDoc ? "תוכנית שחזור מתועדת (docs/runbook.md) זמינה בראנטיים" : "docs/runbook.md לא נמצא בתיקיית הריצה — יש לפרוס את התיעוד עם התמונה"
  );

  // 6. receipt-chain integrity (always — cheap; leaves proofs in deep mode only)
  const receipts = await db.evidenceReceipt.findMany({ orderBy: { createdAt: "asc" } });
  const chain = await verifyChainDag(
    receipts.map((r) => ({ kind: r.kind, at: r.at?.toISOString() ?? r.createdAt.toISOString(), payload: JSON.parse(r.payload) as Record<string, unknown>, prevDigest: r.prevDigest, digest: r.digest }))
  );
  add(
    "chain-integrity",
    chain.ok ? "pass" : "fail",
    chain.ok
      ? `שרשרת-קבלות תקינה (${receipts.length} קבלות, פיצולים מדווחים: ${chain.forks.length})`
      : `שרשרת פגומה: digestErrors=${chain.digestErrors.length} linkErrors=${chain.linkErrors.length}`
  );

  // 7. external networks — any ready for real anchoring?
  const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
  const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
  const networks = networkStatuses(rcPct, tronEnergy);
  const unblocked = networks.filter((n) => n.blocker === null);
  add(
    "networks-ready",
    unblocked.length > 0 ? "pass" : "warn",
    unblocked.length > 0
      ? `רשתות מוכנות: ${unblocked.map((n) => n.network).join(", ")}`
      : `כל הרשתות חסומות (advisory): ${networks.map((n) => n.network).join(", ")} — דורש כספת/משאבים (מפורט ב-status.networks)`
  );

  // 8. known open security items (honest constants — update as items close)
  const openSecurity: string[] = [
    "GitHub Actions CI לא קיים (הרצה ידנית של bun run check)",
    "SQLite single-writer — לא לפריסה אופקית",
    "secure-cookie דורש HTTPS בפריסה אמיתית",
    "אין session revocation גלובלי (שינוי SAOS_SESSION_SECRET מבטל הכול)"
  ];
  add("security-open", "warn", `פריטי אבטחה פתוחים (${openSecurity.length}): ${openSecurity.join(" · ")}`);

  // 9. signer attached — broadcast needs SOME signer connected
  const registry = signerRegistry();
  const connected = registry.filter((s) => s.signer !== "none" && s.status !== "disconnected");
  add(
    "signer-attached",
    connected.length > 0 ? "pass" : "fail",
    connected.length > 0
      ? `חותם מחובר: ${connected.map((s) => s.signer).join(", ")}`
      : "אין חותם מחובר (manual זמין-הכנה בלבד) — שידור אמיתי בלתי-אפשרי עד חיבור כספת מחוץ למערכת"
  );

  // 10. fresh check suite — operator responsibility, can't be known at runtime
  add("tests-green", "warn", `דרושה הרצת bun run check טרייה לפני מעבר ל־live (lint+typecheck+api+concurrency; sign-ttl ${SIGN_TTL_H}h)`);

  // deep mode adds full leaf proofs via the internal verify pipeline
  let deepResult: string | null = null;
  if (deep) {
    try {
      const res = await fetch(`http://localhost:${process.env.PORT ?? 3000}/api/saos/verify-chain`, { cache: "no-store" });
      const body = (await res.json()) as { proofResult?: string };
      deepResult = body.proofResult ?? null;
    } catch {
      deepResult = "unreachable";
    }
  }

  const blockers: GateBlocker[] = checks.filter((c) => c.status === "fail").map((c) => ({ id: c.id, detail: c.detail }));
  const warnings: GateBlocker[] = checks.filter((c) => c.status === "warn").map((c) => ({ id: c.id, detail: c.detail }));
  const readyForLive = blockers.length === 0;

  return { checks, blockers, warnings, readyForLive, mode, deepResult };
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("live-gate", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const url = new URL(req.url);
    const deep = url.searchParams.get("deep") === "1";
    const gate = await runGate(deep);
    return NextResponse.json({
      ok: true,
      readyForLive: gate.readyForLive,
      mode: gate.mode.mode,
      blockers: gate.blockers,
      warnings: gate.warnings,
      checks: gate.checks,
      deepProofResult: gate.deepResult,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "live-gate failed" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const rl = enforceRateLimit("live-gate", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const auth = requireAuth(req);
    if (!auth.ok) {
      await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "POST /live-gate", allowed: false, req, detail: auth.error });
      return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
    }
    const gate = await runGate(false);
    await audit({
      kind: "live-gate-attempt",
      actor: auth.actorRef,
      action: "POST /live-gate",
      allowed: gate.readyForLive,
      req,
      detail: `blockers=${gate.blockers.length} warnings=${gate.warnings.length}`
    });
    return NextResponse.json({
      ok: true,
      readyForLive: gate.readyForLive,
      mode: gate.mode.mode,
      activationPath: gate.readyForLive
        ? "המערכת מוכנה: הפעלה מחייבת הפעלה-מחדש של השרת עם SAOS_MODE=live ו-SAOS_LIVE_CONFIRM=YES (אין קיצור-דרך בראנטיים)"
        : "המערכת לא מאשרת מעבר ל־live — חסימות:",
      blockers: gate.blockers,
      warnings: gate.warnings,
      checks: gate.checks,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "live-gate failed" }, { status: 200 });
  }
}
