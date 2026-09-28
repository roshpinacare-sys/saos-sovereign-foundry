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
        signal: AbortSignal.timeout(9000),
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

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  const [state, pnl, offer, kpi, claimsMd, moverTail, ordersRaw, rcRaw, accRaw] = await Promise.all([
    readJsonSafe(PATHS.state),
    readJsonSafe(PATHS.pnl),
    readJsonSafe(PATHS.offer),
    readJsonSafe(PATHS.kpi),
    readFile(PATHS.claims, "utf8").catch(() => ""),
    readMoverTail(PATHS.moverLog, 4),
    rpc<Record<string, unknown>[]>("condenser_api.get_open_orders", ["headcorner"]),
    rcFromRcApi(),
    rpc<Record<string, string>[]>("condenser_api.get_accounts", [["headcorner"]]),
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

  const data = {
    ok: true,
    asof: new Date().toISOString(),
    account: "headcorner",
    grid: state,
    pnl,
    offer,
    live: { orders, balances, rc, chainReadOk: orders.length > 0 || balances !== null },
    kpi,
    fleet: { claims: countClaims(claimsMd) },
    mover: { tail: moverTail },
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
