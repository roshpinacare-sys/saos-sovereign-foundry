/**
 * fleet-cure (:3034) — Task 26-c.
 * =============================================================================
 * The measured truth (Task 59, 2026-09-10 19:24 UTC — /keys/status + verify-live):
 *   - Envelope: headcorner 12/12 slots (STEEM+HIVE+BLURT × owner/active/posting/memo,
 *     ALL live-verified) + tov 4/4 BLURT slots (resurrected from the owner's
 *     password file — BLURT was never rotated there). 16/16 ok, 0 drift.
 *   - tov STEEM/HIVE remain externally-rotated (SETTLE-10 ROT1 tree, seed lost) —
 *     nothing in-environment signs those two planes for tov (assets negligible:
 *     0.449 STEEM + tiny vesting, measured 2026-09-10).
 *   - Chain-enforced: min delegation 1,611.18 VESTS > any fleet owned vests
 *     ⇒ delegation cure impossible (measured, honest).
 *   - One HIVE weave op costs ~225M RC (measured live: cashmachine refusal).
 *     Fleet mana regenerates at max_rc/5d.
 * THIS SERVICE: every 5 minutes —
 *   1. measures live RC mana of the 9 fleet accounts (public RPC);
 *   2. when an account crosses OP_COST + buffer AND the HIVE weave
 *      SignRequest is still pending → executes it via the external signer
 *      (:3033, authority-gated) using that fleet account's posting key;
 *   3. on success: records the public txid back into the foundry
 *      (PATCH /api/saos/signer — audited) and writes the evidence file;
 *   4. writes docs/evidence/fleet-cure-status.json (public data only:
 *      account names, mana per-mille, ETAs, txids) for the control screen.
 *
 * Safety: no keys here (signer holds them); tokens re-read from ~/.secrets on
 * every use (roast 63 — a rotation can never strand the service); never logged;
 * every failure is logged and retried next cycle; the signer itself refuses
 * anything the chain/authority gates reject.
 */

import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const PORT = Number(process.env.FLEET_CURE_PORT ?? 3034);
const HOME = process.env.HOME ?? "/home/z";
const PROJECT = "/home/z/my-project";
const STATUS_PATH = path.join(PROJECT, "docs", "evidence", "fleet-cure-status.json");
const SIGNER_URL = (process.env.SAOS_EXTERNAL_SIGNER_URL ?? "http://127.0.0.1:3033").replace(/\/$/, "");
const FOUNDRY = process.env.SAOS_FOUNDRY_URL ?? "http://127.0.0.1:3000";
const FLEET = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];
const OP_COST_RC = 230_000_000; // 225M measured live + ~2% buffer
const CYCLE_MS = 5 * 60_000;
// roast 63: a single hardcoded endpoint violated the rotation doctrine
// (roast 51/52: signer nodesFor, live-probes) — one dead RPC = blind RC probes.
// Rotated live-first, matching src/lib/saos/networks/live-probes.ts.
const HIVE_RPCS = ["https://api.hive.blog", "https://api.deathwing.me", "https://any.openhive.network"];
let rpcIdx = 0;
const WEAVE_ID = "saos.weave.v1";
// roast 63: persistent log — the canonical supervisor (instrumentation-node)
// spawns with stdio:"ignore", so console-only evidence vanished. Same
// convention as the other three services (guardian.log/chief.log/signer.log).
const LOG_PATH = path.join(import.meta.dir, "fleet-cure.log");

function readSecret(file: string): string {
  try {
    return readFileSync(path.join(HOME, ".secrets", file), "utf8").trim();
  } catch {
    return "";
  }
}
// roast 63: secrets re-read per use — boot-time capture meant a token rotation
// (which happened in tasks 36/41) left the service 401-ing until a manual
// restart; roast-62 established disk-beats-boot-env as the config truth.
const signerToken = () => readSecret("external-signer-token");
const adminKey = () => readSecret("saos-admin-key");

function log(level: string, msg: string) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  try { console.log(line); } catch {}
  try { appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  // rotation with failover: try the live-first list in order from the current
  // index; a dead endpoint no longer blinds the whole probe cycle.
  let lastErr: unknown = null;
  for (let i = 0; i < HIVE_RPCS.length; i++) {
    const url = HIVE_RPCS[(rpcIdx + i) % HIVE_RPCS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(15_000)
      });
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? "rpc error");
      rpcIdx = (rpcIdx + i) % HIVE_RPCS.length; // stick to the working node
      return j.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all HIVE RPC endpoints failed");
}

interface RcRow { account: string; rc_manabar: { current_mana: number; last_update_time: number }; max_rc: string | number }

interface ManaInfo { mana: number; maxRc: number }

