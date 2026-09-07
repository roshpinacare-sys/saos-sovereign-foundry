import { NextResponse } from "next/server";
import { simulateEconomy, DEFAULT_ECONOMY, type EconomyInput } from "@/lib/saos/economy";
import { appendReceipt } from "@/lib/saos/receipt-store";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/economy — flywheel simulation + persistence.
 * Every call:
 *   1. computes the 4-stream economy simulation (pure math)
 *   2. persists an EconomySnapshot row (the previously write-less entity)
 *   3. chains an evidence receipt (money as micro-units — integers only)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams;
    const input: EconomyInput = {
      poolVolumePerDay: num(q.get("pool"), DEFAULT_ECONOMY.poolVolumePerDay),
      poolFeePct: num(q.get("fee"), DEFAULT_ECONOMY.poolFeePct),
      gridRoundsPerDay: num(q.get("rounds"), DEFAULT_ECONOMY.gridRoundsPerDay),
      gridProfitPerRound: num(q.get("profit"), DEFAULT_ECONOMY.gridProfitPerRound),
      inboundRailVolume: num(q.get("rail"), DEFAULT_ECONOMY.inboundRailVolume),
      inboundRate: num(q.get("rate"), DEFAULT_ECONOMY.inboundRate),
      doorCallsPerDay: num(q.get("door"), DEFAULT_ECONOMY.doorCallsPerDay),
      doorFee: num(q.get("doorFee"), DEFAULT_ECONOMY.doorFee),
      flywheelPct: num(q.get("fly"), DEFAULT_ECONOMY.flywheelPct)
    };

    const result = simulateEconomy(input);

    // persist the snapshot — EconomySnapshot writer
    const saved = await db.economySnapshot.create({
      data: {
        label: `sim-${new Date().toISOString().slice(0, 19)}`,
        inputs: JSON.stringify(input),
        streams: JSON.stringify(result.streams),
        totalPerDay: result.totalPerDay,
        flywheelPct: input.flywheelPct
      }
    });

    const appended = await appendReceipt(
      "economy-sim",
      // canonical discipline: integers only — SAOS as micro-units (×100)
      {
        totalPerDayMicro: Math.round(result.totalPerDay * 100),
        retainedMicro: Math.round(result.retainedPerDay * 100),
        flywheelPct: Math.round(input.flywheelPct),
        snapshotId: saved.id
      }
    );

    return NextResponse.json({
      ok: true,
      input,
      result,
      snapshotId: saved.id,
      receipt: appended.receipt.digest,
      persisted: appended.persisted
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "economy failed" },
      { status: 200 } // never 500
    );
  }
}

function num(v: string | null, d: number): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}
