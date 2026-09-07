import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import {
  SIGN_TTL_MS,
  buildSignRequest,
  effectiveStatus,
  parseNetwork,
  parseSignerKind,
  plausibleTxid,
  signerRegistry,
  verifyTxidPublic,
  type SignatureLifecycle
} from "@/lib/saos/signer";

export const dynamic = "force-dynamic";

/**
 * /api/saos/signer — keyless external signing route (Task 5 + Task 6 missions 3–4).
 *
 * GET    → signer registry (honest states) + last 20 signature requests with
 *          lifecycle status + per-status counts.
 *          Open read-only: every byte here is public by construction.
 * POST   → create SignRequest {height|sealId, network, signer=manual|external|hardware}
 *          AUTH REQUIRED (sensitive: anchor-request creation). Produces payload +
 *          payloadHash + digestToSign + metadata — NEVER a key.
 *          Lifecycle: manual → awaiting-approval; other signers → pending.
 * PATCH  → one of:
 *          a) record the PUBLIC result  {id, txid, proofRef?, anchorRef?, verify?}
 *             AUTH REQUIRED → status signed-externally; with verify:true the txid
 *             is probed against the PUBLIC network (read-only): verified=true →
 *             recorded; verified=false → stays signed-externally with an honest
 *             reason, NEVER presented as a final anchor.
 *          b) cancel                    {id, action:"cancel", reason?}
 *          c) mark failed               {id, action:"fail", reason}
 *          AUTH REQUIRED + audited. Immutability: a recorded txid can never be
 *          overwritten; terminal states (recorded|failed|expired|cancelled) refuse
 *          further mutation. Cancel/fail only before any txid exists.
 *
 * There is no DELETE and no key field anywhere — expired rows are pruned only
 * by scripts/cleanup.mjs with a verified backup (docs/database.md retention).
 */

const TERMINAL: SignatureLifecycle[] = ["recorded", "failed", "expired", "cancelled"];

