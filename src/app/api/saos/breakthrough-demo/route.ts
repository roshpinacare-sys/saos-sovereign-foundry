import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { runLiveNetworkProbes, type LiveProbeResult } from "@/lib/saos/networks/live-probes";
import {
  buildAtomicClock,
  COMPARISON_NOTE,
  COMPARISON_ROWS,
  SECURITY_STATEMENT,
  verificationGuide
} from "@/lib/saos/breakthrough";
import { appendReceipt } from "@/lib/saos/receipt-store";
import { saosMode } from "@/lib/saos/modes";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/breakthrough-demo — הדגמת פריצת הדרך (Task 14).
 *
 * Runs the Cross-Chain Atomic State Proof LIVE on every call:
 *   1. read-only probes of all 6 networks (keyless, cached 60s, 2.5s timeout)
 *   2. successful heads become canonical witnesses → sha256 leaves
 *   3. one 32-byte Merkle root binds the simultaneous state of the chains
 *   4. inclusion proofs generated AND independently re-verified in-process
 *   5. the run is chained into the evidence receipt chain (checkpoint clock)
 *
 * Measured & returned: latency per phase, proof size (bytes), verification
 * time, hash ops, cost ($0.00), witness diversity — plus the industry
 * comparison table (ours measured; references clearly marked as references).
 *
 * Iron rules: READ ONLY (no tx/broadcast/signing/wallet), NO SECRETS
 * (public chain data + digests only, hostnames only), NEVER 500 — every
 * failure degrades its own field into honest data.
 */