async function fleetMana(): Promise<Map<string, ManaInfo>> {
  const out = await rpc<{ rc_accounts: RcRow[] }>("rc_api.find_rc_accounts", { accounts: FLEET });
  const now = Math.floor(Date.now() / 1000);
  const m = new Map<string, ManaInfo>();
  for (const row of out.rc_accounts) {
    const mx = Number(row.max_rc) || 0;
    const stored = Number(row.rc_manabar.current_mana) || 0;
    const regen = Math.floor(((now - Number(row.rc_manabar.last_update_time)) * mx) / (5 * 86400));
    m.set(row.account, { mana: Math.min(mx, stored + regen), maxRc: mx });
  }
  return m;
}

interface PendingReq { id: string; payload: unknown; status: string; network: string }

async function pendingHiveWeave(): Promise<PendingReq | null> {
  try {
    const res = await fetch(`${FOUNDRY}/api/saos/signer?limit=50`, { signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { pending?: PendingReq[] };
    const list = j.pending ?? [];
    const req = list.find((r) => r.network === "HIVE" && (r.status === "pending" || r.status === "awaiting-approval"));
    return req ?? null;
  } catch (e) {
    log("WARN", `foundry pending-list unavailable: ${String((e as Error)?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

interface SignOutcome { ok: boolean; txid?: string; error?: string; status?: number; failureClass?: string | null }

async function signWeave(account: string, requestId: string, payload: unknown): Promise<SignOutcome> {
  const token = signerToken();
  if (!token) return { ok: false, error: "signer-token-missing (fail-closed)" };
  const res = await fetch(`${SIGNER_URL}/sign`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ requestId, network: "HIVE", kind: "custom_json", account, id: WEAVE_ID, payload }),
    signal: AbortSignal.timeout(45_000)
  });
  const j = (await res.json()) as { ok: boolean; txid?: string; error?: string; failureClass?: string | null };
  return { ok: Boolean(j.ok), txid: j.txid, error: j.error, status: res.status, failureClass: j.failureClass ?? null };
}

async function recordTxid(requestId: string, txid: string): Promise<boolean> {
  const admin = adminKey();
  if (!admin) {
    log("ERROR", "admin-key missing — cannot record txid (fail-closed); txid stays in status file");
    return false;
  }
  try {
    const res = await fetch(`${FOUNDRY}/api/saos/signer`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
      body: JSON.stringify({ id: requestId, txid, proofRef: `hive:${txid}`, verify: true }),
      signal: AbortSignal.timeout(15_000)
    });
    const j = (await res.json()) as { ok?: boolean; error?: string };
    if (!j.ok) {
      log("WARN", `record failed: ${String(j.error ?? "?").slice(0, 120)}`);
      return false;
    }
    return true;
  } catch (e) {
    log("WARN", `record threw: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return false;
  }
}

/**
 * roast 61 — retry discipline per SignRequest:
 *  - reqId: the SignRequest the current state refers to (a NEW id resets it);
 *  - lastAttemptAt: bounds auto-retries to the signer's 1h idempotency-ledger
 *    window (55min guard) — past it a retry could rebuild a DIFFERENT tx;
 *  - refusedReqId: a DEFINITIVE chain refusal (400/403/429 or failureClass
 *    chain-rejected — nothing was broadcast) is never auto-retried.
 * The requestId itself is DETERMINISTIC (`fleet-cure-<sigId>`): every retry
 * replays the signer's ledger (single-flight) instead of minting a fresh
 * identity that could double-broadcast the same weave.
 */
interface CureState {
  doneAccount?: string; txid?: string; recordedAt?: string;
  reqId?: string; lastAttemptAt?: string; refusedReqId?: string;
  attempts: { at: string; account: string; ok: boolean; detail: string }[]
}
const STATE_FILE = path.join(import.meta.dir, "cure-state.json");
function loadState(): CureState {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8")) as CureState;
    if (!Array.isArray(s.attempts)) s.attempts = []; // roast 61: never trust a foreign/legacy state shape
    return s;
  } catch { return { attempts: [] }; }
}
function saveState(s: CureState) {
  try { writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); } catch {}
}

// Task 59: the vault summary below is MEASURED LIVE from the signer on every
// status write (keyless counts only) — the evidence file can never again claim
// key state from frozen text (the stale "9/9 HIVE posting" claim survived in
// this file for two days while the envelope changed underneath it).
async function vaultSummary() {
  try {
    const tok = signerToken();
    if (!tok) return { reachable: false, reason: "no signer token" };
    const res = await fetch(`${SIGNER_URL}/keys/status`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { reachable: false, reason: `signer ${res.status}` };
    const s = (await res.json()) as Record<string, unknown>;
    const main = (s as { main?: { account?: string; networks?: Record<string, Record<string, { loaded?: boolean; match?: boolean }>> } }).main;
    const networks: Record<string, string> = {};
    let mainOk = 0, mainLoaded = 0;
    for (const [net, roles] of Object.entries(main?.networks ?? {})) {
      const loaded = Object.values(roles ?? {}).filter((r) => r?.loaded).length;
      const matched = Object.values(roles ?? {}).filter((r) => r?.loaded && r?.match).length;
      mainLoaded += loaded; mainOk += matched;
      networks[net] = `${matched}/${loaded} matched`;
    }
    const fleet = (s as { fleet?: Array<{ account?: string; username?: string }> }).fleet ?? [];
    const drift = (s as { drift?: { summary?: Record<string, number>; lastCheck?: string | null } }).drift;
    return {
      reachable: true,
      main: main?.account ?? null,
      mainSlots: `${mainOk}/${mainLoaded} matched`,
      perNetwork: networks,
      fleetAccounts: fleet.map((f) => f.account ?? f.username).filter(Boolean),
      drift: drift?.summary ?? null,
      driftCheckedAt: drift?.lastCheck ?? null,
      sealedAt: (s as { sealedAt?: string }).sealedAt ?? null,
      source: "external-signer :3033 /keys/status (counts only — no key material)"
    };
  } catch (e) {
    return { reachable: false, reason: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

async function writeStatus(state: CureState, rows: FleetRow[], note: string, pendingWeave?: boolean) {
  const status = {
    updatedAt: new Date().toISOString(),
    // Task 62: readiness ≠ schedule. חלון-RC פתוח הוא תנאי-הכרח, לא תוכנית.
    // הדגל הזה = האם בקשת-weave תלויה באמת קיימת — רק אז מותר למסך להצהיר "מתוזמן".
    pendingWeave: pendingWeave ?? false,
    purpose: "Task 26-c fleet RC cure — RC windows measured live per fleet account (chain-side, keyless); execution = external-signer :3033 authority gate, which only ever signs with keys sealed in the envelope and verified live (see vault summary below). pendingWeave decides whether anything is scheduled at all (roast-62: readiness ≠ schedule).",
    opCostRc: OP_COST_RC,
    measuredOpCostRc: 225_041_204,
    headcornerNote: "headcorner 12/12 slots live-verified in the envelope (STEEM+HIVE+BLURT × owner/active/posting/memo — Task 59, owner password file). tov: BLURT 4/4 resurrected (never rotated there); STEEM/HIVE externally-rotated (SETTLE-10, seed lost) — orphaned planes, assets negligible. Liquid HIVE power-up runbook: DEX POST /api/dex/convert {account:headcorner, action:powerup} — the authority gate verifies against the live chain.",
    vault: await vaultSummary(),
    note,
    accounts: rows,
    lastTxid: state.txid ?? null,
    recordedAt: state.recordedAt ?? null
  };
  try {
    mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    writeFileSync(STATUS_PATH, JSON.stringify(status, null, 1));
  } catch (e) {
    log("ERROR", `status write failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
}

async function cycle(state: CureState): Promise<void> {
  let mana: Map<string, ManaInfo>;
  try {
    mana = await fleetMana();
  } catch (e) {
    log("WARN", `mana probe failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    await writeStatus(state, [], "mana probe failed this cycle (will retry)");
    return;
  }
  const rows: FleetRow[] = FLEET.map((account) => {
    const info = mana.get(account) ?? { mana: 0, maxRc: 0 };
    const regenPerMin = info.maxRc / 7200;
    const eta = info.mana >= OP_COST_RC ? 0 : Math.ceil((OP_COST_RC - info.mana) / Math.max(1, regenPerMin));
    return {
      account,
      mana: Math.round(info.mana),
      manaPct: info.maxRc ? Math.round((info.mana / info.maxRc) * 1000) / 10 : 0,
      etaToWindowMin: state.doneAccount ? null : eta,
      state: state.doneAccount === account ? "done" : info.mana >= OP_COST_RC ? "ready" : "waiting",
      txid: state.doneAccount === account ? state.txid : undefined
    };
  });

  if (state.doneAccount && state.txid) {
    await writeStatus(state, rows, "weave landed — cure complete for this SignRequest", true);
    return;
  }

  const req = await pendingHiveWeave();
  if (!req) {
    await writeStatus(state, rows, "no pending HIVE weave SignRequest found — nothing to execute", false);
    return;
  }

  // ── roast 61: per-SignRequest retry discipline ──
  if (state.reqId !== req.id) {
    state.reqId = req.id;
    state.lastAttemptAt = undefined;
    state.refusedReqId = undefined;
  }
  if (state.refusedReqId === req.id) {
    await writeStatus(state, rows, `sig=${req.id} was DEFINITIVELY refused by the chain (nothing broadcast) — auto-retry stopped; operator decides next`, true);
    return;
  }
  if (state.lastAttemptAt && Date.now() - Date.parse(state.lastAttemptAt) > 55 * 60_000) {
    await writeStatus(state, rows, `sig=${req.id} still unrecorded >55min after the last attempt — past the signer idempotency-ledger window (1h); auto-retry stopped (operator decides)`, true);
    return;
  }

  const ready = FLEET.map((a) => ({ a, m: mana.get(a)?.mana ?? 0 })).sort((x, y) => y.m - x.m)[0];
  if (!ready || ready.m < OP_COST_RC) {
    await writeStatus(state, rows, `no fleet account at op-cost yet — best ${ready?.a ?? "?"} ${(ready?.m ?? 0) >= 1e6 ? Math.round((ready?.m ?? 0) / 1e6) + "M" : String(ready?.m ?? 0)} RC`, true);
    return;
  }

  // DETERMINISTIC requestId (roast 61): retries replay the signer's ledger —
  // the old `fleet-cure-<account>-<now36>` minted a fresh identity per attempt,
  // so a lost response + retry could rebuild a DIFFERENT tx = double broadcast
  // (the exact money-class roast 56 closed on anchor-pulse — this caller stayed open).
  const requestId = `fleet-cure-${req.id}`;
  log("INFO", `window OPEN: ${ready.a} mana=${ready.m} ≥ ${OP_COST_RC} — executing weave sig=${req.id} requestId=${requestId}`);
  const r = await signWeave(ready.a, requestId, req.payload);
  state.lastAttemptAt = new Date().toISOString();
  state.attempts.push({ at: new Date().toISOString(), account: ready.a, ok: Boolean(r.ok), detail: r.ok ? `txid=${r.txid}` : `${r.status ?? "?"}/${r.failureClass ?? "-"}: ${String(r.error ?? "?").slice(0, 140)}` });
  state.attempts = state.attempts.slice(-40);
  if (r.ok && r.txid) {
    state.doneAccount = ready.a;
    state.txid = r.txid;
    const recorded = await recordTxid(req.id, r.txid);
    if (recorded) state.recordedAt = new Date().toISOString();
    log("INFO", `WEAVE LANDED: txid=${r.txid} account=${ready.a} recorded=${recorded}`);
    await writeStatus(state, rows, `weave landed txid=${r.txid} (recorded=${recorded})`, true);
  } else {
    // roast 61: classify like the foundry does — 400/403/429 or failureClass
    // chain-rejected means the chain ANSWERED and refused (nothing broadcast,
    // definitive); transport/timeout stays ambiguous and may retry within the
    // ledger window. A definitive refusal never auto-retries.
    const definitive = r.status === 400 || r.status === 403 || r.status === 429 || r.failureClass === "chain-rejected";
    if (definitive) state.refusedReqId = req.id;
    log("WARN", `weave attempt failed on ${ready.a} (definitive=${definitive}): ${String(r.error ?? "?").slice(0, 160)}`);
    await writeStatus(state, rows, `attempt failed (${ready.a}, definitive=${definitive}): ${String(r.error ?? "?").slice(0, 120)}${definitive ? " — auto-retry stopped" : " — retry next cycle within the ledger window"}`, true);
  }
  saveState(state);
}

const bootState = loadState();

// roast 72: the 19:25 bun --hot reload silently killed the cycle loop — the
// status file froze for 3h20m with ZERO log evidence (a monitor that dies
// quietly is worse than a monitor that fails loudly). Fixes: (1) no-overlap
// lock — a slow cycle can never pile up; (2) every cycle logs start/end so a
// dead loop is visible in the log within one cadence.
let cycling = false;
async function loop() {
  if (cycling) { log("WARN", "cycle skipped — previous cycle still running (no-overlap lock)"); return; }
  cycling = true;
  const t0 = Date.now();
  try {
    log("INFO", "cycle start");
    await cycle(bootState);
    log("INFO", `cycle end in ${Date.now() - t0}ms`);
  } catch (e) {
    log("ERROR", `cycle error: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  } finally {
    cycling = false;
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/ping") return Response.json({ ok: true, service: "fleet-cure" });
    if (url.pathname === "/status") {
      try {
        if (existsSync(STATUS_PATH)) return new Response(readFileSync(STATUS_PATH, "utf8"), { headers: { "content-type": "application/json" } });
      } catch {}
      return Response.json({ ok: true, note: "status file not written yet" });
    }
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
});

log("INFO", `fleet-cure listening on :${PORT} (signer=${SIGNER_URL}, opCost=${OP_COST_RC} RC, fleet=${FLEET.length}, admin=${adminKey() ? "token" : "MISSING-record-fail-closed"})`);
void loop();
setInterval(() => void loop(), CYCLE_MS);
