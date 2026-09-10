import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { simulateEconomy, DEFAULT_ECONOMY, type EconomyInput } from "@/lib/saos/economy";
import { appendReceipt } from "@/lib/saos/receipt-store";
import { db } from "@/lib/db";

/**
 * GET /api/saos/economy — flywheel simulation + persistence.
 * Every call:
 *   1. computes the 4-stream economy simulation (pure math)
 *   2. persists an EconomySnapshot row (the previously write-less entity)
 *   3. chains an evidence receipt (money as micro-units — integers only)
 *
 * roast 57 input discipline (LIVE-CAUGHT: pool=-50000&profit=-5&door=-999 →
 * ok:true with NEGATIVE economics persisted into EconomySnapshot AND chained
 * as an evidence receipt — garbage into the money ledger). Now: every input is
 * bounded — percentages 0..100, volumes/rates/amounts 0..1e12 — and a violation
 * is REFUSED with the offending parameter names (errors are data; nothing is
 * simulated and nothing is persisted when the input is nonsense).
 */
const MAX_MAGNITUDE = 1e12;
const PCT_BOUNDS: Array<keyof EconomyInput> = ["poolFeePct", "flywheelPct"];

function validateEconomyInput(input: EconomyInput): string[] {
  const bad: string[] = [];
  for (const k of Object.keys(input) as Array<keyof EconomyInput>) {
    const v = input[k];
    if (!Number.isFinite(v)) bad.push(`${k}: not-finite`);
    else if (v < 0) bad.push(`${k}: negative (${v})`);
    else if (PCT_BOUNDS.includes(k) ? v > 100 : v > MAX_MAGNITUDE) bad.push(`${k}: out-of-range (${v})`);
  }
  return bad;
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("economy", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: ניסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
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

    const invalid = validateEconomyInput(input);
    if (invalid.length) {
      return NextResponse.json(
        { ok: false, error: `invalid-economy-input (nothing simulated, nothing persisted): ${invalid.join(" · ")}` },
        { status: 400 }
      );
    }

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
