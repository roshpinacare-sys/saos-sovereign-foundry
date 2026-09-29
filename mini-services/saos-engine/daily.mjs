/**
 * daily.mjs — one-command autonomous cycle (A-8 lineage, T-9 local rebuild).
 * observe → tick → peg → convert-plan → report. Fail-isolated steps;
 * keyless core always runs; signing reports OPERATOR-GATE honestly
 * (no master keys exist on this box — rotation history makes that PERMANENT
 * policy here, not a bug).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  planLadder, planConvert, inventorySkew, parityVerdict, pnlFromFills, classifyStale,
} from "./lib.mjs";
import {
  externalParity, internalFeed, accountState, openOrders, measureAll, fuelToUsdPerDay,
} from "./measure.mjs";
import { tick as gridTick, fold, activeGrids } from "./grid.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

const stepWrap = async (name, fn) => {
  const t0 = Date.now();
  try {
    const out = await fn();
    return { name, ok: true, ms: Date.now() - t0, ...out };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) };
  }
};

export async function runCycle({ now = new Date().toISOString(), persist = true } = {}) {
  const report = { startedAt: now, account: ACCOUNT, steps: {} };

  /* 1 · observe: parity + inventory + fills + rails fuel */
  report.steps.observe = await stepWrap("observe", async () => {
    const [par, feed, acc, oo, meas] = await Promise.all([
      externalParity(), internalFeed(), accountState(ACCOUNT), openOrders(ACCOUNT), measureAll(ACCOUNT),
    ]);
    const fillsPnl = pnlFromFills(meas.fills);
    const fuelUsd = acc.ok && acc.totalVestingShares && par.steemUsd > 0
      ? fuelToUsdPerDay(meas.fuel.curationVestsPerDay, acc.totalVestingShares, acc.totalVestingFund, par.steemUsd)
      : null;
    const authorUsdPerDay = par.sbdUsd > 0 ? Math.round(meas.fuel.authorSbdPerDay * par.sbdUsd * 1e4) / 1e4 : null;
    const band = parityVerdict(par.parity, feed.median);
    // T-9 honesty: empty book (oo.ok && orders.length===0) is a REAL fact;
    // a FAILED book read (oo.ok===false) must never masquerade as one.
    const data = {
      parity: par, feed: feed.median, band,
      steemUsd: par.steemUsd ?? null, sbdUsd: par.sbdUsd ?? null,
      inventory: acc.ok ? { steem: acc.steem, sbd: acc.sbd, spOwn: acc.spOwn, rcPct: acc.rcPct } : null,
      ordersOk: oo.ok, orders: oo.orders,
      fills: meas.fills.length, lastFillAt: meas.lastFillAt,
      pnl: fillsPnl,
      fuel: { ...meas.fuel, fuelUsdPerDay: fuelUsd, authorUsdPerDay, histLen: meas.histLen, node: meas.node },
    };
    if (data.fuel.curationOps === 0 && data.fuel.authorOps === 0) {
      data.fuel.windowNote = "no reward ops inside the measured window — rails dormant, not a parse failure (deep-scan documented separately)";
    }
    if (persist) {
      writeJson(path.join(STATE, "observe.json"), { ...data, at: now });
      appendLine(path.join(STATE, "events.jsonl"), { type: "observe.done", at: now, fills: meas.fills.length, parity: par.parity });
    }
    return { ...data, summary: `parity ${par.parity || "?"} (${par.source}) · fills ${meas.fills.length} · fuel ${fuelUsd ?? "?"}$` };
  });

  const obs = report.steps.observe;

  /* 2 · tick: deterministic trigger-grid sim */
  report.steps.tick = await stepWrap("tick", async () => {
    const prev = readJson(path.join(STATE, "state.json"), { runCount: 0, simFills: 0, simFeesMu: 0 });
    const inv = obs.ok && !obs.error ? { steem: obs.inventory?.steem ?? 0, sbd: obs.inventory?.sbd ?? 0 } : { steem: 0, sbd: 0 };
    const res = gridTick({
      refPrice: obs.ok ? obs.parity.parity : 0,
      internalFeed: obs.ok ? obs.feed : 0,
      inventory: inv, runCount: prev.runCount, now,
    });
    const st = fold(prev, res);
    if (persist) {
      writeJson(path.join(STATE, "state.json"), { ...st, grids: activeGrids() });
      for (const e of res.events) appendLine(path.join(STATE, "events.jsonl"), e);
    }
    return { runCount: st.runCount, simFills: st.simFills, simFeesMu: st.simFeesMu, events: res.events.length };
  });

  /* 3 · peg: parity-anchored offer plan (skew + floor law) */
  report.steps.peg = await stepWrap("peg", async () => {
    if (!obs.ok || !(obs.parity.parity > 0)) {
      const blocked = { verdict: "NO-PARITY", blocker: ["observe-failed"], at: now };
      if (persist) writeJson(path.join(STATE, "offer.json"), { ...blocked, publishedAt: now });
      return { verdict: "NO-PARITY", blocker: ["observe-failed"] };
    }
    const inv = obs.inventory ?? { steem: 0, sbd: 0 };
    const skew = inventorySkew(inv.steem, inv.sbd, obs.parity.parity);
    const live = obs.orders ?? [];
    const staleCls = classifyStale(live, obs.parity.parity);
    // budgets: additive doctrine — plan from LIQUID (never touches live orders)
    const plan = planLadder({
      parity: obs.parity.parity,
      askBudgetSteem: Math.max(0, inv.steem),
      bidBudgetSbd: Math.max(0, inv.sbd - 0.5),
      spreadBps: Math.abs(obs.band?.bps ?? 0),
      skew, now,
    });
    const offer = {
      verdict: plan.verdict, parityBps: obs.band?.bps ?? null,
      blocker: plan.blocker, plan: { asks: plan.asks, bids: plan.bids },
      marks: { paritySbdPerSteem: Math.round(obs.parity.parity * 1e6) / 1e6, source: obs.parity.source, lowConfidence: !!obs.parity.lowConfidence, internalFeed: Math.round(obs.feed * 1e6) / 1e6, dragK: plan.dragK, floor: plan.floor, ceiling: plan.ceiling },
      skew, stale: { count: staleCls.stale.length, orderids: staleCls.stale.map((o) => o.orderid) },
      publishedAt: now,
    };
    if (persist) {
      writeJson(path.join(STATE, "offer.json"), offer);
      appendLine(path.join(STATE, "events.jsonl"), { type: "offer.published", at: now, verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length });
    }
    return { verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length, staleCount: staleCls.stale.length, skew: skew.skew };
  });

  /* 4 · convert-plan: D-023 PSM hysteresis (SBD face-$1 edge) */
  report.steps.convert = await stepWrap("convert", async () => {
    const prev = readJson(path.join(STATE, "convert-state.json"), { armed: false, pendingSbd: 0 });
    const inv = obs.ok ? (obs.inventory ?? { sbd: 0 }) : { sbd: 0 };
    // market SBD price in USD — single source of truth: the observe ladder
    const marketSbdUsd = obs.ok ? (obs.sbdUsd ?? 0) : 0;
    const plan = planConvert({
      liquidSbd: inv.sbd ?? 0, parity: obs.ok ? obs.parity.parity : 0,
      marketSbdUsd, previouslyArmed: !!prev.armed, pendingSbd: prev.pendingSbd ?? 0,
    });
    // T-9 visibility-only proxy: implied SBD/USD = steemUsd ÷ feed (the witness
    // feed encodes the market SBD value). NEVER used to arm convert — D-023
    // auto-arm requires a MEASURED external market price, which evaporated.
    const impliedSbdUsd = obs.ok && (obs.steemUsd ?? 0) > 0 && obs.feed > 0
      ? Math.round((obs.steemUsd / obs.feed) * 1e6) / 1e6 : null;
    const out = { ...plan, marketSbdUsd: Math.round(marketSbdUsd * 1e6) / 1e6, impliedSbdUsd, marketSourceNote: marketSbdUsd > 0 ? "external-measured" : "no-external-SBD-market (delisted binance/poloniex/upbit/mexc) — HOLD is honest", at: now };
    if (persist) {
      writeJson(path.join(STATE, "convert-plan.json"), out);
      writeJson(path.join(STATE, "convert-state.json"), { armed: plan.verdict === "CONVERT-PLAN", pendingSbd: prev.pendingSbd ?? 0 });
      appendLine(path.join(STATE, "events.jsonl"), { type: "convert.planned", at: now, verdict: plan.verdict, edgeBps: plan.edgeBps, amountSbd: plan.amountSbd });
    }
    return { verdict: plan.verdict, amountSbd: plan.amountSbd, edgeBps: plan.edgeBps, marketSbdUsd: out.marketSbdUsd, impliedSbdUsd: out.impliedSbdUsd, marketSourceNote: out.marketSourceNote };
  });

  /* 5 · execute (signing): HONEST gate — no keys on this box, ever */
  report.steps.execute = {
    name: "execute", ok: true, skipped: true,
    verdict: "OPERATOR-GATE",
    reason: "signing requires live authorities; this sovereign-local engine is keyless BY DESIGN (rotated material is burned — SETTLE-10). Execution paths: (a) restore a scoped key into an external signer you control, (b) re-arm via the fleet Actions secrets. Plans above are doctrine-clean and ready.",
  };

  /* 6 · report: profitability rollup */
  report.steps.report = await stepWrap("report", async () => {
    const pnl = obs.ok ? obs.pnl : null;
    const fuelUsd = obs.ok ? obs.fuel?.fuelUsdPerDay ?? null : null;
    const authorUsd = obs.ok ? obs.fuel?.authorUsdPerDay ?? null : null;
    const rollup = {
      realizedSbd: pnl?.realizedSbd ?? null,
      positionSteem: pnl?.positionSteem ?? null,
      positionAvgCost: pnl?.positionAvgCost ?? null,
      unbasedSteem: pnl?.unbasedSteem ?? null,
      deployedSteem: obs.ok && obs.ordersOk
        ? (obs.orders ?? []).filter((o) => o.side === "ask").reduce((s, o) => s + Number(o.base.split(" ")[0] || 0), 0)
        : null, // null = measurement failed — NEVER display 0 as "empty book"
      fuelUsdPerDay: fuelUsd, authorUsdPerDay: authorUsd,
      measuredTotalUsdPerDay: Math.round(((fuelUsd ?? 0) + (authorUsd ?? 0)) * 1e4) / 1e4,
      honesty: "unbased ≠ profit · signing operator-gated · all numbers measured this cycle",
    };
    report.rollup = rollup;
    return rollup;
  });

  report.ok = Object.values(report.steps).every((s) => s.ok !== false);
  report.finishedAt = new Date().toISOString();
  // T-9 fix: the report file must be written AFTER ok/finishedAt/report-step
  // exist on the report (writing inside the step wrote a self-less snapshot —
  // the cockpit honestly read ok:false-missing and showed DEGRADED).
  if (persist) writeJson(path.join(STATE, "daily-report.json"), report);
  return report;
}

/* CLI: bun daily.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCycle().then((r) => {
    console.log(JSON.stringify({ ok: r.ok, steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, v.verdict ?? (v.ok ? "ok" : "fail")])), rollup: r.rollup }, null, 2));
  }).catch((e) => { console.error("CYCLE-FAIL", e); process.exit(1); });
}
