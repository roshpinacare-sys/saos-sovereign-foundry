import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "@/lib/saos/merkle";
import { coarseError } from "@/lib/saos/api-errors";
import { verifyChainDag } from "@/lib/saos/evidence";
import { appendReceipt } from "@/lib/saos/receipt-store";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/verify-chain — the independent verification surface.
 *
 * Scopes (query `scope`):
 *   chain (default) — verify the receipt hash-chain + rebuild & verify
 *                     every stored seal's merkle tree (all leaves proven).
 *                     Scan caps (MAX_SEALS/MAX_RECEIPTS) are disclosed:
 *                     `receiptChain.total/capped` + `sealsTotal` state whether
 *                     anything was skipped — checked counts never masquerade
 *                     as the whole chain (roast 50).
 *   seal            — verify one seal by `height` or `root` (all its leaves).
 *   leaf            — verify a single leaf inclusion proof (`height|root` + `index`).
 *
 * Output contract: ok, scope, root, height, leafCount, verifiedLeaves,
 * invalidLeaves, proofResult, errors — fail-closed, never 500.
 * A verify run is itself receipted (kind=verify-chain) — note: the run
 * verifies the chain as it existed BEFORE its own receipt was appended.
 */

const MAX_SEALS = 25;
const MAX_RECEIPTS = 1000;

interface SealCheck {
  height: number;
  root: string;
  leafCount: number;
  authoredLeafCount: number;
  leafCountMatches: boolean;
  duplicateLeafDigests: number;
  rootMatches: boolean;
  verifiedLeaves: number;
  invalidLeaves: number;
  proofResult: "all-verified" | "partial" | "failed";
}

