/**
 * hive-rc-live — Task 26-c: LIVE HIVE RC measurement (replaces the stale env
 * HIVE_RC_PCT as the primary source; env stays as fail-closed fallback).
 * Read-only public RPC (rc_api.find_rc_accounts), 10-minute cache.
 * Never throws — returns null on failure (callers fall back honestly).
 * Roast 51: candidate rotation — one 429/403 host must not fake "RC
 * unmeasurable" while the chain is fine (the Task-50 ETH doctrine applied
 * to the HIVE RC read). All candidates live-verified 2026-09-10, fresh heads.
 */

const CACHE_TTL_MS = 10 * 60_000;
const ACCOUNT = process.env.HIVE_ANCHOR_ACCOUNT ?? "headcorner";

const HIVE_RC_CANDIDATES: string[] = [
  ...(process.env.HIVE_RPC_URL ? [process.env.HIVE_RPC_URL] : []),
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://api.openhive.network"
];

export interface HiveRcLive {
  account: string;
  rcPct: number;
  mana: number;
  maxRc: number;
  at: string;
}

let cache: { at: number; value: HiveRcLive } | null = null;

async function readOnce(url: string): Promise<HiveRcLive | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "rc_api.find_rc_accounts", params: { accounts: [ACCOUNT] }, id: 1 }),
      signal: ctl.signal
    });
    clearTimeout(t);
    if (!res.ok) return null; // hostile host (403/429) — rotate to the next candidate
    const json = (await res.json()) as {
      result?: { rc_accounts: { account: string; rc_manabar: { current_mana: number; last_update_time: number }; max_rc: string | number }[] };
      error?: { message?: string };
    };
    const row = json.result?.rc_accounts?.[0];
    if (!row) return null;
    const mx = Number(row.max_rc) || 0;
    const stored = Number(row.rc_manabar.current_mana) || 0;
    const nowSec = Math.floor(Date.now() / 1000);
    const regen = Math.floor(((nowSec - Number(row.rc_manabar.last_update_time)) * mx) / (5 * 86400));
    const mana = Math.min(mx, stored + regen);
    return {
      account: row.account,
      rcPct: mx ? Math.round((mana / mx) * 100000) / 1000 : 0,
      mana,
      maxRc: mx,
      at: new Date().toISOString()
    };
  } catch {
    return null; // transport failure — rotate
  }
}

export async function hiveRcLive(): Promise<HiveRcLive | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  for (const url of HIVE_RC_CANDIDATES) {
    const value = await readOnce(url);
    if (value) {
      cache = { at: Date.now(), value };
      return value;
    }
  }
  return cache?.value ?? null; // every candidate failed — stale cache or honest null
}
