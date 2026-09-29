import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { applyTx, genesisState, stateRootOf, type KernelTx } from "@/lib/saos/kernel";
import { coarseError } from "@/lib/saos/api-errors";
import { buildMerkleTree } from "@/lib/saos/merkle";
import { canonicalDigest, canonicalize } from "@/lib/saos/canonical-json";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { appendReceiptTx, retryWrite, withWriteLock } from "@/lib/saos/receipt-store";
import { assertWritesEnabled } from "@/lib/saos/modes";
import { audit, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/seal — run an anchoring pulse (פעימת-עגינה). Atomic by design:
 *   1. mode gate — writes refused in safe/maintenance (fail-closed, never 500)
 *   2. idempotency: batchId (client-suppliable, default randomUUID) seeds every
 *      nonce → same batchId + stamps ⇒ same root. Re-submit returns the existing
 *      seal (idempotent:true) instead of duplicating or colliding.
 *   3. pure computation OUTSIDE the transaction (kernel replay, stateRoot, merkle)
 *   4. ONE serialized transaction: read max(height) → create SealRecord + leaves
 *      + AnchorTx + receipt(prevDigest) + OpLog. Concurrent transactions serialize
 *      on SQLite's single-writer lock — no fork, no interleaving.
 *   5. unique(height|root) as the backstop + retryOnUnique (exponential backoff)
 *      re-reads the fresh max height — monotone, no gaps, no duplicates.
 */

const SEAL_RETRY = { attempts: 6, baseDelayMs: 40 };
const BATCH_ID_RE = /^[\w.-]{1,64}$/;

export async function POST(req: Request) {
  try {
    // rate limit (30/min default) — 429 for abusers, audited below
    const rl = enforceRateLimit("seal", req);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "rate-limited: פעימות רבות מדי — המתן", retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const modeState = assertWritesEnabled();

    // auth gate: in live mode a seal becomes broadcast-adjacent — it requires
    // an authenticated operator. In dry-run/safe it stays an open simulation.
    if (modeState.liveArmed) {
      const auth = await requireAuth(req);
      if (!auth.ok) {
        await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "POST /seal (live)", allowed: false, req, detail: auth.error });
        return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
      }
    }

    let body: { stamps?: number; memo?: string; batchId?: string } = {};
    try {
      body = await req.json();
    } catch {
      // no body — defaults
    }
    // roast 56: a non-numeric stamps ("6abc" → NaN) silently degraded to ZERO
    // stamps (Math.max(3, NaN) === NaN, the loop never ran) — a "9 stamps" seal
    // became a 3-leaf seal without a word.
    // roast 60: the "fix" still DEGRADED ("abc"/0/-5/2.5 → silently 6 or 3),
    // contradicting both the comment and the economy-57 discipline. Garbage is
    // now REFUSED with the offending param name before anything is computed.
    const rawStamps = body.stamps;
    let stampCount: number;
    if (rawStamps === undefined || rawStamps === null) {
      stampCount = 6;
    } else {
      const parsed = Number(rawStamps);
      if (!Number.isSafeInteger(parsed) || parsed < 3 || parsed > 24) {
        return NextResponse.json(
          { ok: false, error: `invalid-stamps (nothing sealed): stamps must be an integer within 3..24` },
          { status: 400 }
        );
      }
      stampCount = parsed;
    }
    const batchId = body.batchId !== undefined && body.batchId !== null && BATCH_ID_RE.test(String(body.batchId))
      ? String(body.batchId)
      : randomUUID();

    // 1. kernel batch — batchId seeds every nonce (idempotency + collision-proof roots)
    const txs: KernelTx[] = [];
    for (let i = 0; i < stampCount; i++) {
      txs.push({ op: "stamp", issuer: "foundry-console", nonce: `pulse-${batchId}-${i}` });
    }
    txs.push({ op: "harvest", issuer: "treasury", nonce: `harvest-${batchId}`, amount: 42 }); // FIX(canonical-merge 2026-09-29): kernel F5a gates harvest to issuer==="treasury" — "grid-98" broke every dry-run seal since the canonical kernel merge
    txs.push({ op: "relay", issuer: "foundry-console", nonce: `door-${batchId}`, to: "steem:headcorner" });
    txs.push({ op: "seal", issuer: "foundry-console", nonce: `seal-${batchId}` });

    // 2-3. pure computation (no DB) — deterministic per batchId
    let state = genesisState();
    for (const tx of txs) state = applyTx(state, tx); // apply in order
    const stateRoot = await stateRootOf(state);
    const leafPayloads = await Promise.all(
      txs.map(async (tx) => ({ tx, digest: await canonicalDigest(tx) }))
    );
    const tree = await buildMerkleTree(leafPayloads.map((l) => l.digest));
    const root = tree.root;

    // honest anchor statuses — never fabricated (roast 50):
    // the matrix is a capability snapshot; new rows are pending/gated/transit
    // with a txid of null. "anchored" is reserved for rows carrying a live
    // verified txid (anchor-pulse → PATCH signer → verifyTxidPublic).
    const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
    const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
    // Task 87: fleet-effective HIVE gate — operator sets HIVE_FLEET_READY=1 +
    // HIVE_FLEET_ACCOUNT/HIVE_FLEET_RC_PCT only after a measured fleet-RC check
    // (rc-effective discipline). Absent env → fail-closed old behavior.
    const hiveFleet =
      process.env.HIVE_FLEET_READY === "1" && Number(process.env.HIVE_FLEET_RC_PCT ?? 0) > 0
        ? { account: process.env.HIVE_FLEET_ACCOUNT ?? "fleet-rotation", rcPct: Number(process.env.HIVE_FLEET_RC_PCT) }
        : null;
    const matrix = anchoringMatrix(rcPct, tronEnergy, undefined, hiveFleet);
    const advisory = modeState.liveArmed
      ? "פעימת-עדות (סימולציה): שורה זו אינה שידור — העיגון האמיתי נרשם כשורת AnchorTx נפרדת עם txid מאומת מול הרשת החיה"
      : "advisory-mode: הפעימה מתועדת ומוכנה לשידור כשנתיב-החתימה יחובר";
    const anchorRowsFor = (sealId: string) =>
      matrix.map((m) => ({
        sealId,
        network: m.network,
        kind: "weave",
        txid: null,
        // matrix-driven: the gate matrix already computes the honest per-network
        // status (incl. ETHEREUM/SOLANA not-configured → gated, Task 12)
        status: m.status,
        gate: m.gate ? `${m.gate} · ${advisory}` : advisory,
        meta: JSON.stringify({ advisory, rcPct, tronEnergy })
      }));

    // 4-5. atomic persist + idempotent return + conflict retry.
    // Order: retryWrite (outer) → withWriteLock (serializes writers) → $transaction (atomicity).
    const created = await retryWrite(
      () =>
        withWriteLock(() =>
          db.$transaction(async (tx) => {
          // idempotency: same logical batch (same root) → return the existing seal
          const existing = await tx.sealRecord.findUnique({ where: { root }, include: { anchors: true } });
          if (existing) return { idempotent: true as const, seal: existing, anchors: existing.anchors, receipt: null };

          const lastSeal = await tx.sealRecord.findFirst({ orderBy: { height: "desc" } });
          const seal = await tx.sealRecord.create({
            data: {
              height: (lastSeal?.height ?? 0) + 1,
              root,
              leavesCount: leafPayloads.length,
              stateRoot,
              gasUsed: state.gasUsed,
              note: body.memo ?? "פעימת עגינה מהמגדל",
              leaves: {
                create: leafPayloads.map((l, i) => ({
                  index: i,
                  kind: l.tx.op,
                  payload: canonicalize(l.tx),
                  digest: l.digest
                }))
              }
            }
          });
          const anchorRows = anchorRowsFor(seal.id);
          await tx.anchorTx.createMany({ data: anchorRows });
          const appended = await appendReceiptTx(
            tx,
            "seal",
            { sealId: seal.id, height: seal.height, root, leaves: leafPayloads.length, stateRoot },
            seal.id
          );
          await tx.opLog.create({
            data: { op: "seal", detail: `height=${seal.height} root=${root.slice(0, 16)}… mode=${modeState.mode}` }
          });
          return { idempotent: false as const, seal, anchors: anchorRows, receipt: appended.receipt };
          }, { timeout: 20_000, maxWait: 10_000 })
        ),
        SEAL_RETRY
      );

    return NextResponse.json({
      ok: true,
      idempotent: created.idempotent,
      batchId,
      mode: modeState.mode,
      seal: {
        id: created.seal.id,
        height: created.seal.height,
        root: created.seal.root,
        stateRoot: created.seal.stateRoot,
        leaves: created.seal.leavesCount,
        gasUsed: created.seal.gasUsed
      },
      anchors: created.anchors.map((a) => ({ network: a.network, status: a.status, gate: a.gate })),
      receipt: created.receipt?.digest ?? null
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: coarseError(e, "seal-failed") },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}
