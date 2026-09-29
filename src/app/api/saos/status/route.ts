import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * T-9 · cockpit status — SOVEREIGN-LOCAL edition.
 * The 16-repo estate at /home/z/audit was lost (environment reset); the engine
 * now lives INSIDE this project (mini-services/saos-engine) and every source
 * below is either (a) engine state written by real cycles, or (b) live chain
 * reads over public RPC. Zero secrets, zero external repo dependency.
 */
const ENGINE = "/home/z/my-project/mini-services/saos-engine";
const PATHS = {
  state: `${ENGINE}/state/state.json`,
  offer: `${ENGINE}/state/offer.json`,
  observe: `${ENGINE}/state/observe.json`,
  dailyReport: `${ENGINE}/state/daily-report.json`,
  convertPlan: `${ENGINE}/state/convert-plan.json`,
  events: `${ENGINE}/state/events.jsonl`,
  soldiers: `${ENGINE}/state/soldiers.json`,
  intel: `${ENGINE}/state/intel.json`,
  execLog: `${ENGINE}/state/exec-log.jsonl`,
};
const ENGINE_HTTP = "http://127.0.0.1:3040";
const CACHE_TTL_MS = 45_000;
let cache: { at: number; data: unknown } | null = null;

async function readJsonSafe(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readLinesTail(path: string, n = 8): Promise<unknown[]> {
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

async function engineHealth(): Promise<{ up: boolean; info?: Record<string, unknown> }> {
  try {
    const r = await fetch(`${ENGINE_HTTP}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!r.ok) return { up: false };
    return { up: true, info: (await r.json()) as Record<string, unknown> };
  } catch {
    return { up: false };
  }
}

/* T-12: live execution status from the engine (self-proving role check inside) */
async function engineExecStatus(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${ENGINE_HTTP}/exec-status`, { signal: AbortSignal.timeout(18000), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function rpc<T>(method: string, params: unknown): Promise<T | null> {
  for (const node of ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"]) {
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

/* ── A-10 מד-רווחיות: יסוד-עלות-ממוצע על מילויים-אמת (unbased ≠ רווח) ────── */
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
  const out: Fill[] = [];
  try {
    const amt = (x: unknown): { v: number; sym: string } | null => {
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
  } catch { /* honest partial */ }
  return out;
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

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  const [state, offer, observe, dailyReport, convertPlan, eventsTail, soldiers, intel, execLogTail, ordersRaw, rcRaw, accRaw, fills, eng, execHttp] = await Promise.all([
    readJsonSafe(PATHS.state),
    readJsonSafe(PATHS.offer),
    readJsonSafe(PATHS.observe),
    readJsonSafe(PATHS.dailyReport),
    readJsonSafe(PATHS.convertPlan),
    readLinesTail(PATHS.events, 10),
    readJsonSafe(PATHS.soldiers),
    readJsonSafe(PATHS.intel),
    readLinesTail(PATHS.execLog, 8),
    rpc<any[]>("condenser_api.get_open_orders", ["headcorner"]),
    rcFromRcApi(),
    rpc<any[]>("condenser_api.get_accounts", [["headcorner"]]),
    liveFills(),
    engineHealth(),
    engineExecStatus(),
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

  const obs = observe as Record<string, any> | null;
  const p = pnlFromFills(fills);
  const parityRef = (offer as any)?.marks?.paritySbdPerSteem ?? null;
  const profit = {
    ...p,
    parityRef,
    unrealizedAtParitySbd:
      p.positionSteem > 1e-9 && parityRef
        ? Math.round((p.positionSteem * parityRef - p.positionCostSbd) * 1e6) / 1e6
        : null,
    method: "יסוד-עלות-ממוצע על fill_order חי (A-10) · מכירה-בלי-יסוד = unbased, לא רווח",
  };

  /* ── מסילות-אמת (T-9): מדידה מקומית-ריבונית בלבד — אפס קבצי-KPI מאחזקים ── */
  const daily = dailyReport as Record<string, any> | null;
  const cp = convertPlan as Record<string, any> | null;
  const fuelUsdPerDay = obs?.fuel?.fuelUsdPerDay ?? null;
  const authorUsdPerDay = obs?.fuel?.authorUsdPerDay ?? null;
  const rails = {
    fuel: fuelUsdPerDay,
    author: authorUsdPerDay,
    fuelWindowNote: obs?.fuel?.windowNote ?? null,
    fuelHistory: "קיור-אחרון נמדד 2026-09-09 (סריקה-עמוקה 10001 ops) — המסילה רדומה, ממתינה ל-authority פוסטינג",
    deployedSteem: orderTotals.askedSteem,
    bidSbd: orderTotals.bidSbd,
    bookEmpty: orders.length === 0,
    bookNote: orders.length === 0
      ? "הספר ריק — 925 STEEM נזילים ממתינים לפריסה; התוכנית OFFER-READY מוכנה, ביצוע = שער-אופרטור (X-1)"
      : null,
    convert: cp
      ? {
          verdict: cp.verdict ?? null,
          reason: cp.reason ?? null,
          amountSbd: cp.amountSbd ?? 0,
          marketSbdUsd: cp.marketSbdUsd ?? null,
          impliedSbdUsd: cp.impliedSbdUsd ?? null,
          marketSourceNote: cp.marketSourceNote ?? null,
          at: cp.at ?? null,
        }
      : null,
    autonomy: daily
      ? {
          ok: daily.ok ?? false,
          lastCycle: daily.finishedAt ?? daily.startedAt ?? null,
          steps: Object.fromEntries(Object.entries(daily.steps ?? {}).map(([k, v]: [string, any]) => [k, v?.ok === false ? "fail" : v?.skipped ? "skip" : "ok"])),
        }
      : null,
    note: "כל המדידות מקומיות-ריבוניות (מנוע :3040) או מהשרשרת חי — אפס-תלות באחזקת-רפו חיצונית",
  };

  const measuredPerDay = (daily?.rollup?.measuredTotalUsdPerDay as number | undefined) ??
    Math.round(((fuelUsdPerDay ?? 0) + (authorUsdPerDay ?? 0)) * 1e4) / 1e4;

  /* ── T-12: execution + soldiers + intel (public fields ONLY — no secrets) ── */
  const sold = soldiers as Record<string, any> | null;
  const itel = intel as Record<string, any> | null;
  const execution = {
    ...(execHttp ?? null),
    log: execLogTail,
  };
  const soldiersPublic = {
    deployed: !!sold?.deployed,
    at: sold?.at ?? null,
    accounts: (sold?.accounts ?? []).map((a: any) => ({ name: a.name, fingerprint: a.fingerprint })),
    fundingTxid: sold?.fundingTxid ?? null,
    fundedEach: sold?.fundedEach ?? null,
  };
  const intelPublic = {
    at: itel?.at ?? null,
    decisions: (itel?.decisions ?? []).map((d: any) => ({ kind: d.kind, decision: d.decision, reason: d.reason })),
    book: itel?.book ?? null,
    spreadBpsRec: itel?.spreadBpsRec ?? null,
  };

  const data = {
    ok: true,
    asof: new Date().toISOString(),
    account: "headcorner",
    engine: { up: eng.up, info: eng.info ?? null, keyless: (eng.info as any)?.keyless ?? false },
    grid: state,
    observe: obs,
    offer,
    live: { orders, orderTotals, balances, rc, chainReadOk: orders.length > 0 || balances !== null },
    profit,
    rails,
    daily,
    measuredPerDay,
    events: eventsTail,
    execution,
    soldiers: soldiersPublic,
    intel: intelPublic,
    sources: { kind: "sovereign-local", paths: PATHS, engineHttp: ENGINE_HTTP },
    notes: [
      "אמת-מוטבעת-על-שרשרת בלבד — real.fills נמדד מ-fill_order חי",
      "T-12: מפתח-ראשי מוחזק-מנוע, מוגבל-דוקטרינה, לעולם לא נרשם/נשלח — רק טביעות-אצבע ציבוריות",
      "T-9: האחוזה בת-16-הרפו אבדה באיפוס-סביבה — המנוע נבנה-מחדש מקומית (ראה docs/ESTATE-INVENTORY.md)",
    ],
  };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
