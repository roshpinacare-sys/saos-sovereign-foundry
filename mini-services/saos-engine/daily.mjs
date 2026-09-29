/**
 * daily.mjs — one-command autonomous cycle (A-8 lineage, T-9 local rebuild,
 * T-12 LIVE EXECUTION: the operator handed the master credential and ordered
 * full autonomous, sovereign operation without operator intervention.
 * T-14 CONTINUOUS LEARNING: the machine reads its own recorded history every
 * cycle, derives evidence-backed lessons, and applies hard-clamped tunings —
 * plus a cadence-gated network scan for growth options (discovery).
 *
 * observe → intel → tick → peg(intel-fed) → convert → execute(SIGN) → soldiers → learn(T-14) → report
 *
 * Fail-isolated steps; every signing op doctrine-capped (signer.mjs);
 * pause button = operator kill-switch (state/exec-pause.json); everything
 * journaled: events.jsonl + exec-log.jsonl (txids, never keys).
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
import { runIntel } from "./intel.mjs";
import { executeOps, executeAs, armedConf, execPaused, masterAccount } from "./signer.mjs";
import { deploySoldiers, runSoldierGrids, soldiersState } from "./soldiers.mjs";
import { postDailyReport } from "./promo.mjs";
import { runCurator } from "./curator.mjs";
import { runLearning } from "./learning.mjs";
import { runDiscovery } from "./discovery.mjs";

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
  let intelOut = null;

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
    const data = {
      account: ACCOUNT,
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

  /* 2 · intel: self-activating decisions (feeds peg + execute + soldiers) */
  report.steps.intel = await stepWrap("intel", async () => {
    intelOut = await runIntel({
      obs: { account: ACCOUNT, band: obs.ok ? obs.band : null, fuel: obs.ok ? obs.fuel : null, inventory: obs.ok ? obs.inventory : null },
      offer: null, convert: null, now,
    });
    return {
      verdict: `DECISIONS:${intelOut.decisions.length}`,
      decisions: intelOut.decisions.map((d) => `${d.kind}:${d.decision}`),
      spreadBpsRec: intelOut.spreadBpsRec,
      book: intelOut.book,
    };
  });

  /* 3 · tick: deterministic trigger-grid sim */
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

  /* 4 · peg: parity-anchored offer plan (skew + floor law), intel-fed spread */
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
    const spreadBps = intelOut?.spreadBpsRec ?? Math.abs(obs.band?.bps ?? 0);
    // T-12 liquidity law: deploy ≤ 60% of tradable capital — never starve the
    // fleet (soldier top-ups, fees, reserves). Deployed counts only OUR live
    // orders; fills free budget automatically (thing-drags-thing).
    const deployedAsks = live.filter((o) => o.side === "ask").reduce((s, o) => s + Number(String(o.base).split(" ")[0] || 0), 0);
    const deployedBids = live.filter((o) => o.side === "bid").reduce((s, o) => s + Number(String(o.base).split(" ")[0] || 0), 0);
    const maxDeploySteem = 0.6 * (inv.steem + deployedAsks);
    const maxDeploySbd = 0.6 * (inv.sbd + deployedBids);
    const askBudget = Math.max(0, Math.min(inv.steem, maxDeploySteem - deployedAsks));
    const bidBudget = Math.max(0, Math.min(inv.sbd - 0.5, maxDeploySbd - deployedBids));
    const plan = planLadder({
      parity: obs.parity.parity,
      askBudgetSteem: askBudget,
      bidBudgetSbd: bidBudget,
      spreadBps, skew, now,
    });
    const offer = {
      verdict: plan.verdict, parityBps: obs.band?.bps ?? null,
      blocker: plan.blocker, plan: { asks: plan.asks, bids: plan.bids },
      marks: { paritySbdPerSteem: Math.round(obs.parity.parity * 1e6) / 1e6, source: obs.parity.source, lowConfidence: !!obs.parity.lowConfidence, internalFeed: Math.round(obs.feed * 1e6) / 1e6, dragK: plan.dragK, floor: plan.floor, ceiling: plan.ceiling, spreadBpsFed: spreadBps },
      skew, stale: { count: staleCls.stale.length, orderids: staleCls.stale.map((o) => o.orderid) },
      liquidity: { deployedAsks: Math.round(deployedAsks * 1e3) / 1e3, deployedBids: Math.round(deployedBids * 1e3) / 1e3, askBudget: Math.round(askBudget * 1e3) / 1e3, bidBudget: Math.round(bidBudget * 1e3) / 1e3, deployCap: 0.6 },
      publishedAt: now,
    };
    if (persist) {
      writeJson(path.join(STATE, "offer.json"), offer);
      appendLine(path.join(STATE, "events.jsonl"), { type: "offer.published", at: now, verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length });
    }
    return { verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length, staleCount: staleCls.stale.length, skew: skew.skew, liquidity: offer.liquidity };
  });

  /* 5 · convert-plan: D-023 PSM hysteresis (SBD face-$1 edge) */
  report.steps.convert = await stepWrap("convert", async () => {
    const prev = readJson(path.join(STATE, "convert-state.json"), { armed: false, pendingSbd: 0 });
    const inv = obs.ok ? (obs.inventory ?? { sbd: 0 }) : { sbd: 0 };
    const marketSbdUsd = obs.ok ? (obs.sbdUsd ?? 0) : 0;
    const plan = planConvert({
      liquidSbd: inv.sbd ?? 0, parity: obs.ok ? obs.parity.parity : 0,
      marketSbdUsd, previouslyArmed: !!prev.armed, pendingSbd: prev.pendingSbd ?? 0,
    });
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

  /* 5b · curate (T-13): the measured fuel rail — VP put to work. Posting-key
   * only; a vote op can never move funds. Daily-capped, VP-floored, journaled. */
  report.steps.curate = await stepWrap("curate", async () => {
    const out = await runCurator({ now });
    return { verdict: out.verdict, votes: out.voted?.length ?? 0, txid: out.txid ?? null, vpEff: out.vpEff ?? null, votesToday: out.votesTodayCount ?? 0, error: out.error ?? null };
  });

  /* 6 · execute (SIGNING — the X-1 rail, engine-held, doctrine-capped) */
  report.steps.execute = await stepWrap("execute", async () => {
    const conf = armedConf();
    if (!conf.armed) return { verdict: "DISARMED", reason: "standing-order-off" };
    if (execPaused()) return { verdict: "OPERATOR-PAUSED", reason: "kill-switch" };

    const ops = [];
    // (a) stale repricing — cancel law-violating orders (D-021, cap 5)
    const offer = readJson(path.join(STATE, "offer.json"), null);
    for (const id of (offer?.stale?.orderids ?? []).slice(0, 5)) {
      ops.push(["limit_order_cancel", { owner: ACCOUNT, orderid: id }]);
    }
    // (b) fresh ladder from LIVE liquid, intel-capped (per-op CLAMPED to caps —
    // a cap must shrink an order, never silently skip the whole ladder side)
    if (offer?.plan) {
      const acc = await accountState(ACCOUNT);
      const liquidSteem = Math.max(0, acc.ok ? acc.steem ?? 0 : 0);
      const convAmt = report.steps.convert?.verdict === "CONVERT-PLAN" ? (report.steps.convert.amountSbd ?? 0) : 0;
      const bidCap = Math.max(0, (acc.ok ? acc.sbd ?? 0 : 0) - convAmt - (conf.bidReserveSbd ?? 0.5));
      let askSum = 0, bidSum = 0;
      const tSec = Math.floor(Date.now() / 1000);
      for (const a of offer.plan.asks ?? []) {
        const amt = Math.min(a.amountSteem, Math.max(0, (conf.maxAskSteemPerCycle ?? 200) - askSum), Math.max(0, liquidSteem - askSum));
        if (amt < 0.001) break;
        ops.push(["limit_order_create", { owner: ACCOUNT, orderid: (tSec + ops.length) >>> 0, amount_to_sell: `${amt.toFixed(3)} STEEM`, min_to_receive: `${(amt * a.unit).toFixed(3)} SBD`, fill_or_kill: false, expiration: tSec + 86400 }]);
        askSum = Math.round((askSum + amt) * 1e6) / 1e6;
      }
      for (const b of offer.plan.bids ?? []) {
        const amt = Math.min(b.amountSbd, Math.max(0, bidCap - bidSum), Math.max(0, (conf.maxBidSbdPerCycle ?? 20) - bidSum));
        if (amt < 0.001) break;
        ops.push(["limit_order_create", { owner: ACCOUNT, orderid: (tSec + ops.length + 500) >>> 0, amount_to_sell: `${amt.toFixed(3)} SBD`, min_to_receive: `${(amt / b.unit).toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSec + 86400 }]);
        bidSum = Math.round((bidSum + amt) * 1e6) / 1e6;
      }
    }
    // (c) claim pending rewards — free fuel, never left on the table
    const rewDec = intelOut?.decisions?.find((d) => d.kind === "rewards" && d.decision === "claim");
    if (rewDec?.action?.any) {
      ops.push(["claim_reward_balance", {
        account: ACCOUNT,
        reward_steem: `${(rewDec.action.steem ?? 0).toFixed(3)} STEEM`,
        reward_sbd: `${(rewDec.action.sbd ?? 0).toFixed(3)} SBD`,
        reward_vests: `${(rewDec.action.vests ?? 0).toFixed(6)} VESTS`,
      }]);
    }
    // (d) convert execution (3.5d face-$1 rail) when MEASURED edge arms it
    if (convAmtExec(report.steps.convert)) {
      const c = report.steps.convert;
      ops.push(["convert", { owner: ACCOUNT, amount: `${c.amountSbd.toFixed(3)} SBD`, requestid: (Math.floor(Date.now() / 1000) & 0x7fffffff) }]);
    }
    if (!ops.length) return { verdict: "NO-OPS", ops: 0 };
    const res = await executeOps(ops, { tag: "cycle-execute" });

    // (e) promotion rail — one honest public report per day (posting key)
    let promo = null;
    if (conf.promo?.armed && obs.ok) {
      try { promo = await postDailyReport({ obs, rollup: report.steps.report?.rollup ?? null, intel: intelOut, now }); }
      catch (e) { promo = { verdict: "PROMO-ERROR", error: String(e?.message ?? e).slice(0, 120) }; }
    }
    return { verdict: res.verdict, txid: res.txid ?? null, ops: ops.length, opNames: res.opNames ?? ops.map(([n]) => n), node: res.node ?? null, error: res.error ?? null, promo };
  });

  /* 7 · soldiers: deploy once, top-up as liquidity returns, grid every cycle */
  report.steps.soldiers = await stepWrap("soldiers", async () => {
    const conf = armedConf();
    if (!conf.armed || execPaused()) return { verdict: "DISARMED-OR-PAUSED" };
    if (!conf.soldiers?.enabled) return { verdict: "DISABLED" };
    const st = soldiersState();
    let deploy = null, topups = [];
    if (!st.deployed) deploy = await deploySoldiers();
    // top-up rail: soldiers funded with dust (master float was committed to
    // asks at deploy time) get topped up when the master's liquid rebuilds
    const acc = await accountState(ACCOUNT);
    const masterLiquid = Math.max(0, acc.ok ? acc.steem ?? 0 : 0);
    for (const rec of (st.deployed ? st.accounts : [])) {
      if (topups.length >= 1) break; // max 1 top-up/cycle (doctrine cap)
      const sAcc = await accountState(rec.name);
      if ((sAcc.steem ?? 0) < 1 && masterLiquid - topups.length * 12 > 40) {
        const res = await executeAs(ACCOUNT, [["transfer", { from: ACCOUNT, to: rec.name, amount: "10.000 STEEM", memo: "grid soldier top-up" }]], { tag: "soldier-topup" });
        topups.push({ name: rec.name, verdict: res.verdict, txid: res.txid ?? null, error: res.error ?? null });
      }
    }
    const parity = obs.ok ? obs.parity.parity : 0;
    const grids = await runSoldierGrids({ parity, spreadBps: intelOut?.spreadBpsRec ?? 0, now });
    const verdict = deploy && !deploy.ok ? `DEPLOY-${deploy.verdict}` : grids.verdict;
    return {
      verdict, deploy: deploy ? { verdict: deploy.verdict, txid: deploy.txid ?? null, error: deploy.error ?? null } : null,
      topups, grids: grids.soldiers ?? [],
    };
  });

  /* 9 · learn (T-14): ingest recorded history → lessons → bounded tunings.
   *   learning is cheap (local files only) — every cycle; discovery (network
   *   reads) is cadence-gated internally at 30min. Fail-isolated like all
   *   steps; never blocks execution — learning shapes the NEXT cycle. */
  report.steps.learn = await stepWrap("learn", async () => {
    const learning = await runLearning({ now });
    const discovery = await runDiscovery({ now });
    return {
      verdict: learning.verdict,
      lessons: learning.lessons.map((l) => l.id),
      tunings: learning.tuningsApplied,
      discoveryVerdict: discovery.verdict,
      topOpportunities: discovery.opportunities?.slice(0, 3).map((o) => `${o.id}(${o.potentialClass})`) ?? [],
    };
  });

  /* 10 · report: profitability rollup */
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
        : null,
      fuelUsdPerDay: fuelUsd, authorUsdPerDay: authorUsd,
      measuredTotalUsdPerDay: Math.round(((fuelUsd ?? 0) + (authorUsd ?? 0)) * 1e4) / 1e4,
      honesty: "unbased ≠ profit · signing doctrine-capped · all numbers measured this cycle",
    };
    report.rollup = rollup;
    return rollup;
  });

  report.ok = Object.values(report.steps).every((s) => s.ok !== false);
  report.finishedAt = new Date().toISOString();
  if (persist) writeJson(path.join(STATE, "daily-report.json"), report);
  return report;
}

function convAmtExec(convertStep) {
  return convertStep?.verdict === "CONVERT-PLAN" && (convertStep.amountSbd ?? 0) >= 1;
}

/* CLI: bun daily.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCycle().then((r) => {
    console.log(JSON.stringify({ ok: r.ok, steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, v.verdict ?? (v.ok ? "ok" : "fail")])), rollup: r.rollup }, null, 2));
  }).catch((e) => { console.error("CYCLE-FAIL", e); process.exit(1); });
}
