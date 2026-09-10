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
import { externalSignerExecute, externalSignerHealth } from "@/lib/saos/external-signer-client";
import { BLURT_COOLDOWN_MIN } from "@/lib/saos/anchor-gates";
import { withWriteLock } from "@/lib/saos/receipt-store";

/**
 * roast 56 — the money-class fix on the CALLER side (the 54-1 class, resurrected
 * by its own caller): the pulse used to mint a FRESH requestId per attempt, so
 * the signer's idempotency ledger could never see a retry — a response lost
 * between broadcast and DB-write would have produced a DIFFERENT signed tx on
 * retry = a REAL double broadcast. Now the pulse is write-ahead-intent:
 *
 *   1. deterministic requestId per (seal, network, kind) — every retry of the
 *      same anchor REUSES it, and the signer's ledger (roast 54) collapses
 *      replays to the cached verdict. A lost response self-heals: the next
 *      attempt gets the SAME txid, never a second tx.
 *   2. an intent AnchorTx row (status transit, meta.intent=true, txid null)
 *      is written BEFORE the broadcast and BECOMES the anchor row on success
 *      — no duplicate rows per (seal, network) pulse.
 *   3. ambiguity discipline: 400/403/429 = definitive refusal (nothing was
 *      signed, nothing broadcast) → row marked failed, retry replays the
 *      cached refusal honestly. 502/transport = ambiguous (a broadcast MAY be
 *      in flight) → row stays transit with the ambiguity gate; while the
 *      intent is younger than the signer's 1h ledger TTL the retry replays
 *      the SAME requestId (safe); older than that → 409 refuse unless the
 *      operator explicitly passes confirmFresh:true (a human decides on the
 *      only remaining double-broadcast corner).
 */

const PULSE_KIND = "weave";
/** signer idempotency ledger TTL is 1h — refuse auto-retry past a safety margin */
const LEDGER_TTL_MARGIN_MS = 55 * 60_000;

