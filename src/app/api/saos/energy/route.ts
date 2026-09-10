import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import {
  planEnergize,
  minStakeForSettlements,
  ENERGY_PER_TRX_PER_DAY,
  BURN_SUN_PER_ENERGY,
  USDT_TRANSFER_ENERGY
} from "@/lib/saos/tron-energize";
import { hiveRcRecoveryPlan, HIVE_RC_REGEN_PCT_PER_DAY } from "@/lib/saos/anchor-gates";
import { appendReceipt } from "@/lib/saos/receipt-store";
import { coarseError } from "@/lib/saos/api-errors";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Roast-58: user-supplied planning params used to flow into EnergyPlan AND the
// evidence chain with no domain check — LIVE-proven this round: rc=-50 persisted
// a negative-percent plan + chained a receipt, and trx=2e9&txs=999999 wrote
// energyOut=2e10 into an Int column (SQLite stored it, Prisma can no longer
// READ the table — P2023 on every scan, the public /plans route died).
// Same class as the economy fix (roast-57): bounded inputs, refuse with the
// offending param names, nothing computed, nothing persisted.
const MAX_RC_PCT = 100; // RC is a percentage — [0, 100]
const MAX_TRX_STAKED = 100_000_000; // 100M TRX — far beyond any planning scenario, Int-safe
const MAX_TXS_PER_DAY = 1_000_000; // int-safe, absurd-proof

/**
 * GET /api/saos/energy — computation + persistence (computation-only per network rules).
 * Every call:
 *   1. computes the plan (TRON energize | HIVE rc-recovery) — pure math, zero live calls
 *   2. persists an EnergyPlan row (the previously write-less entity)
 *   3. chains an evidence receipt (integer-safe canonical payload)
 */
export async function GET(req: Request) {
  const rl = enforceRateLimit("energy", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: ניסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    const url = new URL(req.url);
    const net = (url.searchParams.get("net") ?? "tron").toLowerCase();
    const bad: string[] = [];

    if (net === "hive") {
      const rcRaw = url.searchParams.get("rc") ?? "0.6";
      const rcPct = Number(rcRaw);
      if (!Number.isFinite(rcPct)) bad.push(`rc: not-finite (${rcRaw})`);
      else if (rcPct < 0) bad.push(`rc: negative (${rcRaw})`);
      else if (rcPct > MAX_RC_PCT) bad.push(`rc: out-of-range (> ${MAX_RC_PCT}, got ${rcRaw})`);
      if (bad.length) {
        return NextResponse.json(
          { ok: false, error: `invalid-energy-input (nothing computed, nothing persisted): ${bad.join(" · ")}` },
          { status: 400 }
        );
      }
      const plan = hiveRcRecoveryPlan(rcPct);

      // persist the plan — EnergyPlan writer (integer-safe payload: per-mille units)
      const saved = await db.energyPlan.create({
        data: {
          network: "HIVE",
          mode: "rc-recovery",
          rcFloorPct: rcPct,
          notes: plan.verdict,
          payload: JSON.stringify({
            net: "HIVE",
            rcPermille: Math.round(rcPct * 10),
            lightFloorHoursX10: Math.round(plan.lightFloorHours * 10),
            heavyFloorHoursX10: Math.round(plan.heavyFloorHours * 10),
            verdict: plan.verdict
          })
        }
      });

      const appended = await appendReceipt(
        "energy-plan",
        // canonical discipline: integers only — rc as per-mille (×10)
        { net: "HIVE", rcPermille: Math.round(rcPct * 10), verdict: plan.verdict, planId: saved.id }
      );

      return NextResponse.json({
        ok: true,
        network: "HIVE",
        params: { regenPctPerDay: HIVE_RC_REGEN_PCT_PER_DAY, lightFloor: 8, heavyFloor: 12 },
        plan,
        planId: saved.id,
        receipt: appended.receipt.digest,
        persisted: appended.persisted,
        suppressed: appended.suppressed ?? null
      });
    }

    // TRON energize (default)
    const trxRaw = url.searchParams.get("trx") ?? "6500";
    const trx = Number(trxRaw);
    const txsRaw = url.searchParams.get("txs") ?? "4";
    const txs = Number(txsRaw);
    const price = url.searchParams.get("price");
    if (!Number.isFinite(trx)) bad.push(`trx: not-finite (${trxRaw})`);
    else if (trx < 0) bad.push(`trx: negative (${trxRaw})`);
    else if (trx > MAX_TRX_STAKED) bad.push(`trx: out-of-range (> ${MAX_TRX_STAKED}, got ${trxRaw})`);
    if (!Number.isFinite(txs)) bad.push(`txs: not-finite (${txsRaw})`);
    else if (!Number.isInteger(txs)) bad.push(`txs: not-integer (${txsRaw})`);
    else if (txs < 1) bad.push(`txs: below-minimum (≥1, got ${txsRaw})`);
    else if (txs > MAX_TXS_PER_DAY) bad.push(`txs: out-of-range (> ${MAX_TXS_PER_DAY}, got ${txsRaw})`);
    if (price !== null) {
      const priceN = Number(price);
      if (!Number.isFinite(priceN)) bad.push(`price: not-finite (${price})`);
      else if (priceN < 0) bad.push(`price: negative (${price})`);
    }
    if (bad.length) {
      return NextResponse.json(
        { ok: false, error: `invalid-energy-input (nothing computed, nothing persisted): ${bad.join(" · ")}` },
        { status: 400 }
      );
    }
    const plan = planEnergize({
      trxStaked: trx,
      txsPerDayWanted: txs,
      trxPriceUsd: price !== null ? Number(price) : null
    });

    // persist the plan — EnergyPlan writer (burnCost in TRX/day, rounded)
    const saved = await db.energyPlan.create({
      data: {
        network: "TRON",
        mode: "energize",
        trxStaked: Math.round(trx),
        energyOut: plan.dailyEnergy,
        settlements: plan.settlementsPerDay,
        burnCost: Math.round(plan.burnCostPerDayTrx),
        notes: plan.verdict,
        payload: JSON.stringify({
          net: "TRON",
          trxStaked: Math.round(trx),
          txsWanted: Math.round(txs),
          dailyEnergy: plan.dailyEnergy,
          settlementsPerDay: plan.settlementsPerDay,
          uncoveredPerDay: plan.uncoveredPerDay,
          breakEvenTxs: plan.breakEvenTxs,
          burnCostPerTxMicroTrx: Math.round(plan.burnCostPerTxTrx * 1000)
        })
      }
    });

    const appended = await appendReceipt(
      "energy-plan",
      { net: "TRON", trxStaked: Math.round(trx), txsWanted: Math.round(txs), settlements: plan.settlementsPerDay, planId: saved.id }
    );

    return NextResponse.json({
      ok: true,
      network: "TRON",
      params: {
        sunPerTrx: 1_000_000,
        burnSunPerEnergy: BURN_SUN_PER_ENERGY,
        usdtTransferEnergy: USDT_TRANSFER_ENERGY,
        energyPerTrxPerDay: ENERGY_PER_TRX_PER_DAY
      },
      minStakeForSettlements: minStakeForSettlements(txs),
      plan,
      planId: saved.id,
      receipt: appended.receipt.digest,
      persisted: appended.persisted,
      suppressed: appended.suppressed ?? null
    });
  } catch (e) {
    // roast-58: raw e.message leaked Prisma internals + source paths (LIVE-proven)
    return NextResponse.json(
      { ok: false, error: coarseError(e, "energy-failed") },
      { status: 200 } // never 500
    );
  }
}
