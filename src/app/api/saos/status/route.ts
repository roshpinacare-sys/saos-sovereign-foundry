import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { coarseError } from "@/lib/saos/api-errors";
import { ensureSupervisor } from "@/lib/saos/supervisor-bridge";
import { supervisorStatus } from "@/instrumentation-node";
import { HISTORIC_ANCHORS } from "@/lib/saos/historic";
import { networkStatuses } from "@/lib/saos/network-status";
import { probeEthereumReadonly } from "@/lib/saos/networks/ethereum";
import { probeSolanaReadonly } from "@/lib/saos/networks/solana";
import { saosModeFresh } from "@/lib/saos/modes";
import { authConfigured } from "@/lib/saos/auth";
import { enforceRateLimit, ruleFor } from "@/lib/saos/rate-limit";
import { signerRegistry } from "@/lib/saos/signer";
import { hiveRcLive } from "@/lib/saos/hive-rc-live";
import { tronEnergyLive } from "@/lib/saos/tron-energize-live";
import { fleetCureStatus } from "@/lib/saos/fleet-cure";
import { externalSignerKeyMatches } from "@/lib/saos/external-signer-client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Task 62: מעיר את מפקח-השירותים בתוך תהליך-ה-Next (פעם-אחת, בטוח-לכפילות)
  ensureSupervisor();
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
    const [rcLive, keys, tronLive] = await Promise.all([hiveRcLive(), externalSignerKeyMatches(), tronEnergyLive()]);
    const rcPct = rcLive?.rcPct ?? Number(process.env.HIVE_RC_PCT ?? 0.6);
    // Task 87: fleet-effective HIVE gate — the best READY fleet account from the
    // fleet-cure status file (fresh-gated, public data) overrides a bare
    // "gated" when the main account's stored RC is below the floor.
    const fc = fleetCureStatus();
    const fleetBestRow = fc.accounts
      .filter((a) => a.state === "ready" && a.manaPct >= 8)
      .sort((x, y) => y.manaPct - x.manaPct)[0];
    const hiveFleet = fleetBestRow ? { account: fleetBestRow.account, rcPct: fleetBestRow.manaPct } : null;
    // live TRON measurement (getaccount, keyless, 10-min cache) replaces the
    // frozen TRON_ENERGY field measurement as primary; env stays fail-closed.
    const tronEnergy = tronLive?.probed ? tronLive.energyUnits : Number(process.env.TRON_ENERGY ?? 0);
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

    const [seals, receipts, opCount, supervisor] = await Promise.all([
      db.sealRecord.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { anchors: true, _count: { select: { leaves: true } } }
      }),
      db.evidenceReceipt.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.opLog.count(),
      // Task 62: אמת-המפקח — חי/מנוטרל/ניסיונות, מדידת-TCP רגעית (לא קובץ-סטטוס קפוא)
      supervisorStatus()
    ]);

    // Task 74: latest VERIFIED live anchors per network — the freshest truth
    // replaces the static historic ref on the network views (derived, never
    // invented; only the pulse writes "anchored" rows — truth contract kept).
    const verifiedRows = await db.anchorTx.findMany({
      where: { txid: { not: null }, status: "anchored" },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { network: true, txid: true }
    });
    const liveAnchors: Record<string, string> = {};
    for (const row of verifiedRows) {
      if (row.txid && !liveAnchors[row.network]) liveAnchors[row.network] = row.txid;
    }

    // Task 74: collapse per-network anchor rows for the seals view — a seal can
    // carry BOTH a seal-time matrix snapshot row ("pending", txid:null) and the
    // REAL verified anchor row (txid set by the pulse). Showing both made the
    // screen say "ממתין" and "נעוגן" side by side. The strongest honest state
    // wins: a txid-bearing row beats a snapshot row; within the same class the
    // newest wins.
    const collapseSealAnchors = (rows: Array<{ network: string; status: string; txid: string | null; gate: string | null; createdAt: Date }>) => {
      const byNet = new Map<string, { network: string; status: string; txid: string | null; gate: string | null; createdAt: Date }>();
      for (const a of [...rows].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())) {
        const cur = byNet.get(a.network);
        if (!cur || (!cur.txid && a.txid)) byNet.set(a.network, a);
      }
      return [...byNet.values()];
    };

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
      matrix: anchoringMatrix(rcPct, tronEnergy, tronLive ?? undefined, hiveFleet),
      networks: networkStatuses(rcPct, tronEnergy, keys, liveAnchors, tronLive ?? undefined),
      // Task 62: אמת-שירותי-הרקע — הטענה היחידה שמותר למסך להציג על הצי
      supervisor,
      rcSource: rcLive ? `live ${rcLive.account} @ ${rcLive.at}` : "env fallback",
      tronSource: tronLive?.probed ? `live getaccount @ ${tronLive.sourceHost} (${tronLive.addresses} כתובות) @ ${tronLive.at}` : "env fallback (TRON_ENERGY)",
      tronMeasure: tronLive && tronLive.probed ? { at: tronLive.at, addresses: tronLive.addresses, activated: tronLive.activated, withResources: tronLive.withResources, totalBalanceSun: tronLive.totalBalanceSun, totalEnergyStakedSun: tronLive.totalEnergyStakedSun, reason: tronLive.reason } : undefined,
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
        anchors: collapseSealAnchors(s.anchors).map((a) => ({
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
