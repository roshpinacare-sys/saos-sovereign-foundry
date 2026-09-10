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
  /** true only when the status file was written by a live daemon recently (≤ FRESH_MAX_MIN) — stale files are EVIDENCE, not schedules */
  isFresh: boolean;
  /**
   * Task 62: does a pending HIVE weave SignRequest ACTUALLY exist (the daemon's
   * own verdict this cycle)? Readiness (an open RC window) is a necessary
   * condition, NOT a schedule — the fresh-file era still lied by composing
   * "מתוזמן בעוד ~X דק'" from best.etaMin while the daemon's own note said
   * "no pending HIVE weave SignRequest found — nothing to execute".
   * null = legacy file without the flag (the note heuristic decides).
   */
  pendingWeave: boolean | null;
  /** honest schedule claim: a live daemon AND a pending weave both verified */
  scheduled: boolean;
}

/** Roast 2026-09-10: the daemon was dead ~4.7h while the UI kept promising
 * "עוגן-צי מתוזמן" from a frozen file. A status file older than this is
 * treated as NO scheduled window — honest gates only. */
export const FLEET_STATUS_FRESH_MAX_MIN = 15;

let cache: { at: number; value: FleetCureStatus } | null = null;

export function fleetCureStatus(): FleetCureStatus {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const empty: FleetCureStatus = { updatedAt: null, lastTxid: null, recordedAt: null, note: null, best: null, accounts: [], fileAgeMin: null, isFresh: false, pendingWeave: null, scheduled: false };
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
    // Task 62: the machine flag wins. roast 63 tightened the legacy fallback:
    // the old default treated ANY note that didn't start "no pending|sig=" as
    // pendingWeave=true — arbitrary text ("probe failed", "starting up…") would
    // have resurrected the "מתוזמן" screen-lie. Now: only an explicit positive
    // signal (a live sig reference) schedules; explicit stop pages deny; and
    // UNKNOWN text ⇒ null (never scheduled, honestly "not known").
    const rawFlag = (j as { pendingWeave?: unknown }).pendingWeave;
    const noteText = j.note?.trim() ?? "";
    const pendingWeave: boolean | null =
      typeof rawFlag === "boolean"
        ? rawFlag
        : /no pending|nothing to execute/i.test(noteText)
          ? false
          : /sig-[a-z0-9]/i.test(noteText)
            ? true
            : null;
    const isFresh = ageMin <= FLEET_STATUS_FRESH_MAX_MIN;
    const value: FleetCureStatus = {
      updatedAt: j.updatedAt ?? null,
      lastTxid: j.lastTxid ?? null,
      recordedAt: j.recordedAt ?? null,
      note: j.note ?? null,
      best: waiting ? { account: waiting.account, etaMin: waiting.etaToWindowMin as number, mana: waiting.mana } : null,
      accounts,
      fileAgeMin: ageMin,
      isFresh,
      pendingWeave,
      scheduled: isFresh && pendingWeave === true
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    cache = { at: Date.now(), value: empty };
    return empty;
  }
}
