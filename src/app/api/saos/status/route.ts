import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUDIT = "/home/z/audit";
const PATHS = {
  state: `${AUDIT}/saos-dex/grids/state/state.json`,
  pnl: `${AUDIT}/saos-dex/grids/state/pnl.json`,
  offer: `${AUDIT}/saos-dex/grids/state/offer.json`,
  moverLog: `${AUDIT}/saos-dex/grids/state/mover-log.jsonl`,
  dailyReport: `${AUDIT}/saos-dex/grids/state/daily-report.json`,
  convertPlan: `${AUDIT}/saos-dex/grids/state/convert-plan.json`,
  convertLog: `${AUDIT}/saos-dex/grids/state/convert-log.jsonl`,
  kpi: `${AUDIT}/Defi/fleet/KPI.json`,
  claims: `${AUDIT}/Defi/fleet/CLAIMS.md`,
};
const CACHE_TTL_MS = 45_000;
let cache: { at: number; data: unknown } | null = null;

async function readJsonSafe(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readMoverTail(path: string, n = 4): Promise<unknown[]> {
  try {
    const raw = await readFile(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-n).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { unparsed: l.slice(0, 120) };
      }
    });
  } catch {
    return [];
  }
}

function countClaims(md: string) {
  const rows = md.split("\n").filter((l) => /^\| [A-Z]-/.test(l));
  let done = 0, open = 0, other = 0;
  for (const r of rows) {
    if (/\*\*DONE\*\*/.test(r)) done++;
    else if (/\bOPEN\b/.test(r)) open++;
    else other++;
  }
  return { rows: rows.length, done, open, other };
}

async function rpc<T>(method: string, params: unknown): Promise<T | null> {
  for (const node of ["https://api.steemit.com", "https://api.justyy.com"]) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) continue;
      return d.result as T;
    } catch {
      /* try next node */
    }
  }
  return null;
}

const NAI: Record<string, string> = { "@@000000013": "SBD", "@@000000021": "STEEM" };

/* ── A-10 מד-רווחיות: יסוד-עלות-ממוצע על מילויים-אמת (מראה grids/observe.mjs) ──
   כנות: מכירה-בלי-יסוד-נמדד = unbased (לא רווח). מחשב-חי מהשרשרת בכל-בקשה. */
type Fill = { seq: number; side: "ask" | "bid"; steem: number; sbd: number };

function pnlFromFills(fills: Fill[]) {
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  let position = 0, cost = 0, realized = 0, unbasedSbd = 0, unbased = 0;
  let bought = 0, spent = 0, sold = 0, proceeds = 0, buys = 0, sells = 0;
  for (const f of fills) {
    if (f.side === "bid") {
      buys++; bought = r6(bought + f.steem); spent = r6(spent + f.sbd);
      position = r6(position + f.steem); cost = r6(cost + f.sbd);
    } else {
      sells++; sold = r6(sold + f.steem); proceeds = r6(proceeds + f.sbd);
      if (position > 1e-9) {
        const based = Math.min(f.steem, position);
        const avg = cost / position;
        realized = r6(realized + f.sbd * (based / f.steem) - avg * based);
        const rest = r6(f.steem - based);
        cost = r6(cost - avg * based); position = r6(position - based);
        if (rest > 1e-9) { unbased = r6(unbased + rest); unbasedSbd = r6(unbasedSbd + f.sbd * (rest / f.steem)); }
      } else {
        unbased = r6(unbased + f.steem); unbasedSbd = r6(unbasedSbd + f.sbd);
      }
    }
  }
  return {
    fills: fills.length, buys, sells,
    boughtSteem: bought, spentSbd: spent,
    soldSteem: sold, proceedsSbd: proceeds,
    realizedSbd: realized,
    unbasedSteem: unbased, unbasedSbd: unbasedSbd,
    positionSteem: position, positionCostSbd: cost,
    positionAvgCost: position > 1e-9 ? Math.round((cost / position) * 1e6) / 1e6 : null,
  };
}

