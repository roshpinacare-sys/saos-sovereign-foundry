import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { applyTx, genesisState, stateRootOf, type KernelTx } from "@/lib/saos/kernel";
import { buildMerkleTree } from "@/lib/saos/merkle";
import { canonicalDigest, canonicalize } from "@/lib/saos/canonical-json";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { appendReceiptTx, retryWrite, withWriteLock } from "@/lib/saos/receipt-store";
import { assertWritesEnabled } from "@/lib/saos/modes";

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
    const modeState = assertWritesEnabled();

    let body: { stamps?: number; memo?: string; batchId?: string } = {};
    try {
      body = await req.json();
    } catch {
      // no body — defaults
    }
    const stampCount = Math.min(24, Math.max(3, Number(body.stamps ?? 6)));
    const batchId = body.batchId !== undefined && body.batchId !== null && BATCH_ID_RE.test(String(body.batchId))
      ? String(body.batchId)
      : randomUUID();

    // 1. kernel batch — batchId seeds every nonce (idempotency + collision-proof roots)
    const txs: KernelTx[] = [];
    for (let i = 0; i < stampCount; i++) {
      txs.push({ op: "stamp", issuer: "foundry-console", nonce: `pulse-${batchId}-${i}` });
    }
    txs.push({ op: "harvest", issuer: "grid-98", nonce: `harvest-${batchId}`, amount: 42 });
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

    // honest anchor statuses — advisory mode, never fabricated
    const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
    const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
    const matrix = anchoringMatrix(rcPct, tronEnergy);
    const advisory = "advisory-mode: אין מפתחות חתימה בסנדבוקס — הפעימה מתועדת ומוכנה לשידור כשהכספת חוזרת";
    const anchorRowsFor = (sealId: string) =>
      matrix.map((m) => ({
        sealId,
        network: m.network,
        kind: "weave",
        txid: null,
        status:
          m.network === "STEEM" || m.network === "BLURT"
            ? "pending"
            : m.network === "HIVE"
              ? "gated"
              : "transit",
        gate:
          m.network === "HIVE" && m.gate
            ? `${m.gate} · ${advisory}`
            : m.network === "TRON" && tronEnergy === 0
              ? `energy-0 · ${advisory}`
              : advisory,
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
      { ok: false, error: e instanceof Error ? e.message : "seal failed" },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}
