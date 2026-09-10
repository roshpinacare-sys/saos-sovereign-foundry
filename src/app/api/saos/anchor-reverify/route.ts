import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { verifyTxidPublic, parseNetwork, type SignRequest } from "@/lib/saos/signer";
import { coarseError } from "@/lib/saos/api-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/anchor-reverify — promote an honestly-unverified anchor (roast 52).
 *
 * The pulse path now lands unverified broadcasts as status:"transit" with a
 * gate note (truth contract: "anchored" ONLY after independent public
 * verification). But BLURT/STEEM public history indexing lags blocks by
 * minutes — re-broadcasting to "fix" it would burn a double fee. The missing
 * piece was a PROMOTION path: re-run verifyTxidPublic on the latest txid
 * row that is not yet anchored, and write "anchored" ONLY when the public
 * chain itself confirms it. Every other outcome is returned honestly and
 * the row stays transit — no fabrication, no time-based auto-promotion.
 */
/** roast 63: outer catch — an unexpected DB error used to escape as a raw 500
 * (the never-500 contract is "errors are data"). Every throw lands as JSON. */
export async function POST(req: Request) {
  try {
    return await reverifyPost(req);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: coarseError(e, "anchor-reverify-failed") },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}

async function reverifyPost(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "auth-required" },
      { status: auth.authConfigured ? 401 : 403 }
    );
  }

  const rl = enforceRateLimit("anchor-reverify", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: נסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: { network?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body — auto-pick the latest unverified row of any network
  }
  const wanted = body.network ? parseNetwork(body.network) : null;
  if (body.network && !wanted) {
    return NextResponse.json({ ok: false, error: `unknown network: ${String(body.network)}` }, { status: 400 });
  }

  // latest broadcast row (any network, or the requested one) that is not anchored yet
  const row = await db.anchorTx.findFirst({
    where: wanted
      ? { network: wanted, txid: { not: null }, status: { not: "anchored" } }
      : { txid: { not: null }, status: { not: "anchored" } },
    orderBy: { createdAt: "desc" }
  });

  if (!row || !row.txid) {
    return NextResponse.json({
      ok: true,
      promoted: false,
      reason: "אין שורת-עוגן לא-מאומתת עם txid — כלום לקדם (הכל anchored או שאין שידורים)"
    });
  }

  // the signer's confirmedBlock hint is the fastest legitimate path past history lag
  let blockHint: number | null = null;
  try {
    const meta = JSON.parse(row.meta ?? "{}") as { confirmedBlock?: number | null };
    blockHint = typeof meta.confirmedBlock === "number" ? meta.confirmedBlock : null;
  } catch {
    // no/invalid meta — verify without the hint
  }

  const verification = await verifyTxidPublic(row.network as SignRequest["network"], row.txid, blockHint);

  if (!verification.verified) {
    await audit({
      kind: "anchor-reverify",
      actor: auth.actorRef,
      action: "POST /anchor-reverify",
      allowed: false,
      req,
      detail: `network=${row.network} txid=${row.txid.slice(0, 16)}… still-unverified: ${verification.reason.slice(0, 140)}`
    });
    return NextResponse.json({
      ok: true,
      promoted: false,
      network: row.network,
      txid: row.txid,
      status: row.status,
      verified: false,
      reason: verification.reason
    });
  }

  const updated = await db.anchorTx.update({
    where: { id: row.id },
    data: {
      status: "anchored",
      gate: null,
      meta: JSON.stringify({
        ...safeMeta(row.meta),
        reverified: true,
        reverifiedAt: new Date().toISOString(),
        verificationSource: verification.source,
        verificationReason: verification.reason
      })
    }
  });

  await audit({
    kind: "anchor-reverify",
    actor: auth.actorRef,
    action: "POST /anchor-reverify",
    allowed: true,
    req,
    detail: `network=${row.network} txid=${row.txid.slice(0, 16)}… PROMOTED transit→anchored`
  });

  return NextResponse.json({
    ok: true,
    promoted: true,
    network: updated.network,
    txid: updated.txid,
    status: updated.status,
    verified: true,
    reason: verification.reason
  });
}

function safeMeta(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