export async function GET(req: Request) {
  const rl = enforceRateLimit("breakthrough-demo", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const errors: string[] = [];
  const timestamp = new Date().toISOString();
  const mode = saosMode();

  // 1) live read-only probes (60s cache — public endpoints never hammered)
  let probes: LiveProbeResult[] = [];
  let probesCached = false;
  try {
    const probed = await runLiveNetworkProbes();
    probes = probed.results;
    probesCached = probed.cached;
  } catch (e) {
    errors.push(`probes: ${e instanceof Error ? e.message : "probe run failed"}`);
  }

  // 2–4) build + verify the atomic clock (all phases measured inside)
  let clock: Awaited<ReturnType<typeof buildAtomicClock>> | null = null;
  try {
    clock = await buildAtomicClock(probes, timestamp);
  } catch (e) {
    errors.push(`clock: ${e instanceof Error ? e.message : "atomic clock failed"}`);
  }

  if (!clock || !clock.root) {
    // honest failure — structure preserved, nothing invented
    return NextResponse.json({
      ok: true,
      timestamp,
      demo: {
        kind: "cross-chain-atomic-state-proof",
        available: false,
        statement: "לא ניתן כרגע להרכיב שעון אטומי — אין עדים זמינים (לא הומצאו נתונים)",
        networks: probes.map((p) => ({ network: p.network, witnessed: false, headBlock: null, chainIdHex: null, headTime: null, sourceHost: p.sourceHost, readAt: null, reason: p.reason })),
        witnesses: { total: 6, ok: 0, failed: 6, families: 0, note: SECURITY_STATEMENT.note },
        root: null,
        probesCached,
        comparison: { note: COMPARISON_NOTE, rows: COMPARISON_ROWS },
        security: SECURITY_STATEMENT,
        verificationGuide: verificationGuide(),
        safety: safetyBlock(mode),
        errors,
        note: "הדגמת פריצת-דרך (Task 14): קריאה בלבד — אין עסקה, אין שידור, אין חתימה, אין סודות בפלט",
        generatedBy: "GET /api/saos/breakthrough-demo"
      }
    });
  }

  // 5) checkpoint — chain this run into the evidence receipt chain
  //    (append-only clock; productionAuthority NONE enforced by the store)
  let checkpoint: { digest: string | null; prevDigest: string | null; persisted: boolean; kind: string } = {
    digest: null,
    prevDigest: null,
    persisted: false,
    kind: "breakthrough-demo"
  };
  try {
    const receipt = await appendReceipt("breakthrough-demo", {
      root: clock.root,
      witnesses: clock.witnesses.map((w) => ({ network: w.network, headBlock: w.headBlock, readAt: w.readAt })),
      excludedNetworks: clock.excluded.map((x) => x.network),
      totalComputeMs: Math.round(clock.timings.totalComputeMs), // integers only — canonicalizer is fail-closed on floats
      proofSizeBytesJson: clock.metrics.proofSizeBytesJson,
      demoKind: "cross-chain-atomic-state-proof"
    });
    checkpoint = { digest: receipt.receipt.digest, prevDigest: receipt.receipt.prevDigest, persisted: receipt.persisted, kind: "breakthrough-demo" };
  } catch (e) {
    errors.push(`checkpoint: ${e instanceof Error ? e.message : "receipt append failed"}`);
  }

  const families = new Set(
    clock.witnesses.map((w) =>
      w.network === "STEEM" || w.network === "HIVE" || w.network === "BLURT"
        ? "Graphene DPoS"
        : w.network === "TRON"
          ? "TVM DPoS"
          : w.network === "ETHEREUM"
            ? "EVM PoS"
            : "SVM PoS"
    )
  ).size;

  return NextResponse.json({
    ok: true,
    timestamp,
    demo: {
      kind: "cross-chain-atomic-state-proof",
      available: clock.ok,
      statement: `ברגע ${timestamp}: מצב הראש של ${clock.witnesses.length} רשתות חיות נקשר לשורש אחד ${clock.root.slice(0, 16)}… (32 בייט, SHA-256)`,
      networks: [
        ...clock.witnesses.map((w) => ({ network: w.network, witnessed: true, headBlock: w.headBlock, chainIdHex: w.chainIdHex, headTime: w.headTime, sourceHost: w.sourceHost, readAt: w.readAt })),
        ...clock.excluded.map((x) => ({ network: x.network, witnessed: false, headBlock: null, chainIdHex: null, headTime: null, sourceHost: null, readAt: null, reason: x.reason }))
      ],
      witnesses: {
        total: 6,
        ok: clock.witnesses.length,
        failed: 6 - clock.witnesses.length,
        families,
        excluded: clock.excluded,
        note: "עד = ראש ציבורי שנקרא חי; כישלון קריאה נופה בכנות ואינו נכלל בשורש"
      },
      root: clock.root,
      leaves: clock.leaves,
      treeHeight: clock.treeHeight,
      proof: clock.proof,
      verification: {
        proofsGenerated: clock.proofsGenerated,
        proofsVerifiedOk: clock.proofsVerifiedOk,
        allVerified: clock.proofsGenerated > 0 && clock.proofsVerifiedOk === clock.proofsGenerated,
        verifyTimeMs: clock.timings.verifyPhaseMs,
        method: "שחזור עצמאי: הליכת sha256 מהעלה לשורש"
      },
      checkpoint,
      timings: clock.timings,
      metrics: { ...clock.metrics, costUsd: "0.00", keyless: true, gasUsed: 0, transactionsSent: 0 },
      security: {
        ...SECURITY_STATEMENT,
        independentConsensusSets: families,
        witnessCount: clock.witnesses.length
      },
      verificationGuide: verificationGuide(),
      probesCached
    },
    comparison: { note: COMPARISON_NOTE, rows: COMPARISON_ROWS },
    safety: safetyBlock(mode),
    errors,
    note: "הדגמת פריצת-דרך (Task 14): קריאה בלבד — אין עסקה, אין שידור, אין חתימה, אין סודות בפלט",
    generatedBy: "GET /api/saos/breakthrough-demo"
  });
}

function safetyBlock(mode: ReturnType<typeof saosMode>) {
  return {
    broadcast: false,
    transaction: false,
    signing: false,
    wallet: false,
    liveCalls: "read-only" as const,
    broadcastCapable: mode.broadcastCapable,
    note: "ההדגמה קוראת ראשים ציבוריים בלבד — אין שידור, אין חתימה, אין ארנק, אין סודות; העלות הכספית אפסית מבנית"
  };
}