function statusFrom(row: { status: string; expiresAt: Date; txid: string | null }): SignatureLifecycle {
  const s = effectiveStatus(row);
  // rows created before Task 6 have no lifecycle: derive from txid/signerStatus
  if (row.status === "pending" && row.txid) return "signed-externally";
  return s;
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("signer", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const [rows, awaiting, recorded] = await Promise.all([
      db.pendingSignature.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { seal: { select: { height: true, root: true } } } }),
      db.pendingSignature.count({ where: { signerStatus: "awaiting-approval" } }),
      db.pendingSignature.count({ where: { signerStatus: "ready" } })
    ]);
    const perStatus: Record<string, number> = {};
    for (const r of rows) {
      const st = statusFrom(r);
      perStatus[st] = (perStatus[st] ?? 0) + 1;
    }
    return NextResponse.json({
      ok: true,
      registry: signerRegistry(),
      counts: { awaitingApproval: awaiting, recorded, byStatus: perStatus },
      pending: rows.map((p) => ({
        id: p.id,
        network: p.network,
        kind: p.kind,
        signer: p.signer,
        signerStatus: p.signerStatus,
        status: statusFrom(p),
        payloadHash: p.payloadHash,
        digestToSign: p.digestToSign,
        payload: JSON.parse(p.payload) as Record<string, unknown>,
        sealHeight: p.seal?.height ?? null,
        sealRoot: p.seal?.root ?? null,
        txid: p.txid,
        proofRef: p.proofRef,
        anchorRef: p.anchorRef,
        verified: p.verified,
        verificationSource: p.verificationSource,
        cancelReason: p.cancelReason,
        resultAt: p.resultAt,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt
      }))
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "signer list failed" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const rl = enforceRateLimit("signer", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const auth = requireAuth(req);
    if (!auth.ok) {
      await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "POST /signer", allowed: false, req, detail: auth.error });
      return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
    }

    let body: { height?: unknown; sealId?: unknown; network?: unknown; signer?: unknown; kind?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // no body — fail below on network validation
    }

    const network = parseNetwork(body.network);
    if (!network) {
      return NextResponse.json({ ok: false, error: "network required: STEEM|BLURT|HIVE|TRON" }, { status: 200 });
    }
    const signer = parseSignerKind(body.signer) ?? "manual";
    const kind = body.kind === "checkpoint" ? "checkpoint" : "weave";

    // resolve the seal to anchor
    let seal = null;
    if (typeof body.sealId === "string" && body.sealId.length > 0) {
      seal = await db.sealRecord.findUnique({ where: { id: body.sealId } });
    } else if (body.height !== undefined) {
      const height = Number(body.height);
      if (!Number.isSafeInteger(height)) {
        return NextResponse.json({ ok: false, error: "height must be an integer" }, { status: 200 });
      }
      seal = await db.sealRecord.findUnique({ where: { height } });
    } else {
      seal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } }); // default: latest seal
    }
    if (!seal) {
      return NextResponse.json({ ok: false, error: "seal not found — הרץ פעימה (POST /seal) או ציין height/sealId קיים" }, { status: 200 });
    }

    // duplicate-protection: an unrecorded request for the same seal+network must not pile up
    const existing = await db.pendingSignature.findFirst({
      where: { sealId: seal.id, network, txid: null, signerStatus: "awaiting-approval" }
    });
    if (existing) {
      return NextResponse.json(
        { ok: true, idempotent: true, signature: { id: existing.id, network: existing.network, signer: existing.signer, signerStatus: existing.signerStatus, status: statusFrom(existing), digestToSign: existing.digestToSign } },
        { status: 200 }
      );
    }

    const id = `sig-${randomUUID()}`;
    const request = await buildSignRequest(seal, network, kind, id, SIGN_TTL_MS);
    const lifecycle: SignatureLifecycle = signer === "manual" ? "awaiting-approval" : "pending";
    const row = await db.pendingSignature.create({
      data: {
        id,
        sealId: seal.id,
        network,
        kind,
        payload: request.payload,
        payloadHash: request.payloadHash,
        digestToSign: request.digestToSign,
        signer,
        signerStatus: signer === "manual" ? "awaiting-approval" : "disconnected",
        status: lifecycle,
        expiresAt: new Date(Date.now() + SIGN_TTL_MS)
      }
    });

    await audit({ kind: "signer-create", actor: auth.actorRef, action: "POST /signer", allowed: true, req, detail: `${network} seal#${seal.height} signer=${signer} status=${lifecycle}` });

    return NextResponse.json({
      ok: true,
      idempotent: false,
      signature: {
        id: row.id,
        network: row.network,
        kind: row.kind,
        signer: row.signer,
        signerStatus: row.signerStatus,
        status: lifecycle,
        payload: request.payload,
        payloadHash: request.payloadHash,
        digestToSign: request.digestToSign,
        metadata: request.metadata
      },
      note: "אין מפתח פרטי בתגובה, בבסיס-הנתונים או בשרת — חותמים מחוץ למערכת ומחזירים רק את התוצאה הציבורית (txid + הוכחה)"
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "signer create failed" }, { status: 200 });
  }
}

