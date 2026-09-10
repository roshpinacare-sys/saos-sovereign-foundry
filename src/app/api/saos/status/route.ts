import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { coarseError } from "@/lib/saos/api-errors";
import { HISTORIC_ANCHORS } from "@/lib/saos/historic";
import { networkStatuses } from "@/lib/saos/network-status";
import { probeEthereumReadonly } from "@/lib/saos/networks/ethereum";
import { probeSolanaReadonly } from "@/lib/saos/networks/solana";
import { saosModeFresh } from "@/lib/saos/modes";
import { authConfigured } from "@/lib/saos/auth";
import { enforceRateLimit, ruleFor } from "@/lib/saos/rate-limit";
import { signerRegistry } from "@/lib/saos/signer";
import { hiveRcLive } from "@/lib/saos/hive-rc-live";
import { externalSignerKeyMatches } from "@/lib/saos/external-signer-client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = enforceRateLimit("status", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    // Task 33: live RC + live key-match snapshot (both cached, fail-closed)
    // replace the stale env fallbacks that kept the page reporting "blocked".
    const [rcLive, keys] = await Promise.all([hiveRcLive(), externalSignerKeyMatches()]);
    const rcPct = rcLive?.rcPct ?? Number(process.env.HIVE_RC_PCT ?? 0.6);
    const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
    const mode = await saosModeFresh(); // roast 61: broadcastCapable from a FRESH signer verdict, never the sync cache

    // Task 12: opt-in read-only probe (?probe=1) — keyless public RPCs only,
    // short timeout, never throws; the DEFAULT call stays zero-live-calls.
    const wantsProbe = new URL(req.url).searchParams.get("probe") === "1";
    let probes: Record<string, unknown> | undefined;
    if (wantsProbe) {
      const [eth, sol] = await Promise.all([probeEthereumReadonly(), probeSolanaReadonly()]);
      // hostname only — the URL itself is never echoed
      probes = {
        ethereum: { probed: eth.probed, ok: eth.ok, chainId: eth.chainId, blockNumber: eth.blockNumber, sourceHost: eth.sourceHost, reason: eth.reason },
        solana: { probed: sol.probed, ok: sol.ok, slot: sol.slot, sourceHost: sol.sourceHost, reason: sol.reason },
        note: "קריאה-בלבד (אופציונלי) — אין עסקה, אין שידור, אין מפתח; כישלון קריאה = לא מאומת חי, לעולם לא עוגן סופי"
      };
    }

    const [seals, receipts, opCount] = await Promise.all([
      db.sealRecord.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { anchors: true, _count: { select: { leaves: true } } }
      }),
      db.evidenceReceipt.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.opLog.count()
    ]);

    return NextResponse.json({
      ok: true,
      motto: "אנחנו מנצחים את הבלוקצ'יין",
      mode: mode.mode,
      modeDetail: mode.detail,
      writesEnabled: mode.writesEnabled,
      broadcastCapable: mode.broadcastCapable,
      security: {
        authConfigured: authConfigured(),
        rateLimit: { active: true, status: ruleFor("status").perMinute, seal: ruleFor("seal").perMinute, auth: ruleFor("auth").perMinute },
        signer: signerRegistry().map((s) => ({ signer: s.signer, status: s.status }))
      },
      matrix: anchoringMatrix(rcPct, tronEnergy),
      networks: networkStatuses(rcPct, tronEnergy, keys),
      rcSource: rcLive ? `live ${rcLive.account} @ ${rcLive.at}` : "env fallback",
      ...(probes ? { probes } : {}),
      historic: HISTORIC_ANCHORS,
      seals: seals.map((s) => ({
        id: s.id,
        height: s.height,
        root: s.root,
        stateRoot: s.stateRoot,
        leaves: s._count.leaves,
        gasUsed: s.gasUsed,
        createdAt: s.createdAt,
        anchors: s.anchors.map((a) => ({
          network: a.network,
          status: a.status,
          txid: a.txid,
          gate: a.gate
        }))
      })),
      receipts: receipts.map((r) => ({
        kind: r.kind,
        digest: r.digest,
        prevDigest: r.prevDigest,
        at: r.createdAt
      })),
      opsLogged: opCount
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: coarseError(e, "status-failed") },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}
