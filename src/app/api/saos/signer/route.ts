import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import {
  SIGN_TTL_MS,
  buildSignRequest,
  parseNetwork,
  parseSignerKind,
  plausibleTxid,
  signerRegistry
} from "@/lib/saos/signer";

export const dynamic = "force-dynamic";

/**
 * /api/saos/signer — keyless signing queue (Task 5, mission 4).
 *
 * GET    → signer registry (honest states) + last 20 pending signatures + counts.
 *          Open read-only: every byte here is public by construction.
 * POST   → create SignRequest {height|sealId, network, signer=manual|external|hardware}
 *          AUTH REQUIRED (sensitive: anchor-request creation). Produces payload +
 *          payloadHash + digestToSign + metadata — NEVER a key.
 * PATCH  → record the PUBLIC result {id, txid} after out-of-band signing.
 *          AUTH REQUIRED. Immutability: a recorded txid can never be overwritten.
 *
 * There is no DELETE and no key field anywhere — expired rows are pruned only
 * by scripts/cleanup.mjs with a verified backup (docs/database.md retention).
 */

export async function GET(req: Request) {
  const rl = enforceRateLimit("signer", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const [pending, awaiting, recorded] = await Promise.all([
      db.pendingSignature.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { seal: { select: { height: true, root: true } } } }),
      db.pendingSignature.count({ where: { signerStatus: "awaiting-approval" } }),
      db.pendingSignature.count({ where: { signerStatus: "ready" } })
    ]);
    return NextResponse.json({
      ok: true,
      registry: signerRegistry(),
      counts: { awaitingApproval: awaiting, recorded: recorded },
      pending: pending.map((p) => ({
        id: p.id,
        network: p.network,
        kind: p.kind,
        signer: p.signer,
        signerStatus: p.signerStatus,
        payloadHash: p.payloadHash,
        digestToSign: p.digestToSign,
        payload: JSON.parse(p.payload) as Record<string, unknown>,
        sealHeight: p.seal?.height ?? null,
        sealRoot: p.seal?.root ?? null,
        txid: p.txid,
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
        { ok: true, idempotent: true, signature: { id: existing.id, network: existing.network, signer: existing.signer, signerStatus: existing.signerStatus, digestToSign: existing.digestToSign } },
        { status: 200 }
      );
    }

    const id = `sig-${randomUUID()}`;
    const request = await buildSignRequest(seal, network, kind, id, SIGN_TTL_MS);
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
        expiresAt: new Date(Date.now() + SIGN_TTL_MS)
      }
    });

    await audit({ kind: "signer-create", actor: auth.actorRef, action: "POST /signer", allowed: true, req, detail: `${network} seal#${seal.height} signer=${signer}` });

    return NextResponse.json({
      ok: true,
      idempotent: false,
      signature: {
        id: row.id,
        network: row.network,
        kind: row.kind,
        signer: row.signer,
        signerStatus: row.signerStatus,
        payload: request.payload,
        payloadHash: request.payloadHash,
        digestToSign: request.digestToSign,
        metadata: request.metadata
      },
      note: "אין מפתח פרטי בתגובה, בבסיס-הנתונים או בשרת — חותמים מחוץ למערכת ומחזירים רק את ה-txid הציבורי"
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

    let body: { id?: unknown; txid?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // handled below
    }
    const id = typeof body.id === "string" ? body.id : null;
    const txid = plausibleTxid(body.txid);
    if (!id || !txid) {
      return NextResponse.json({ ok: false, error: "id + txid (8..128 chars) required — רק תוצאה ציבורית" }, { status: 200 });
    }

    const row = await db.pendingSignature.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ ok: false, error: "signature request not found" }, { status: 200 });
    }
    if (row.txid !== null) {
      // immutability — a recorded result is history, like the chain itself
      return NextResponse.json({ ok: false, error: "txid already recorded — רישום הוא בלתי-הפיך" }, { status: 200 });
    }

    const updated = await db.pendingSignature.update({
      where: { id },
      data: { txid, signerStatus: "ready", resultAt: new Date() }
    });
    await audit({ kind: "signer-result", actor: auth.actorRef, action: "PATCH /signer", allowed: true, req, detail: `${updated.network} txid=${txid.slice(0, 12)}…` });

    return NextResponse.json({
      ok: true,
      signature: { id: updated.id, network: updated.network, signerStatus: updated.signerStatus, txid: updated.txid, resultAt: updated.resultAt }
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "signer result failed" }, { status: 200 });
  }
}
