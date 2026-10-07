/**
 * fleet-grid.mjs — R234 · הגריד של הצי-הקיים (10 חשבונות-צבא) על-פי הוראת-מפעיל
 * (trace 1a113f67a0ed4be9):
 *   "צריך לוודא שגם החשבונות שלנו הקיימים עושים גריד ולא לפתוח חדשים לפני זה"
 *   "מה שיש לו מפתח אטום בכספת בטוח בגיט יכול להיות בטוח לשימוש"
 *
 * החוק החדש (fleet-grid-first):
 *   1. אין חשבונות-חדשים ואין מימון-חיילים חדשים לפני שהצי-הקיים גורד (T-80 מתוגבר).
 *   2. דור-1 (hcsoldier1/2/3) מת לצמיתות — LOST-NO-CUSTODY (T-78b); 56.001 STEEM
 *      + 0.417 SBD תקועים על-השרשרת, לא-ניתנים-לשחזור בלי טקסט-הצ'אט מהמפעיל.
 *   3. דור-2 (hcsoldier4/5/6) — אפוטרופסות-מוכחת בכספת, מושהה עד שהצי גורד.
 *   4. האפוטרופסות של הצבא שוחזרה ב-R234 מהכספת (גיליון-מפעיל, KEYS-ZIP-2026-09-10,
 *      sha256 24ef22b8…) — 10/10 חשבונות 4/4 מול-השרשרת, מותקן ב-.secrets/soldiers.json.
 *
 * מכניקה (אותם חוקי-סולם כמו-המאסטר, תקציבי-מיקרו):
 *   - מימון חד-פעמי: headcorner → כל חשבון-צבא fundEach STEEM (רשימת-היתר
 *     ב-transferAllowlist; allowTransfersOut נשאר false — היקף סגור).
 *   - סולם-מיקרו לכל חשבון: planLadder מצב-value, minLevel 0.2, 5 רמות, מעוגן-פריטה.
 *     צד-ה-ASK ראשון (ה-STEEM הנזיל); ה-SBD שנצבר מההצמדות מדליק את צד-ה-BID מעצמו.
 *   - שער-RC לכל חשבון (rcMinPct), תקרת-פעולות לכל חשבון, בידוד-כשל לכל חשבון.
 *   - אותו פס-חתימה (executeAs) עם כל השערים (custody/think/policy).
 *   - ראיה מלאה ב-state/fleet-grid.json (txid מימון, פסקי-דין, הזמנות-חיות).
 */
import fs from "node:fs";
import path from "node:path";
import { rpcCall, accountState, openOrders, externalParity } from "./measure.mjs";
import { planLadder, MIN_LEVEL } from "./lib.mjs";
import { executeAs, armedConf, execPaused, masterAccount, custodyOf, verifyRoles } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const GRID_FILE = path.join(STATE, "fleet-grid.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

const G = globalThis;
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, o) => { try { fs.appendFileSync(p, JSON.stringify(o) + "\n"); } catch { /* best effort */ } };
const r6 = (v) => Math.round(v * 1e6) / 1e6;

export const FLEET_GRID_ORDER_TRACE = "1a113f67a0ed4be9";
/* R235 · gen-2 activation — operator approval (trace 1a1141de0f148829):
 * "כן אני מאשר תפעיל" — custody re-proven 3/3 from the git vault (chain 4/4 +
 * vault-file cross 4/4) AFTER the fleet-grid-first precondition was met (the
 * army already grids, 50 live orders). NO new accounts — hcsoldier4/5/6 exist
 * on-chain since 2026-10-04 with recovery anchor headcorner. */
export const GEN2_ORDER_TRACE = "1a1141de0f148829";
export const GEN2_ACCOUNTS = ["hcsoldier4", "hcsoldier5", "hcsoldier6"];

/* ── conf ─────────────────────────────────────────────────────────────────── */
export const FLEET_GRID_DEFAULTS = {
  enabled: true,
  accounts: ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"],
  fundEach: 1.0,          // STEEM per account, ONE-TIME (operator-scoped funding)
  minLevel: 0.2,          // per-level dust-break for micro-budgets (soldier-law value)
  levels: 5,              // asks per account (bids appear when SBD accrues)
  reserveSteem: 0.01,     // dust kept out of the ladder
  rcMinPct: 12,           // skip the account below this RC%
  maxOpsPerCyclePerAcct: 6,
  orderTtlSec: 3600,
  rebalanceDriftBps: 25,  // rebalance when the live front drifted this far from parity
  tickMs: 180000,         // 3 min — the army breathes slowly (RC-gentle)
  idBase: 2340000000,     // orderid namespace (unique vs master 2100xxx and T-12)
};

