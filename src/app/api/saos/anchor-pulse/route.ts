/**
 * POST /api/saos/anchor-pulse — מבצע-הפעימה החי (Task 40)
 *
 * החוליה החסרה בין המערכת לשרשרת: latest SealRecord → buildSignRequest (weave)
 * → externalSignerExecute (חותם-חיצוני, authority-gate) → AnchorTx + אימות
 * ציבורי עצמאי של ה-txid מול השרשרת (verifyTxidPublic).
 *
 * גבולות fail-closed:
 *  - רק במצב live כש-SAOS_LIVE_CONFIRM=YES ו-SAOS_BROADCAST_ENABLE=YES וחותם
 *    חיצוני מחובר (saosMode().broadcastCapable) — אחרת 409 עם ההסבר הכנה.
 *  - custom_json (weave) בלבד — ללא העברות-נכסים, ללא מפתחות בתוך האפליקציה.
 *  - cooldown BLURT 30 דק' (חוק-העמלה הנמדד) — אנטי-ספאם.
 *  - ה-txid נרשם כפי שהחותם החזיר ומאומת מול השרשרת; תוצאה לא-מאומת נשמרת כנה
 *    (meta.verified=false) ולעולם לא מוצגת כעוגן סופי.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { saosMode } from "@/lib/saos/modes";
import { buildSignRequest, verifyTxidPublic } from "@/lib/saos/signer";
import { externalSignerExecute } from "@/lib/saos/external-signer-client";
import { BLURT_COOLDOWN_MIN } from "@/lib/saos/anchor-gates";

type PulseNetwork = "STEEM" | "BLURT" | "HIVE";

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "auth-required: התחברות נדרשת לעיגון חי" },
      { status: auth.authConfigured ? 401 : 403 }
    );
  }

  const rl = enforceRateLimit("anchor-pulse", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: ניסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const mode = saosMode();
  if (!mode.broadcastCapable) {
    return NextResponse.json(
      { ok: false, error: `broadcast-not-armed: ${mode.detail}`, mode: mode.mode },
      { status: 409 }
    );
  }

  let body: { network?: string; authLevel?: string } = {};
  try {
    body = await req.json();
  } catch {}

  const network: PulseNetwork =
    body.network === "BLURT" ? "BLURT" : body.network === "HIVE" ? "HIVE" : "STEEM";
  const authLevel = body.authLevel === "active" ? ("active" as const) : ("posting" as const);

  const seal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
  if (!seal) {
    return NextResponse.json(
      { ok: false, error: "no-seal: אין חותמת לעיגון — הרץ קבוצת kernel/seal תחילה" },
      { status: 404 }
    );
  }

  // BLURT cooldown — anti-spam over the measured fee law
  if (network === "BLURT") {
    const lastAnchor = await db.anchorTx.findFirst({
      where: { network, status: "anchored" },
      orderBy: { createdAt: "desc" }
    });
    if (lastAnchor) {
      const mins = (Date.now() - lastAnchor.createdAt.getTime()) / 60_000;
      if (mins < BLURT_COOLDOWN_MIN) {
        return NextResponse.json(
          {
            ok: false,
            error: `cooldown: עיגון BLURT מאומת אחרון לפני ${mins.toFixed(1)} דק' — סף-הקל ${BLURT_COOLDOWN_MIN} דק'`,
            retryAfterMin: Math.ceil(BLURT_COOLDOWN_MIN - mins)
          },
          { status: 429, headers: { "Retry-After": String(Math.ceil((BLURT_COOLDOWN_MIN - mins) * 60)) } }
        );
      }
    }
  }

  const requestId = `pulse-${network.toLowerCase()}-${Date.now()}`;
  const sr = await buildSignRequest(seal, network, "weave", requestId, 10 * 60_000);

  const exec = await externalSignerExecute({
    requestId,
    network,
    kind: "custom_json",
    payload: sr.payload,
    id: "saos.weave.v1",
    authLevel
  });

  if (!exec.ok || !exec.txid) {
    await audit({
      kind: "anchor-pulse",
      actor: auth.actorRef,
      action: "POST /anchor-pulse",
      allowed: false,
      req,
      detail: `network=${network} authLevel=${authLevel} refused: ${String(exec.error ?? "?").slice(0, 200)}`
    });
    return NextResponse.json(
      { ok: false, error: exec.error ?? "signer-refused: החותם החיצוני סירב", network },
      { status: 502 }
    );
  }

  // independent public verification — the anchor must stand on its own
  const verification = await verifyTxidPublic(network, exec.txid);

  const row = await db.anchorTx.create({
    data: {
      sealId: seal.id,
      network,
      kind: "weave",
      txid: exec.txid,
      status: "anchored",
      gate: null,
      meta: JSON.stringify({
        requestId,
        authLevel,
        account: exec.account ?? null,
        verified: verification.verified,
        verificationSource: verification.source,
        verificationReason: verification.reason,
        confirmedBlock: exec.confirmedBlock ?? null,
        nodeTrxId: exec.nodeTrxId ?? null,
        sealHeight: seal.height,
        at: new Date().toISOString()
      })
    }
  });

  await audit({
    kind: "anchor-pulse",
    actor: auth.actorRef,
    action: "POST /anchor-pulse",
    allowed: true,
    req,
    detail: `network=${network} sealH=${seal.height} txid=${exec.txid.slice(0, 16)}… verified=${verification.verified}`
  });

  return NextResponse.json({
    ok: true,
    anchor: {
      id: row.id,
      network,
      txid: exec.txid,
      sealHeight: seal.height,
      sealRoot: seal.root,
      account: exec.account ?? null,
      verified: verification.verified,
      verificationReason: verification.reason
    },
    mode: mode.mode
  });
}

/** GET — honest state: mode, latest seal, last anchors per network (no side effects) */
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "auth-required" },
      { status: auth.authConfigured ? 401 : 403 }
    );
  }
  const mode = saosMode();
  const seal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
  const anchors = await db.anchorTx.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, network: true, kind: true, txid: true, status: true, gate: true, meta: true, createdAt: true }
  });
  return NextResponse.json({
    ok: true,
    mode: mode.mode,
    broadcastCapable: mode.broadcastCapable,
    modeDetail: mode.detail,
    latestSeal: seal ? { id: seal.id, height: seal.height, root: seal.root, createdAt: seal.createdAt } : null,
    anchors
  });
}
