import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { coarseError } from "@/lib/saos/api-errors";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/plans — read surface for the previously write-less entities:
 * recent EnergyPlan rows (TRON energize / HIVE rc-recovery) and recent
 * EconomySnapshot rows. Written by /api/saos/energy and /api/saos/economy.
 * Read-only — no receipts, no writes.
 */
export async function GET(req: Request) {
  const rl = enforceRateLimit("plans", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: ניסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    const [energyPlans, economySnapshots] = await Promise.all([
      db.energyPlan.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.economySnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 10 })
    ]);

    return NextResponse.json({
      ok: true,
      energyPlans: energyPlans.map((p) => ({
        id: p.id,
        network: p.network,
        mode: p.mode,
        trxStaked: p.trxStaked,
        energyOut: p.energyOut,
        settlements: p.settlements,
        burnCost: p.burnCost,
        rcFloorPct: p.rcFloorPct,
        notes: p.notes,
        payload: JSON.parse(p.payload),
        createdAt: p.createdAt
      })),
      economySnapshots: economySnapshots.map((s) => ({
        id: s.id,
        label: s.label,
        inputs: JSON.parse(s.inputs),
        streams: JSON.parse(s.streams),
        totalPerDay: s.totalPerDay,
        flywheelPct: s.flywheelPct,
        createdAt: s.createdAt
      })),
      counts: { energyPlans: energyPlans.length, economySnapshots: economySnapshots.length }
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: coarseError(e, "plans-failed") },
      { status: 200 } // never 500
    );
  }
}