export function fleetGridConf() {
  const c = armedConf()?.fleetGrid ?? {};
  return { ...FLEET_GRID_DEFAULTS, ...c, accounts: Array.isArray(c.accounts) && c.accounts.length ? c.accounts : FLEET_GRID_DEFAULTS.accounts };
}

/* ── pure helpers (selftest vectors) ──────────────────────────────────────── */

/** funding plan: idempotent, operator-gated, allowlist-scoped. Garbage-tolerant. */
export function fleetFundPlan({ funded = {}, balances = {}, conf = fleetGridConf(), allowFleetGridFund = false, allowlist = [] } = {}) {
  if (allowFleetGridFund !== true) return { ok: false, verdict: "FUND-OPERATOR-GATED", reason: "operator.allowFleetGridFund !== true", transfers: [] };
  const out = [];
  for (const name of Array.isArray(conf.accounts) ? conf.accounts : []) {
    if (!Array.isArray(allowlist) || !allowlist.includes(name)) continue; // scoped path only
    if (funded?.[name]?.txid) continue;                                    // already funded with evidence
    const steem = Number(balances?.[name]);
    if (Number.isFinite(steem) && steem >= conf.fundEach * 0.9) continue;  // history-funded (state lost) — no double spend
    out.push({ name, amount: r6(conf.fundEach) });
  }
  if (!out.length) return { ok: true, verdict: "ALL-FUNDED-OR-NONE-NEEDED", transfers: [] };
  return { ok: true, verdict: "PLAN", transfers: out };
}

/** rebalance decision for a micro-grid: deploy | rebalance | hold (pure). */
export function fleetDiffDecision({ live = [], parity, driftBps = FLEET_GRID_DEFAULTS.rebalanceDriftBps, bidBudgetSbd = 0, minLevel = FLEET_GRID_DEFAULTS.minLevel } = {}) {
  if (!(parity > 0)) return { action: "hold", reason: "no-parity" };
  if (!live.length) return { action: "deploy", reason: "no-live-orders" };
  const asks = live.filter((o) => o.side === "ask");
  const bids = live.filter((o) => o.side === "bid");
  if (!asks.length) return { action: "deploy", reason: "no-asks-live" };
  if (!bids.length && bidBudgetSbd >= minLevel) return { action: "deploy", reason: "bids-empty-with-sbd" };
  const front = asks.reduce((a, b) => (b.unit < a.unit ? b : a));
  const drift = Math.abs(front.unit - parity) / parity;
  if (drift * 10000 > driftBps) return { action: "rebalance", reason: `drift ${(drift * 10000).toFixed(1)}bps > ${driftBps}bps` };
  return { action: "hold", reason: "in-band" };
}

/** deterministic order-id namespace (pure). */
export function fleetOrderIds({ idBase = FLEET_GRID_DEFAULTS.idBase, slot = 1, seq = 0, count = 1 } = {}) {
  const ids = [];
  for (let i = 0; i < Math.max(1, count); i++) ids.push(idBase + slot * 1000 + ((seq + i) % 1000));
  return ids;
}

/* ── state ────────────────────────────────────────────────────────────────── */
function loadState() {
  return readJson(GRID_FILE, { startedAt: null, runs: 0, parity: null, funded: {}, accounts: {}, lastTickAt: null, lastFundTxid: null, fundingVerdict: null });
}
function saveState(s) { writeJson(GRID_FILE, s); }

export function fleetGridState() {
  const s = loadState();
  const conf = fleetGridConf();
  return {
    ok: true,
    orderTrace: FLEET_GRID_ORDER_TRACE,
    law: "fleet-grid-first: הצי-הקיים גורד קודם — אפס חשבונות-חדשים לפני זה (הוראת-מפעיל R234)",
    enabled: conf.enabled,
    running: !!G.__saosFleetGridTimer,
    tickMs: conf.tickMs,
    startedAt: s.startedAt,
    lastTickAt: s.lastTickAt,
    runs: s.runs,
    parity: s.parity,
    funding: { verdict: s.fundingVerdict, txid: s.lastFundTxid, funded: s.funded },
    accounts: s.accounts,
    conf: { fundEach: conf.fundEach, minLevel: conf.minLevel, levels: conf.levels, rcMinPct: conf.rcMinPct, rebalanceDriftBps: conf.rebalanceDriftBps },
  };
}