async function liveFills(): Promise<Fill[]> {
  /* אותו-סולם-צמתים של observe.mjs (A-9): boylikegirl ראשון — מאפשר 400;
   * steemit.com מוגבל ל-100 גם ב-account_history_api. חלון-זהה = מדידה-זהה. */
  const nodes = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
  let hist: [number, { op?: unknown; timestamp?: string }][] = [];
  for (const node of nodes) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "account_history_api.get_account_history", params: { account: "headcorner", start: -1, limit: 400 }, id: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) continue;
      hist = d.result?.history ?? [];
      if (hist.length > 0) break;
    } catch {
      /* try next node */
    }
  }
  if (hist.length === 0) {
    for (const node of nodes) {
      try {
        const r = await fetch(node, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_account_history", params: ["headcorner", -1, 100], id: 1 }),
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) continue;
        const d = await r.json();
        if (d.error) continue;
        hist = d.result ?? [];
        if (hist.length > 0) break;
      } catch {
        /* try next node */
      }
    }
  }
  const dbg = { histLen: hist.length, parseErr: "" };
  const out: Fill[] = [];
  try {
  const amt = (x: unknown): { v: number; sym: string } | null => {
    /* צורת-string "0.284 STEEM" (condenser) · צורת-NAI {amount,nai,precision} (account_history_api) */
    if (typeof x === "string") {
      const [v, sym] = x.split(" ");
      return sym && Number(v) > 0 ? { v: Number(v), sym } : null;
    }
    const o = x as { amount?: string; nai?: string; precision?: number } | null;
    if (o?.amount != null && o?.nai) {
      const v = Number(o.amount) / 10 ** (o.precision ?? 3);
      const sym = NAI[o.nai] ?? o.nai;
      return v > 0 ? { v, sym } : null;
    }
    return null;
  };
  for (const [, x] of hist ?? []) {
    /* condenser מחזיר op כמערך ["fill_order", {…}] · account_history_api כ-{type,value} — שניהם */
    const rawOp = (x as { op?: unknown })?.op;
    const op = Array.isArray(rawOp) ? { type: rawOp[0], value: rawOp[1] } : (rawOp ?? {}) as { type?: string; value?: Record<string, unknown> };
    const v = op.value ?? {};
    if (op.type !== "fill_order_operation" && op.type !== "fill_order") continue;
    const cur = amt(v.current_pays), opn = amt(v.open_pays);
    if (!cur || !opn) continue;
    const isCur = v.current_owner === "headcorner";
    const mine = isCur ? cur : opn, theirs = isCur ? opn : cur;
    if (mine.sym === "STEEM" && theirs.sym === "SBD") out.push({ seq: 0, side: "ask", steem: mine.v, sbd: theirs.v });
    else if (mine.sym === "SBD" && theirs.sym === "STEEM") out.push({ seq: 0, side: "bid", steem: theirs.v, sbd: mine.v });
  }
  } catch (e) { dbg.parseErr = String((e as Error)?.message ?? e).slice(0, 120); }
  (globalThis as Record<string, unknown>).__liveFillsDbg = dbg;
  return out;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  const [state, pnl, offer, kpi, claimsMd, moverTail, ordersRaw, rcRaw, accRaw, fills, dailyReport, convertPlan, convertLog] = await Promise.all([
    readJsonSafe(PATHS.state),
    readJsonSafe(PATHS.pnl),
    readJsonSafe(PATHS.offer),
    readJsonSafe(PATHS.kpi),
    readFile(PATHS.claims, "utf8").catch(() => ""),
    readMoverTail(PATHS.moverLog, 6),
    rpc<Record<string, unknown>>("condenser_api.get_open_orders", ["headcorner"]).then((r) => r as Record<string, unknown>[] | null),
    rcFromRcApi(),
    rpc<Record<string, string>[]>("condenser_api.get_accounts", [["headcorner"]]),
    liveFills(),
    readJsonSafe(PATHS.dailyReport),
    readJsonSafe(PATHS.convertPlan),
    readMoverTail(PATHS.convertLog, 3),
  ]);

  const orders = (ordersRaw ?? []).map((o) => {
    const sp = o.sell_price as { base: string; quote: string } | undefined;
    const base = sp?.base ?? "?";
    const side = base.includes("STEEM") ? "ask" : "bid";
    const [bAmt, bSym] = base.split(" ");
    const [qAmt, qSym] = (sp?.quote ?? "? ?").split(" ");
    const unit = Number(bAmt) > 0 ? Number(qAmt) / Number(bAmt) : 0;
    return {
      orderid: o.orderid,
      side,
      base: `${bAmt} ${bSym}`,
      quote: `${qAmt} ${qSym}`,
      unit: Math.round(unit * 1e6) / 1e6,
      created: o.created,
    };
  });

  const a = accRaw?.[0];
  const balances = a
    ? { steem: a.balance ?? null, sbd: a.sbd_balance ?? null, vests: a.vesting_shares ?? null }
    : null;
  const rc = rcRaw ? { rcPct: rcRaw } : null;

  const orderTotals = orders.reduce(
    (acc, o) => {
      const amt = Number(String(o.base).split(" ")[0]) || 0;
      if (o.side === "ask") acc.askedSteem = Math.round((acc.askedSteem + amt) * 1e3) / 1e3;
      else acc.bidSbd = Math.round((acc.bidSbd + amt) * 1e3) / 1e3;
      return acc;
    },
    { askedSteem: 0, bidSbd: 0 }
  );
  const parityRef = (offer as { fair?: { externalParity?: number } } | null)?.fair?.externalParity ?? null;
  const p = pnlFromFills(fills);
  /* T-7: יסוד-מהחלון-העמוק (daily-cycle, window 2000) — כשהוא קיים הוא האמת-המלאה;
   * החישוב-המקומי (חלון 400) נשאר כתצוגת-עצמאות ולאימות-צליבה. */
  const deepPnl = (pnl as { realPnl?: { realizedSbd?: number; positionSteem?: number; positionCostSbd?: number; openAvgCost?: number | null; unbasedSteem?: number; unbasedSbd?: number; basisSeededSteem?: number } } | null)?.realPnl ?? null;
  const profit = {
    ...p,
    parityRef,
    unrealizedAtParitySbd:
      p.positionSteem > 1e-9 && parityRef
        ? Math.round((p.positionSteem * parityRef - p.positionCostSbd) * 1e6) / 1e6
        : null,
    deepPnl,
    method: "יסוד-עלות-ממוצע על fill_order חי (A-10) · מכירה-בלי-יסוד = unbased, לא רווח · deepPnl = יסוד מהחלון-העמוק 2000 (T-7)",
  };

  /* ── T-7 מסילות-מהקיים: מה זורם, מה מוכן, מה חסום — הכל מדידה ── */
  const kpiObj = kpi as { revenuePerDayReal?: { usd?: number; breakdown?: { fuelEngineUsdPerDay?: number; missionBookUsdPerDay?: number } } } | null;
  const daily = dailyReport as { ok?: boolean; startedAt?: string; finishedAt?: string; steps?: Record<string, { ok?: boolean; skipped?: boolean; verdict?: string; planned?: number; executed?: number; reason?: string }> } | null;
  const convertArb = (offer as { marks?: { convertArb?: { verdict?: string; marketUsd?: number; discountPct?: number } } } | null)?.marks?.convertArb ?? null;
  /* T-8 · D-023: מסילת-ההמרה — תוכנית-אחרונה + קציר-מבוצע-חיים */
  const cp = convertPlan as { verdict?: string; amountSbd?: number; discountBps?: number; gates?: string[]; at?: string; expectedSteem?: number | null; evidence?: { at?: string; mode?: string; note?: string | null; txids?: { txid?: string; amount?: string; requestid?: number }[] } | null } | null;
  const rails = {
    fuel: kpiObj?.revenuePerDayReal?.breakdown?.fuelEngineUsdPerDay ?? null,
    book: kpiObj?.revenuePerDayReal?.breakdown?.missionBookUsdPerDay ?? null,
    deployedSteem: orderTotals.askedSteem,
    bidSbd: orderTotals.bidSbd,
    convertArb,
    convert: cp
      ? {
          verdict: cp.verdict ?? null,
          amountSbd: cp.amountSbd ?? 0,
          discountBps: cp.discountBps ?? null,
          expectedSteem: cp.expectedSteem ?? null,
          plannedAt: cp.evidence?.at ?? cp.at ?? null,
          executedLifetime: convertLog.length,
          lastConvert: convertLog[convertLog.length - 1] ?? null,
          gates: cp.gates ?? [],
          note: cp.evidence?.note ?? null,
        }
      : { status: "convert rail not yet run (D-023 armed on next daily cycle)" },
    curation: daily?.steps?.curate
      ? { planned: daily.steps.curate.planned ?? null, executed: daily.steps.curate.executed ?? 0, status: daily.steps.curate.skipped ? "planned-awaiting-posting-wif (A-12 · Domain wiring)" : "executing" }
      : { planned: null, executed: 0, status: "daily-cycle not yet run in cockpit view" },
    autonomy: daily ? { ok: daily.ok ?? false, lastCycle: daily.finishedAt ?? daily.startedAt ?? null, steps: Object.fromEntries(Object.entries(daily.steps ?? {}).map(([k, v]) => [k, v.ok === false ? "fail" : v.skipped ? "skip" : "ok"])) } : null,
    note: "קיורציה/המרה/פריסה נבנו-מהקיים (T-7/T-8 · D-023 חי) — אפס-הון-חוץ; המדידה-החיה בקובץ-הדוח וב-offer.json",
  };

  const data = {
    ok: true,
    asof: new Date().toISOString(),
    account: "headcorner",
    grid: state,
    pnl,
    offer,
    live: { orders, orderTotals, balances, rc, chainReadOk: orders.length > 0 || balances !== null },
    profit,
    rails,
    daily,
    kpi,
    fleet: { claims: countClaims(claimsMd) },
    mover: { tail: moverTail },
    debugFills: (globalThis as Record<string, unknown>).__liveFillsDbg,
    sources: PATHS,
    notes: [
      "אמת-מוטבעת-על-שרשרת בלבד — real.fills נמדד מ-fill_order חי",
      "אפס-מפתחות בשירות-זה: קריאת-קבצים-פומביים + RPC ציבורי בלבד",
    ],
  };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}

async function rcFromRcApi(): Promise<number | null> {
  const r = await rpc<{ rc_accounts?: { rc_manabar: { current_mana: string }; max_rc: string }[] }>(
    "rc_api.find_rc_accounts",
    { accounts: ["headcorner"] }
  );
  const rc = r?.rc_accounts?.[0];
  if (!rc) return null;
  const cur = parseInt(rc.rc_manabar?.current_mana ?? "0", 10);
  const max = parseInt(rc.max_rc ?? "0", 10);
  return max > 0 ? Math.round((cur / max) * 1000) / 10 : null;
}