function safeMeta(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function anchorView(row: {
  id: string;
  network: string;
  txid: string | null;
  status: string;
  gate: string | null;
  meta: string | null;
}, seal: { height: number; root: string }, verified: boolean | null, reason?: string | null) {
  const meta = safeMeta(row.meta);
  return {
    id: row.id,
    network: row.network,
    txid: row.txid,
    sealHeight: seal.height,
    sealRoot: seal.root,
    account: (meta.account as string | null) ?? null,
    status: row.status,
    verified: verified ?? (meta.verified === true),
    verificationReason: reason ?? (meta.verificationReason as string | null) ?? null,
    idempotent: meta.intent === true
  };
}

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

  // roast 56-4: the broadcast gate read externalSignerCached() — a SYNC cache
  // that only refreshes when someone calls the async health(); a fresh process
  // whose warm-up probe raced (or failed once) kept saying "signer not
  // connected" FOREVER, closing the broadcast gate while the signer was alive
  // and reachable (caught LIVE this round: mode lied, /health answered OK).
  // The gate decides a REAL fee-burning broadcast — it gets a FRESH verdict.
  await externalSignerHealth();
  const mode = saosMode();
  if (!mode.broadcastCapable) {
    return NextResponse.json(
      { ok: false, error: `broadcast-not-armed: ${mode.detail}`, mode: mode.mode },
      { status: 409 }
    );
  }

  let body: { network?: string; authLevel?: string; confirmFresh?: boolean } = {};
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

  // ── roast 56: idempotent pulse — resolve-or-create the write-ahead intent ──
  // (serialized in-process: two concurrent pulses resolve the SAME intent;
  // the broadcast itself happens OUTSIDE the lock and is deduped by the
  // signer's single-flight on the deterministic requestId)
  const { intent, requestId } = await withWriteLock(async () => {
    const existing = await db.anchorTx.findFirst({
      where: { sealId: seal.id, network, kind: PULSE_KIND, meta: { contains: '"intent":true' } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      const meta = safeMeta(existing.meta);
      const rid = typeof meta.requestId === "string" ? meta.requestId : null;
      if (existing.txid) return { intent: existing, requestId: rid ?? `pulse-${network.toLowerCase()}-${Date.now()}` };
      if (body.confirmFresh === true && typeof meta.requestId === "string") {
        // human override of the only ambiguous corner (intent older than the ledger TTL)
        const freshId = `pulse-${network.toLowerCase()}-${Date.now()}`;
        const created = await db.anchorTx.create({
          data: {
            sealId: seal.id, network, kind: PULSE_KIND, txid: null,
            status: "transit",
            gate: "broadcast-intent (confirmFresh:true — requestId חדש לאחר עמימות לא-פתורה; הסיכון לשידור-כפול של הניסיון הקודם הוסבר ואושר)",
            meta: JSON.stringify({ intent: true, requestId: freshId, authLevel, confirmFresh: true, supersededRequestId: meta.requestId, sealHeight: seal.height, at: new Date().toISOString() })
          }
        });
        return { intent: created, requestId: freshId };
      }
      return { intent: existing, requestId: rid ?? `pulse-${network.toLowerCase()}-${seal.id}` };
    }
    const requestId = `pulse-${network.toLowerCase()}-${seal.id}`; // deterministic per (seal, network, kind)
    const created = await db.anchorTx.create({
      data: {
        sealId: seal.id, network, kind: PULSE_KIND, txid: null,
        status: "transit",
        gate: "broadcast-intent: נרשם לפני השידור (roast 56) — retry משתמש באותו requestId דטרמיניסטי; השורה הופכת לעוגן בהצלחה",
        meta: JSON.stringify({ intent: true, requestId, authLevel, sealHeight: seal.height, at: new Date().toISOString() })
      }
    });
    return { intent: created, requestId };
  });

  // already anchored for this (seal, network) → return the recorded anchor, NEVER re-broadcast
  if (intent.txid) {
    return NextResponse.json({
      ok: true,
      alreadyAnchored: true,
      anchor: anchorView(intent, seal, null),
      mode: mode.mode
    });
  }

  // ambiguous intent older than the signer ledger TTL — human-in-the-loop
  if (Date.now() - intent.createdAt.getTime() > LEDGER_TTL_MARGIN_MS && body.confirmFresh !== true) {
    const meta = safeMeta(intent.meta);
    return NextResponse.json(
      {
        ok: false,
        error: `ambiguous-broadcast-unresolved: ניסיון-שידור בן ${((Date.now() - intent.createdAt.getTime()) / 60_000).toFixed(0)} דק' ללא txid — ייתכן שהשידור בוצע והתשובה אבדה, ופנקס-האידמפוטנטיות של החותם (שעה) כבר לא מכסה אותו. נדרש confirmFresh:true מפורש (סיכון-שידור-כפול מוסבר) או חיפוש-ידני של requestId=${String(meta.requestId ?? "?")}`
      },
      { status: 409 }
    );
  }

  // BLURT cooldown — anti-spam over the measured fee law.
  // roast 52: counts REAL BROADCASTS (txid != null) — not status:"anchored".
  // roast 56: intent rows carry txid=null until success, so pure retries of an
  // unresolved broadcast never hit the cooldown — only broadcasts that
  // ACTUALLY burned a fee do. Deterministic requestId is the anti-spam
  // backstop for the same (seal, network): replays return the cached verdict
  // instead of a second tx.
  if (network === "BLURT") {
    const lastAnchor = await db.anchorTx.findFirst({
      where: { network, txid: { not: null } },
      orderBy: { createdAt: "desc" }
    });
    if (lastAnchor) {
      const mins = (Date.now() - lastAnchor.createdAt.getTime()) / 60_000;
      if (mins < BLURT_COOLDOWN_MIN) {
        return NextResponse.json(
          {
            ok: false,
            error: `cooldown: שידור BLURT אחרון לפני ${mins.toFixed(1)} דק' — סף-הקל ${BLURT_COOLDOWN_MIN} דק' (העמלה נשרפה גם אם האימות טרם אושר)`,
            retryAfterMin: Math.ceil(BLURT_COOLDOWN_MIN - mins)
          },
          { status: 429, headers: { "Retry-After": String(Math.ceil((BLURT_COOLDOWN_MIN - mins) * 60)) } }
        );
      }
    }
  }

  const sr = await buildSignRequest(seal, network, PULSE_KIND, requestId, 10 * 60_000);

  const exec = await externalSignerExecute({
    requestId,
    network,
    kind: "custom_json",
    payload: sr.payload,
    id: "saos.weave.v1",
    authLevel
  });

  if (!exec.ok || !exec.txid) {
    // roast 56 ambiguity discipline — the two failure classes are DIFFERENT facts:
    //   400/403/429 = the signer REFUSED (nothing signed, nothing broadcast) → the
    //                 intent row is honestly "failed" and retries replay the cached refusal;
    //   502 + failureClass "chain-rejected" = the chain ANSWERED and refused the tx
    //                 (verbatim reason) — nothing broadcast → definitive too;
    //   502 "transport"/null = AMBIGUOUS (a signed broadcast MAY be in flight) → the row
    //                 stays transit and the deterministic requestId makes the next retry a
    //                 ledger replay, not a new tx.
    const definitive =
      (exec.status !== null && exec.status !== 502) || exec.failureClass === "chain-rejected";
    await db.anchorTx.update({
      where: { id: intent.id },
      data: {
        status: definitive ? "failed" : "transit",
        gate: definitive
          ? `signer-refused: ${String(exec.error ?? "?").slice(0, 180)}`
          : `broadcast-ambiguous: ${String(exec.error ?? "?").slice(0, 180)} — ייתכן שידור בטיסה; requestId=${requestId} נשמר, נסיון-חוזר ישחזר את התשובה המקורית במקום לשדר כפול`,
        meta: JSON.stringify({ ...safeMeta(intent.meta), lastError: String(exec.error ?? "?").slice(0, 200), lastAttemptAt: new Date().toISOString(), lastAttemptStatus: exec.status })
      }
    });
    await audit({
      kind: "anchor-pulse",
      actor: auth.actorRef,
      action: "POST /anchor-pulse",
      allowed: false,
      req,
      detail: `network=${network} authLevel=${authLevel} requestId=${requestId} ${definitive ? "refused" : "ambiguous"}: ${String(exec.error ?? "?").slice(0, 180)}`
    });
    return NextResponse.json(
      { ok: false, error: exec.error ?? "signer-refused: החותם החיצוני סירב", network, ambiguity: definitive ? "definitive-refusal" : "ambiguous-broadcast", requestId },
      { status: definitive ? 502 : 202 }
    );
  }

  // independent public verification — the anchor must stand on its own
  // (Task 47: blockHint lets the verifier use get_block when account_history lags)
  const verification = await verifyTxidPublic(network, exec.txid, exec.confirmedBlock ?? null);

  // roast 52 — truth contract kept END-TO-END: "anchored" is written ONLY when
  // the public network itself confirmed the txid. roast 56: the WRITE-AHEAD
  // INTENT row is promoted in place (guarded update — only if txid is still
  // null, so a concurrent twin cannot double-promote) instead of creating a
  // second row for the same (seal, network) pulse.
  const promoted = await db.anchorTx.updateMany({
    where: { id: intent.id, txid: null },
    data: {
      txid: exec.txid,
      status: verification.verified ? "anchored" : "transit",
      gate: verification.verified ? null : "unverified-txid: שודר ונרשם, אך הרשת הציבורית טרם אישרה — ייחשב anchored רק לאחר אימות-קריאה עצמאי",
      meta: JSON.stringify({
        ...safeMeta(intent.meta),
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
  const row = promoted.count > 0
    ? await db.anchorTx.findUniqueOrThrow({ where: { id: intent.id } })
    : await db.anchorTx.findFirst({ where: { sealId: seal.id, network, kind: PULSE_KIND, txid: exec.txid } }) ?? intent;

  await audit({
    kind: "anchor-pulse",
    actor: auth.actorRef,
    action: "POST /anchor-pulse",
    allowed: true,
    req,
    detail: `network=${network} sealH=${seal.height} requestId=${requestId} txid=${exec.txid.slice(0, 16)}… verified=${verification.verified}`
  });

  return NextResponse.json({
    ok: true,
    anchor: anchorView(row, seal, verification.verified, verification.reason),
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
  await externalSignerHealth(); // roast 56-4: same fresh-verdict discipline for the honest-state view
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