/* ── one tick: fund once, then grid every account (fail-isolated) ─────────── */
export async function runFleetGridOnce({ fund = true, grid = true, now = new Date() } = {}) {
  const conf = fleetGridConf();
  const master = masterAccount();
  const st = loadState();
  if (!st.startedAt) st.startedAt = now.toISOString();
  st.runs += 1;
  st.lastTickAt = now.toISOString();

  if (execPaused()) { st.fundingVerdict = st.fundingVerdict ?? null; saveState({ ...st, note: "OPERATOR-PAUSED" }); return fleetGridState(); }
  if (conf.enabled !== true) { saveState({ ...st, note: "DISABLED" }); return fleetGridState(); }

  const par = await externalParity();
  st.parity = par?.parity ?? null;

  /* 1 · funding (one batched tx, once ever, allowlist-scoped) */
  if (fund) {
    const armed = armedConf();
    const balances = {};
    const probes = await Promise.all(conf.accounts.map((n) => accountState(n).catch(() => null)));
    conf.accounts.forEach((n, i) => { balances[n] = probes[i]?.steem ?? null; });
    const plan = fleetFundPlan({
      funded: st.funded, balances, conf,
      allowFleetGridFund: armed?.operator?.allowFleetGridFund === true,
      allowlist: armed?.policy?.transferAllowlist ?? [],
    });
    st.fundingVerdict = plan.verdict;
    if (plan.ok && plan.transfers.length) {
      const ops = plan.transfers.map((t) => {
        const isGen2 = GEN2_ACCOUNTS.includes(t.name);
        const memo = isGen2
          ? `R235 gen-2 activation · operator approval trace ${GEN2_ORDER_TRACE} ("כן אני מאשר תפעיל") · custody git-vault 4/4+4/4 · fleet-grid-first precondition met (R234)`
          : `R234 fleet-grid funding · operator trace ${FLEET_GRID_ORDER_TRACE} (fleet-grid-first: existing accounts before any new ones)`;
        return ["transfer", { from: master, to: t.name, amount: `${t.amount.toFixed(3)} STEEM`, memo }];
      });
      const res = await executeAs(master, ops, { tag: "fleet-grid-fund" });
      st.fundingVerdict = res.ok ? "BROADCAST" : `FAIL(${res.error ?? res.verdict})`;
      if (res.ok) {
        st.lastFundTxid = res.txid ?? null;
        for (const t of plan.transfers) st.funded[t.name] = { txid: res.txid ?? null, amount: t.amount, at: now.toISOString(), gen2: GEN2_ACCOUNTS.includes(t.name) };
        appendLine(EVENTS_FILE, { type: "fleet-grid.funded", at: now.toISOString(), txid: res.txid ?? null, accounts: plan.transfers.map((t) => t.name), each: conf.fundEach, gen2: plan.transfers.filter((t) => GEN2_ACCOUNTS.includes(t.name)).map((t) => t.name), gen2Trace: GEN2_ORDER_TRACE });
      }
      st.lastFundError = res.ok ? null : (res.error ?? res.verdict ?? null);
    }
  }

  /* 2 · per-account micro-grid (fail-isolated) */
  if (grid) {
    for (let i = 0; i < conf.accounts.length; i++) {
      const name = conf.accounts[i];
      const rec = st.accounts[name] ?? { slot: i + 1, seq: 0, runs: 0, lastVerdict: null, lastAt: null, live: 0, txid: null };
      try {
        rec.runs += 1; rec.lastAt = now.toISOString();
        if (custodyOf(name) !== "verified") {
          // R234 self-proof: the engine verifies the account against the CHAIN on
          // first need (same law as the master's boot verify — custody is proven,
          // never assumed). Failure = honest typed bail for this tick.
          const v = await verifyRoles(name).catch(() => null);
          if (!v?.ok) { rec.lastVerdict = `NO-CUSTODY(${v?.verdict ?? v?.reason ?? "verify-fail"})`; st.accounts[name] = rec; continue; }
        }
        const [acc, oo] = await Promise.all([accountState(name).catch(() => null), openOrders(name).catch(() => null)]);
        if (!acc?.ok) { rec.lastVerdict = "MEASURE-FAIL"; st.accounts[name] = rec; continue; }
        rec.rcPct = acc.rcPct; rec.steem = acc.steem; rec.sbd = acc.sbd;
        if ((acc.rcPct ?? 0) < conf.rcMinPct) { rec.lastVerdict = `RC-FLOOR(${acc.rcPct ?? "?"}%)`; st.accounts[name] = rec; continue; }
        const askBudget = r6(Math.max(0, (acc.steem ?? 0) - conf.reserveSteem));
        const sbdRaw = r6(Math.max(0, (acc.sbd ?? 0)));
        const bidBudget = sbdRaw >= conf.minLevel ? sbdRaw : 0; // dust SBD never blocks the plan — it waits until it grows
        if (askBudget < conf.minLevel && bidBudget < conf.minLevel) { rec.lastVerdict = "NO-INVENTORY"; rec.live = oo?.orders?.length ?? 0; st.accounts[name] = rec; continue; }
        const live = oo?.ok ? oo.orders : [];
        rec.live = live.length;
        const dec = fleetDiffDecision({ live, parity: st.parity, driftBps: conf.rebalanceDriftBps, bidBudgetSbd: bidBudget, minLevel: conf.minLevel });
        rec.decision = dec.action; rec.reason = dec.reason;
        if (dec.action === "hold") { rec.lastVerdict = "NO-CHANGE"; st.accounts[name] = rec; continue; }

        const plan = planLadder({
          parity: st.parity,
          askBudgetSteem: askBudget,
          bidBudgetSbd: bidBudget,
          minLevel: conf.minLevel,
          levels: conf.levels,
          flowTranchePct: 0, flowLevels: 0, // value-ladder ONLY — no flow tranche on micro-budgets
          bestAsk: null, bestBid: null,
          now: now.toISOString(),
        });
        if (plan.blocker) { rec.lastVerdict = `PLAN-BLOCKED(${plan.blocker.join("|")})`; st.accounts[name] = rec; continue; }

        const tSec = Math.floor(now.getTime() / 1000);
        const ops = [];
        if (dec.action === "rebalance" && live.length) ops.push(...live.map((o) => ["limit_order_cancel", { owner: name, orderid: Number(o.orderid) }]));
        const lvls = [...(plan.asks ?? []), ...(plan.bids ?? [])].slice(0, conf.maxOpsPerCyclePerAcct);
        const ids = fleetOrderIds({ idBase: conf.idBase, slot: rec.slot, seq: rec.seq, count: lvls.length });
        rec.seq = (rec.seq + lvls.length) % 1000;
        lvls.forEach((lvl, k) => {
          if (lvl.side === "ask") ops.push(["limit_order_create", { owner: name, orderid: ids[k], amount_to_sell: `${Number(lvl.amountSteem).toFixed(3)} STEEM`, min_to_receive: `${r6(Number(lvl.amountSteem) * lvl.unit).toFixed(3)} SBD`, fill_or_kill: false, expiration: tSec + conf.orderTtlSec }]);
          else ops.push(["limit_order_create", { owner: name, orderid: ids[k], amount_to_sell: `${Number(lvl.amountSbd).toFixed(3)} SBD`, min_to_receive: `${r6(Number(lvl.amountSbd) / lvl.unit).toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSec + conf.orderTtlSec }]);
        });
        if (!ops.length) { rec.lastVerdict = "NO-OPS"; st.accounts[name] = rec; continue; }
        const res = await executeAs(name, ops, { tag: "fleet-grid", rcPct: acc.rcPct });
        rec.lastVerdict = res.ok ? `BROADCAST(${res.ops}ops)` : `FAIL(${res.error ?? res.verdict})`;
        rec.txid = res.txid ?? rec.txid;
        if (res.ok) appendLine(EVENTS_FILE, { type: "fleet-grid.ladder", at: now.toISOString(), account: name, ops: res.ops, txid: res.txid ?? null, decision: dec.action });
      } catch (e) {
        rec.lastVerdict = `ERROR(${String(e?.message ?? e).slice(0, 80)})`;
      }
      st.accounts[name] = rec;
    }
  }

  saveState(st);
  return fleetGridState();
}

/* ── boot ─────────────────────────────────────────────────────────────────── */
export function startFleetGrid() {
  if (G.__saosFleetGridTimer) clearInterval(G.__saosFleetGridTimer);
  const conf = fleetGridConf();
  if (conf.enabled !== true) { G.__saosFleetGridTimer = null; return fleetGridState(); }
  // first tick 45s after boot (let the master rails settle), then every tickMs
  G.__saosFleetGridFirst = setTimeout(() => {
    runFleetGridOnce({}).catch((e) => appendLine(EVENTS_FILE, { type: "fleet-grid.error", at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 120) }));
  }, 45000);
  G.__saosFleetGridTimer = setInterval(() => { runFleetGridOnce({}).catch(() => {}); }, conf.tickMs);
  appendLine(EVENTS_FILE, { type: "fleet-grid.boot", at: new Date().toISOString(), tickMs: conf.tickMs, accounts: conf.accounts.length, orderTrace: FLEET_GRID_ORDER_TRACE });
  return fleetGridState();
}
