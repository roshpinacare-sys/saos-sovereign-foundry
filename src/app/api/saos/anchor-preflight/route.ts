import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { coarseError } from "@/lib/saos/api-errors";
import { parseNetwork, type SignRequest } from "@/lib/saos/signer";
import { computePreflight } from "@/lib/saos/preflight";

export const dynamic = "force-dynamic";

/**
 * /api/saos/anchor-preflight — pre-anchor flight check (Task 6; core
 * computation extracted to src/lib/saos/preflight.ts in Task 13 so the
 * live-proof endpoint can reuse the exact same checks — one source of truth).
 *
 * Read-only, rate-limited, never performs an anchor, never mutates state.
 * Response shape unchanged since Task 12 (api-check §14 guards it).
 */
export async function GET(req: Request) {
  const rl = enforceRateLimit("anchor-preflight", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const url = new URL(req.url);
    const targetRaw = url.searchParams.get("network");
    let target: SignRequest["network"] | null = null;
    if (targetRaw !== null) {
      target = parseNetwork(targetRaw);
      if (!target) {
        // fail-closed: an explicit but unknown target must not silently mean "all"
        return NextResponse.json({ ok: false, error: "network must be one of STEEM|BLURT|HIVE|TRON|ETHEREUM|SOLANA" }, { status: 200 });
      }
    }

    const pf = await computePreflight(target);
    const mode = pf.mode;

    return NextResponse.json({
      ok: true,
      readyForAnchor: pf.readyForAnchor,
      mode: mode.mode,
      liveGateReady: pf.readyForAnchor,
      backupFresh: pf.backupFresh,
      backupVerified: pf.backupFresh,
      authReady: pf.authReady,
      rateLimitReady: true,
      signerReady: pf.signerReady,
      externalSignerConnected: pf.externalSignerConnected,
      pendingSignatureQueue: pf.signatureQueue,
      chainStatus: {
        ok: pf.chainOk,
        seals: pf.sealCount,
        receipts: pf.receiptsCount,
        forks: pf.chainForks
      },
      networks: pf.networks.map((n) => ({
        network: n.network,
        status: n.status,
        chainType: n.chainType ?? null,
        chainId: n.chainId ?? null,
        rpcStatus: n.rpcStatus ?? null,
        blocker: n.blocker,
        ownerAction: n.ownerAction,
        isReadyForAnchor: n.isReadyForAnchor,
        isDryRunOnly: n.isDryRunOnly,
        lastChecked: n.lastChecked
      })),
      target: target ?? "all",
      firstAnchorReadiness: pf.firstAnchorReadiness,
      blockers: pf.blockers,
      warnings: pf.warnings,
      checks: pf.checks,
      recommendedNextAction: pf.recommendedNextAction,
      generatedAt: new Date().toISOString(),
      note: "קריאה בלבד — אין עוגן, אין שידור, אין מפתח; readyForAnchor=false אומר: עצור והשלם את החסרים לפני עוגן אמיתי"
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: coarseError(e, "anchor-preflight-failed") }, { status: 200 });
  }
}
