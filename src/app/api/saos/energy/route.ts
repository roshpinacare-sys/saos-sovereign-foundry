import { NextResponse } from "next/server";
import {
  planEnergize,
  minStakeForSettlements,
  ENERGY_PER_TRX_PER_DAY,
  BURN_SUN_PER_ENERGY,
  USDT_TRANSFER_ENERGY
} from "@/lib/saos/tron-energize";
import { hiveRcRecoveryPlan, HIVE_RC_REGEN_PCT_PER_DAY } from "@/lib/saos/anchor-gates";
import { appendReceipt } from "@/lib/saos/receipt-store";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/energy — computation + persistence (computation-only per network rules).
 * Every call:
 *   1. computes the plan (TRON energize | HIVE rc-recovery) — pure math, zero live calls
 *   2. persists an EnergyPlan row (the previously write-less entity)
 *   3. chains an evidence receipt (integer-safe canonical payload)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const net = (url.searchParams.get("net") ?? "tron").toLowerCase();

    if (net === "hive") {
      const rcPct = Number(url.searchParams.get("rc") ?? 0.6);
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
        persisted: appended.persisted
      });
    }

    // TRON energize (default)
    const trx = Math.max(0, Number(url.searchParams.get("trx") ?? 6500));
    const txs = Math.max(1, Number(url.searchParams.get("txs") ?? 4));
    const price = url.searchParams.get("price");
    const plan = planEnergize({
      trxStaked: trx,
      txsPerDayWanted: txs,
      trxPriceUsd: price !== null && Number.isFinite(Number(price)) ? Number(price) : null
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
      persisted: appended.persisted
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "energy failed" },
      { status: 200 } // never 500
    );
  }
}