async function checkSeal(sealId: string): Promise<SealCheck & { stateRoot: string; proofs: { index: number; verified: boolean }[] }> {
  const seal = await db.sealRecord.findFirstOrThrow({
    where: { id: sealId },
    include: { leaves: true }
  });
  const leaves = [...seal.leaves].sort((a, b) => a.index - b.index).map((l) => l.digest);
  // roast 50 — phantom-leaf hardening (CVE-2012-2459 family): the tree
  // duplicates the last node of an odd level, so leaves [a,b,c] and [a,b,c,c]
  // build the SAME root — a tamperer could add a phantom duplicate leaf to the
  // DB and every proof would still verify. Two stored counters close the hole
  // without touching the anchored hashing scheme: the seal's OWN authored
  // leavesCount, and duplicate-digest detection within the batch.
  const leafCountMatches = leaves.length === seal.leavesCount;
  const duplicateLeafDigests = leaves.length - new Set(leaves).size;
  const tree = await buildMerkleTree(leaves);
  const proofs: { index: number; verified: boolean }[] = [];
  for (let i = 0; i < tree.leaves.length; i++) {
    const p = await merkleProof(tree, i);
    proofs.push({ index: i, verified: await verifyMerkleProof(p) });
  }
  const verifiedLeaves = proofs.filter((p) => p.verified).length;
  const invalidLeaves = proofs.length - verifiedLeaves;
  const rootMatches = tree.root === seal.root;
  const proofResult: SealCheck["proofResult"] =
    rootMatches && invalidLeaves === 0 ? "all-verified" : verifiedLeaves > 0 ? "partial" : "failed";
  return {
    height: seal.height,
    root: seal.root,
    stateRoot: seal.stateRoot,
    leafCount: leaves.length,
    authoredLeafCount: seal.leavesCount,
    leafCountMatches,
    duplicateLeafDigests,
    rootMatches,
    verifiedLeaves,
    invalidLeaves,
    proofResult,
    proofs
  };
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("verify-chain", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") ?? "chain").toLowerCase();
    const heightParam = url.searchParams.get("height");
    const rootParam = url.searchParams.get("root");
    const indexParam = url.searchParams.get("index");

    // ── scope: chain ────────────────────────────────────────────────────────
    if (scope === "chain") {
      const errors: string[] = [];
      // roast 50 — caps honesty: totals counted and reported next to checked
      // counts, so an oversized chain can never verify "green" while older
      // records silently skip the scan (the doc claimed "the ENTIRE chain").
      const [receiptsTotal, sealsTotal] = await Promise.all([db.evidenceReceipt.count(), db.sealRecord.count()]);
      const receipts = await db.evidenceReceipt.findMany({ orderBy: { createdAt: "asc" }, take: MAX_RECEIPTS });
      const chain = await verifyChainDag(
        receipts.map((r) => ({
          kind: r.kind,
          at: (r.at ?? r.createdAt).toISOString(), // legacy fallback: row time (see backfill script)
          payload: JSON.parse(r.payload),
          prevDigest: r.prevDigest,
          digest: r.digest
        }))
      );
      if (chain.digestErrors.length > 0) errors.push(`receipt digests broken at indices ${chain.digestErrors.join(",")}`);
      if (chain.linkErrors.length > 0) errors.push(`receipt linkage broken at indices ${chain.linkErrors.join(",")}`);

      const seals = await db.sealRecord.findMany({ orderBy: { height: "desc" }, take: MAX_SEALS, select: { id: true } });
      const sealChecks: SealCheck[] = [];
      for (const s of seals) {
        const c = await checkSeal(s.id);
        sealChecks.push(c);
        if (!c.rootMatches) errors.push(`seal height=${c.height}: rebuilt root mismatch`);
        if (c.invalidLeaves > 0) errors.push(`seal height=${c.height}: ${c.invalidLeaves} invalid leaf proofs`);
        if (!c.leafCountMatches)
          errors.push(`seal height=${c.height}: PHANTOM-LEAF tamper — stored leaves ${c.leafCount} ≠ authored leavesCount ${c.authoredLeafCount}`);
        if (c.duplicateLeafDigests > 0)
          errors.push(`seal height=${c.height}: ${c.duplicateLeafDigests} duplicate leaf digest(s) — duplicate-leaf ambiguity`);
      }
      sealChecks.sort((a, b) => a.height - b.height);

      const ok = chain.ok && errors.length === 0 && sealChecks.length > 0;
      const appended = await appendReceipt("verify-chain", {
        scope: "chain",
        ok,
        receiptsChecked: receipts.length,
        sealsChecked: sealChecks.length
      });
      const totals = {
        sealsChecked: sealChecks.length,
        leafCount: sealChecks.reduce((s, c) => s + c.leafCount, 0),
        verifiedLeaves: sealChecks.reduce((s, c) => s + c.verifiedLeaves, 0),
        invalidLeaves: sealChecks.reduce((s, c) => s + c.invalidLeaves, 0)
      };
      return NextResponse.json({
        ok,
        scope: "chain",
        mode: "read-only-verification",
        receiptChain: {
          ok: chain.ok,
          checked: receipts.length,
          total: receiptsTotal,
          capped: receiptsTotal > receipts.length,
          digestErrors: chain.digestErrors,
          linkErrors: chain.linkErrors,
          // concurrent legacy branches — reported, never rewritten (fixed forward by transactional appends)
          forks: chain.forks
        },
        seals: sealChecks.map((c) => ({
          height: c.height,
          root: c.root,
          leafCount: c.leafCount,
          authoredLeafCount: c.authoredLeafCount,
          leafCountMatches: c.leafCountMatches,
          duplicateLeafDigests: c.duplicateLeafDigests,
          rootMatches: c.rootMatches,
          verifiedLeaves: c.verifiedLeaves,
          invalidLeaves: c.invalidLeaves,
          proofResult: c.proofResult
        })),
        sealsTotal,
        totals,
        proofResult: sealChecks.length > 0 && sealChecks.every((c) => c.proofResult === "all-verified") ? "all-verified" : sealChecks.length === 0 ? "empty" : "partial",
        root: sealChecks.at(-1)?.root ?? null,
        height: sealChecks.at(-1)?.height ?? null,
        leafCount: totals.leafCount,
        verifiedLeaves: totals.verifiedLeaves,
        invalidLeaves: totals.invalidLeaves,
        errors,
        receipt: appended.receipt.digest,
        persisted: appended.persisted
      });
    }

    // ── scope: seal ─────────────────────────────────────────────────────────
    if (scope === "seal") {
      if (heightParam === null && rootParam === null) {
        return NextResponse.json({ ok: false, scope, error: "missing selector: provide height or root" }, { status: 200 });
      }
      if (rootParam !== null && !/^[0-9a-f]{64}$/i.test(rootParam)) {
        return NextResponse.json({ ok: false, scope, error: "invalid root format — expected 64 hex chars" }, { status: 200 });
      }
      if (heightParam !== null && (!/^\d+$/.test(heightParam) || Number(heightParam) > 2 ** 31 - 1)) {
        return NextResponse.json({ ok: false, scope, error: "invalid height format — expected positive integer" }, { status: 200 });
      }
      const seal = await db.sealRecord.findFirst({
        where: rootParam !== null ? { root: rootParam.toLowerCase() } : { height: Number(heightParam) },
        select: { id: true }
      });
      if (!seal) {
        return NextResponse.json({ ok: false, scope, error: "seal not found for the given selector" }, { status: 200 });
      }
      const c = await checkSeal(seal.id);
      const ok = c.rootMatches && c.invalidLeaves === 0;
      const appended = await appendReceipt("verify-chain", { scope: "seal", height: c.height, ok, leaves: c.leafCount });
      const leaves = await db.sealLeaf.findMany({ where: { sealId: seal.id }, orderBy: { index: "asc" } });
      const tree = await buildMerkleTree(leaves.map((l) => l.digest));
      return NextResponse.json({
        ok,
        scope: "seal",
        height: c.height,
        root: c.root,
        stateRoot: c.stateRoot,
        leafCount: c.leafCount,
        rootMatches: c.rootMatches,
        verifiedLeaves: c.verifiedLeaves,
        invalidLeaves: c.invalidLeaves,
        proofResult: c.proofResult,
        proofs: c.proofs,
        sampleProof: leaves.length > 0 ? await merkleProof(tree, 0) : null,
        errors: ok ? [] : c.rootMatches ? ["invalid leaf proof(s)"] : ["rebuilt root mismatch"],
        receipt: appended.receipt.digest,
        persisted: appended.persisted
      });
    }

    // ── scope: leaf ─────────────────────────────────────────────────────────
    if (scope === "leaf") {
      if (heightParam === null && rootParam === null) {
        return NextResponse.json({ ok: false, scope, error: "missing selector: provide height or root" }, { status: 200 });
      }
      if (indexParam === null || !/^\d+$/.test(indexParam)) {
        return NextResponse.json({ ok: false, scope, error: "missing/invalid index — expected non-negative integer" }, { status: 200 });
      }
      // roast 57: the seal scope validates heightParam (regex) but the leaf
      // scope did NOT — "height=undefined&index=0" handed Prisma a NaN and the
      // raw internal error text leaked into the response (LIVE-CAUGHT in dev.log).
      if (heightParam !== null && (!/^\d+$/.test(heightParam) || Number(heightParam) > 2 ** 31 - 1)) {
        return NextResponse.json({ ok: false, scope, error: "invalid height format — expected positive integer" }, { status: 200 });
      }
      const idx = Number(indexParam);
      const seal = await db.sealRecord.findFirst({
        where: rootParam !== null ? { root: rootParam.toLowerCase() } : { height: Number(heightParam) },
        include: { leaves: true }
      });
      if (!seal) {
        return NextResponse.json({ ok: false, scope, error: "seal not found for the given selector" }, { status: 200 });
      }
      const leaves = [...seal.leaves].sort((a, b) => a.index - b.index).map((l) => l.digest);
      if (idx >= leaves.length) {
        return NextResponse.json({ ok: false, scope, error: `index out of batch — leafCount=${leaves.length}` }, { status: 200 });
      }
      const tree = await buildMerkleTree(leaves);
      const p = await merkleProof(tree, idx);
      const verified = await verifyMerkleProof(p);
      const appended = await appendReceipt("verify-chain", { scope: "leaf", height: seal.height, index: idx, ok: verified });
      return NextResponse.json({
        ok: verified,
        verified, // explicit per-leaf boolean — same value as ok for this scope
        scope: "leaf",
        height: seal.height,
        root: seal.root,
        leafCount: leaves.length,
        index: idx,
        proof: p,
        proofResult: verified ? "all-verified" : "failed",
        verifiedLeaves: verified ? 1 : 0,
        invalidLeaves: verified ? 0 : 1,
        errors: verified ? [] : [`leaf ${idx} proof failed against root`],
        receipt: appended.receipt.digest,
        persisted: appended.persisted
      });
    }

    return NextResponse.json(
      { ok: false, scope, error: `unknown scope "${scope}" — expected chain | seal | leaf` },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: coarseError(e, "verify-chain-failed") },
      { status: 200 } // never 500
    );
  }
}
