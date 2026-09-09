/**
 * fleet-cure client — Task 26-c: reads the fleet-cure daemon's status file
 * (docs/evidence/fleet-cure-status.json, public data only) with a 60s cache.
 * The daemon (mini-services/fleet-cure :3034) measures fleet HIVE RC mana and
 * auto-executes the pending HIVE weave SignRequest through the external
 * signer at the first broadcast window. The foundry only READS the result —
 * no keys, no broadcast from the foundry process itself.
 */

import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

const STATUS_PATH = path.join(process.cwd(), "docs", "evidence", "fleet-cure-status.json");
const CACHE_TTL_MS = 60_000;

export interface FleetCureAccount {
  account: string;
  mana: number;
  manaPct: number;
  etaToWindowMin: number | null;
  state: "ready" | "waiting" | "done" | "blocked";
  txid?: string;
}

export interface FleetCureStatus {
  updatedAt: string | null;
  lastTxid: string | null;
  recordedAt: string | null;
  note: string | null;
  best: { account: string; etaMin: number; mana: number } | null;
  accounts: FleetCureAccount[];
  fileAgeMin: number | null;
}

let cache: { at: number; value: FleetCureStatus } | null = null;

export function fleetCureStatus(): FleetCureStatus {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const empty: FleetCureStatus = { updatedAt: null, lastTxid: null, recordedAt: null, note: null, best: null, accounts: [], fileAgeMin: null };
  try {
    if (!existsSync(STATUS_PATH)) {
      cache = { at: Date.now(), value: empty };
      return empty;
    }
    const ageMin = Math.round(((Date.now() - statSync(STATUS_PATH).mtimeMs) / 60000) * 10) / 10;
    const j = JSON.parse(readFileSync(STATUS_PATH, "utf8")) as {
      updatedAt?: string;
      lastTxid?: string | null;
      recordedAt?: string | null;
      note?: string | null;
      accounts?: FleetCureAccount[];
    };
    const accounts = Array.isArray(j.accounts) ? j.accounts : [];
    const waiting = accounts
      .filter((a) => typeof a.etaToWindowMin === "number" && a.etaToWindowMin !== null)
      .sort((a, b) => (a.etaToWindowMin ?? Infinity) - (b.etaToWindowMin ?? Infinity))[0];
    const value: FleetCureStatus = {
      updatedAt: j.updatedAt ?? null,
      lastTxid: j.lastTxid ?? null,
      recordedAt: j.recordedAt ?? null,
      note: j.note ?? null,
      best: waiting ? { account: waiting.account, etaMin: waiting.etaToWindowMin as number, mana: waiting.mana } : null,
      accounts,
      fileAgeMin: ageMin
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    cache = { at: Date.now(), value: empty };
    return empty;
  }
}
