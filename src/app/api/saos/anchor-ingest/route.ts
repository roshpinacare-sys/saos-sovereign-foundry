import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { coarseError } from "@/lib/saos/api-errors";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { parseNetwork, plausibleTxid, verifyTxidPublic, type SignRequest } from "@/lib/saos/signer";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/anchor-ingest — record an EXTERNALLY broadcast anchor (task 78).
 *
 * Context: the platform cannot broadcast EVM/Solana transactions itself (the
 * external signer holds graphene keys only), but the owner explicitly
 * authorized anchoring from the sovereign fleet keys outside the platform
 * ("אתה רשאי להשתמש בסול לעיגון … גם איתריום … אבל שנדע מה אנחנו עושים").
 *
 * Truth contract kept (docs/live-proof.md): a txid enters the anchor ledger
 * ONLY after this server re-verifies it against public RPCs on its own
 * (verifyTxidPublic). Nothing is trusted from the request body except the
 * public txid itself. CAS discipline: an existing txid is never overwritten;
 * at most one anchored row per (seal, network).
 *
 * POST { network: "ETHEREUM"|"SOLANA"|..., txid, height? }  AUTH REQUIRED
 * → { ok, anchored, anchor: {network, txid, verifiedBy} } | honest refusal.
 */
export async function POST(req: Request) {
  const rl = enforceRateLimit("seal", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) {
      await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "POST /anchor-ingest", allowed: false, req, detail: auth.error });
      return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
    }

    let body: { network?: unknown; txid?: unknown; height?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: "network and txid required" }, { status: 200 });
    }

    const network = parseNetwork(body.network);
    if (!network) {
      return NextResponse.json({ ok: false, error: "network required: STEEM|BLURT|HIVE|TRON|ETHEREUM|SOLANA" }, { status: 200 });
    }
    const txid = plausibleTxid(body.txid);
    if (!txid) {
      return NextResponse.json({ ok: false, error: "txid required (8..128 chars, no controls)" }, { status: 200 });
    }

    // resolve the target seal — explicit height, else the latest
    let seal = null;
    if (body.height !== undefined) {
      const height = Number(body.height);
      if (!Number.isSafeInteger(height)) {
        return NextResponse.json({ ok: false, error: "height must be an integer" }, { status: 200 });
      }
      seal = await db.sealRecord.findUnique({ where: { height } });
    } else {
      seal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
    }
    if (!seal) {
      return NextResponse.json({ ok: false, error: "seal not found — הרץ פעימה (POST /seal) או ציין height קיים" }, { status: 200 });
    }

    // never double-anchor the same (seal, network) — immutability first
    const existingAnchored = await db.anchorTx.findFirst({
      where: { sealId: seal.id, network, txid: { not: null } },
      orderBy: { createdAt: "desc" }
    });
    if (existingAnchored?.txid) {
      return NextResponse.json({
        ok: true,
        alreadyAnchored: true,
        anchor: { network, txid: existingAnchored.txid, sealHeight: seal.height }
      });
    }

    // the ONLY truth gate: this server re-verifies the txid against public RPCs
    const verification = await verifyTxidPublic(network as SignRequest["network"], txid);
    if (!verification.verified) {
      await audit({
        kind: "anchor-ingest",
        actor: auth.actorRef,
        action: "POST /anchor-ingest",
        allowed: false,
        req,
        detail: `network=${network} txid=${txid.slice(0, 16)}… NOT verified: ${verification.reason.slice(0, 160)}`
      });
      return NextResponse.json({ ok: false, verified: false, error: "unverified", reason: verification.reason }, { status: 200 });
    }

    const meta = JSON.stringify({
      source: "external-ingest",
      kind: "checkpoint",
      verifiedBy: verification.source,
      at: new Date().toISOString()
    });

    const anchored = await db.$transaction(async (tx) => {
      // CAS-fill the newest intent row (snapshot row with txid:null) if any
      const intent = await tx.anchorTx.findFirst({
        where: { sealId: seal!.id, network, txid: null },
        orderBy: { createdAt: "desc" }
      });
      if (intent) {
        const updated = await tx.anchorTx.updateMany({
          where: { id: intent.id, txid: null },
          data: { txid, status: "anchored", gate: null, meta }
        });
        if (updated.count > 0) return { reused: true, network, txid };
      }
      // no intent row (or it raced) — create the anchored row directly
      await tx.anchorTx.create({
        data: { sealId: seal!.id, network, kind: "checkpoint", txid, status: "anchored", gate: null, meta }
      });
      return { reused: false, network, txid };
    });

    await audit({
      kind: "anchor-ingest",
      actor: auth.actorRef,
      action: "POST /anchor-ingest",
      allowed: true,
      req,
      detail: `network=${network} seal=${seal.height} txid=${txid.slice(0, 16)}… VERIFIED via ${verification.source ?? "?"} → anchored`
    });

    return NextResponse.json({
      ok: true,
      anchored: true,
      anchor: { network: anchored.network, txid: anchored.txid, sealHeight: seal.height, verifiedBy: verification.source ?? null }
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: coarseError(e, "anchor-ingest-failed") }, { status: 200 });
  }
}