export async function PATCH(req: Request) {
  const rl = enforceRateLimit("signer", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const auth = requireAuth(req);
    if (!auth.ok) {
      await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "PATCH /signer", allowed: false, req, detail: auth.error });
      return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
    }

    let body: { id?: unknown; txid?: unknown; proofRef?: unknown; anchorRef?: unknown; verify?: unknown; action?: unknown; reason?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // handled below
    }
    const id = typeof body.id === "string" ? body.id : null;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id required" }, { status: 200 });
    }

    const row = await db.pendingSignature.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ ok: false, error: "signature request not found" }, { status: 200 });
    }

    const current = statusFrom(row);

    // ── b/c) cancel / fail — only before any public result exists ────────────
    const action = typeof body.action === "string" ? body.action.toLowerCase() : null;
    if (action === "cancel" || action === "fail") {
      if (row.txid !== null || TERMINAL.includes(current)) {
        return NextResponse.json({ ok: false, error: `${action} refused — לבקשה כבר יש תוצאה ציבורית או מצב סופי (${current}); רישום הוא בלתי-הפיך` }, { status: 200 });
      }
      const reason = typeof body.reason === "string" && body.reason.trim().length > 0 ? body.reason.trim().slice(0, 300) : action === "cancel" ? "בוטל ידנית על-ידי המפעיל" : "סומן ככשל על-ידי המפעיל";
      const updated = await db.pendingSignature.update({
        where: { id },
        data: { status: action === "cancel" ? "cancelled" : "failed", cancelReason: reason, cancelledAt: new Date() }
      });
      await audit({ kind: action === "cancel" ? "signer-cancel" : "signer-fail", actor: auth.actorRef, action: "PATCH /signer", allowed: true, req, detail: `${updated.network} status=${updated.status} reason=${reason.slice(0, 60)}` });
      return NextResponse.json({ ok: true, signature: { id: updated.id, network: updated.network, status: updated.status, cancelReason: updated.cancelReason } });
    }

    // ── a) record the public result (txid) ───────────────────────────────────
    const txid = plausibleTxid(body.txid);
    if (!txid) {
      return NextResponse.json({ ok: false, error: "txid (8..128 chars) required — רק תוצאה ציבורית; או action=cancel|fail" }, { status: 200 });
    }
    if (row.txid !== null) {
      // immutability — a recorded result is history, like the chain itself
      return NextResponse.json({ ok: false, error: "txid already recorded — רישום הוא בלתי-הפיך" }, { status: 200 });
    }
    if (TERMINAL.includes(current)) {
      return NextResponse.json({ ok: false, error: `refused — הבקשה במצב סופי (${current})` }, { status: 200 });
    }

    // public-only fields: proof + anchor reference (no key material accepted anywhere)
    const proofRef = typeof body.proofRef === "string" && body.proofRef.trim().length > 0 ? body.proofRef.trim().slice(0, 500) : null;
    const anchorRef = typeof body.anchorRef === "string" && body.anchorRef.trim().length > 0 ? body.anchorRef.trim().slice(0, 300) : null;
    const doVerify = body.verify === true;

    // first hop: signed-externally (proof received, verification pending)
    let data: Parameters<typeof db.pendingSignature.update>[0]["data"] = {
      txid,
      proofRef,
      anchorRef,
      signerStatus: "ready",
      resultAt: new Date(),
      status: "signed-externally",
      verified: null,
      verificationSource: doVerify ? null : "verification not requested — התוצאה נרשמה ללא אימות רשת"
    };

    // optional second hop: public read-only verification
    let verification: Awaited<ReturnType<typeof verifyTxidPublic>> | null = null;
    if (doVerify) {
      verification = await verifyTxidPublic(row.network as "STEEM" | "BLURT" | "HIVE" | "TRON", txid);
      if (verification.verified) {
        data = { ...data, status: "recorded", verified: true, verificationSource: verification.source, verifiedAt: new Date() };
      } else {
        // honest unverified — stays signed-externally, NEVER presented as final anchor
        data = { ...data, status: "signed-externally", verified: false, verificationSource: verification.reason };
      }
    }

    const updated = await db.pendingSignature.update({ where: { id }, data });
    await audit({ kind: "signer-result", actor: auth.actorRef, action: "PATCH /signer", allowed: true, req, detail: `${updated.network} txid=${txid.slice(0, 12)}… status=${updated.status} verified=${updated.verified === null ? "not-checked" : updated.verified}` });

    return NextResponse.json({
      ok: true,
      signature: {
        id: updated.id,
        network: updated.network,
        signerStatus: updated.signerStatus,
        status: updated.status,
        txid: updated.txid,
        proofRef: updated.proofRef,
        anchorRef: updated.anchorRef,
        verified: updated.verified,
        verificationSource: updated.verificationSource,
        resultAt: updated.resultAt
      },
      note:
        updated.status === "recorded"
          ? "התוצאה נרשמה ואומתה מול הרשת הציבורית (read-only)"
          : updated.verified === false
            ? "התוצאה נרשמה אך לא אומתה — מוצגת כ-unverified, לא כעוגן סופי"
            : "התוצאה הציבורית נרשמה (בלי אימות רשת)"
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "signer result failed" }, { status: 200 });
  }
}
