/**
 * hive-rc-live — Task 26-c: LIVE HIVE RC measurement (replaces the stale env
 * HIVE_RC_PCT as the primary source; env stays as fail-closed fallback).
 * Read-only public RPC (rc_api.find_rc_accounts), 10-minute cache.
 * Never throws — returns null on failure (callers fall back honestly).
 */

const NODE = process.env.HIVE_RPC_URL ?? "https://api.hive.blog";
const CACHE_TTL_MS = 10 * 60_000;
const ACCOUNT = process.env.HIVE_ANCHOR_ACCOUNT ?? "headcorner";

export interface HiveRcLive {
  account: string;
  rcPct: number;
  mana: number;
  maxRc: number;
  at: string;
}

let cache: { at: number; value: HiveRcLive } | null = null;

export async function hiveRcLive(): Promise<HiveRcLive | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(NODE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "rc_api.find_rc_accounts", params: { accounts: [ACCOUNT] }, id: 1 }),
      signal: ctl.signal
    });
    clearTimeout(t);
    const json = (await res.json()) as {
      result?: { rc_accounts: { account: string; rc_manabar: { current_mana: number; last_update_time: number }; max_rc: string | number }[] };
      error?: { message?: string };
    };
    const row = json.result?.rc_accounts?.[0];
    if (!row) return cache?.value ?? null;
    const mx = Number(row.max_rc) || 0;
    const stored = Number(row.rc_manabar.current_mana) || 0;
    const nowSec = Math.floor(Date.now() / 1000);
    const regen = Math.floor(((nowSec - Number(row.rc_manabar.last_update_time)) * mx) / (5 * 86400));
    const mana = Math.min(mx, stored + regen);
    const value: HiveRcLive = {
      account: row.account,
      rcPct: mx ? Math.round((mana / mx) * 100000) / 1000 : 0,
      mana,
      maxRc: mx,
      at: new Date().toISOString()
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? null;
  }
}
