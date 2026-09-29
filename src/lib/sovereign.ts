/**
 * T-10 · SovereignCore — ריבונות-מתמשכת (continuous sovereignty layer).
 *
 * המערכת דואגת לעצמה ללא הפעלה-אנושית:
 *  - נטענת אוטומטית כששרת-Next עולה (instrumentation.register) וגם self-arms בכל קריאת-API
 *  - WATCHDOG (כל 60 שניות): בודק דופק של המנוע :3040; אם נפל → מרים אותו מחדש לבד
 *  - CYCLE (כל 10 דקות): מריץ מחזור observe→tick→peg→convert→report ללא יד-אנושית
 *  - SELFTEST (כל 6 שעות): מריץ את סוויטת-האיכות של המנוע ומתעד תוצאה
 *  - יומן-החלטות: state/sovereign.json + state/sovereign-events.jsonl
 *
 * אפס-מפתחות: השכבה הזו מנהלת תהליכים ומתכננת — היא לא ולא יכולה לחתום על-על-שרשרת.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const ENGINE_HTTP = "http://127.0.0.1:3040";
const ENGINE_DIR = path.join(process.cwd(), "mini-services", "saos-engine");
const STATE_DIR = path.join(ENGINE_DIR, "state");
const PID_FILE = path.join(STATE_DIR, "engine.pid");
const LOG_FILE = path.join(ENGINE_DIR, "engine.log");
const SOV_FILE = path.join(STATE_DIR, "sovereign.json");
const SOV_EVENTS = path.join(STATE_DIR, "sovereign-events.jsonl");

const WD_MS = 60_000;      // watchdog tick
const CYCLE_MS = 600_000;  // autonomous cycle every 10 min
const SELFTEST_MS = 21_600_000; // quality suite every 6h
const SPAWN_COOLDOWN_MS = 20_000;

type SovereignState = {
  bootedAt: string;
  pid: number;
  armed: boolean;
  paused: boolean;
  watchdog: {
    checks: number; downs: number; heals: number; healVerified: number; healFailed: number;
    lastCheckAt: string | null; engineUp: boolean; lastSpawnAt: string | null;
  };
  cycles: {
    autoRuns: number; ok: number; fail: number;
    lastAt: string | null; lastOk: boolean | null; lastMs: number | null; nextAt: string | null;
  };
  selftest: { runs: number; lastAt: string | null; lastOk: boolean | null; passed: number | null; total: number | null };
  control: { at: string; action: string; by: string; note?: string }[];
};

type Core = {
  state: SovereignState;
  events: { at: string; kind: string; [k: string]: unknown }[];
  timers: { wd?: ReturnType<typeof setInterval>; cycle?: ReturnType<typeof setInterval>; st?: ReturnType<typeof setInterval> };
  cycleBusy: boolean;
  testBusy: boolean;
};

const g = globalThis as unknown as { __saosSovereign?: Core };

const nowIso = () => new Date().toISOString();
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function readJson<T>(p: string, d: T): T {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return d; }
}
function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}
function appendEvent(core: Core, kind: string, data: Record<string, unknown> = {}) {
  const e = { at: nowIso(), kind, ...data };
  core.events.push(e);
  if (core.events.length > 200) core.events = core.events.slice(-200);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(SOV_EVENTS, JSON.stringify(e) + "\n");
  } catch { /* journal best-effort */ }
  writeJson(SOV_FILE, core.state);
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function engineHealth(timeoutMs = 3500): Promise<{ up: boolean; info?: Record<string, unknown> }> {
  try {
    const r = await fetch(`${ENGINE_HTTP}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!r.ok) return { up: false };
    return { up: true, info: (await r.json()) as Record<string, unknown> };
  } catch { return { up: false }; }
}

/** הרמת תהליך-מנוע נפרד (detached) — שורד גם ריסטרט של שרת-Next */
function spawnEngine(core: Core, reason: string): void {
  const t = Date.now();
  if (core.state.watchdog.lastSpawnAt && t - new Date(core.state.watchdog.lastSpawnAt).getTime() < SPAWN_COOLDOWN_MS) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const logFd = fs.openSync(LOG_FILE, "a");
    const child = spawn("bun", ["--hot", "index.ts"], {
      cwd: ENGINE_DIR, detached: true, stdio: ["ignore", logFd, logFd],
      env: { ...process.env, SAOS_ACCOUNT: process.env.SAOS_ACCOUNT || "headcorner" },
    });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));
    core.state.watchdog.lastSpawnAt = nowIso();
    core.state.watchdog.heals++;
    appendEvent(core, "heal-spawn", { reason, pid: child.pid });
  } catch (e) {
    appendEvent(core, "heal-spawn-error", { reason, error: String((e as Error)?.message ?? e).slice(0, 160) });
  }
}

/** ריפוי: סיום-תהליך-תקוע משלנו והרמה מחדש */
async function healEngine(core: Core, reason: string): Promise<void> {
  appendEvent(core, "heal-attempt", { reason });
  let pid = NaN;
  try { pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10); } catch { /* no pidfile yet — first boot or externally-started engine */ }
  if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) {
    appendEvent(core, "heal-kill-stale", { pid });
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 1500));
    try { if (pidAlive(pid)) process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  }
  spawnEngine(core, reason);
  await new Promise((r) => setTimeout(r, 8000));
  const h = await engineHealth();
  core.state.watchdog.engineUp = h.up;
  if (h.up) {
    core.state.watchdog.healVerified++;
    appendEvent(core, "heal-verified", { up: true });
  } else {
    core.state.watchdog.healFailed++;
    appendEvent(core, "heal-failed", { up: false });
  }
}

async function watchdogTick(core: Core): Promise<void> {
  core.state.watchdog.checks++;
  core.state.watchdog.lastCheckAt = nowIso();
  const h = await engineHealth();
  const wasUp = core.state.watchdog.engineUp;
  core.state.watchdog.engineUp = h.up;
  if (!h.up) {
    core.state.watchdog.downs++;
    appendEvent(core, wasUp ? "watchdog-down" : "watchdog-down-again", {});
    if (!core.state.paused) await healEngine(core, "watchdog");
  } else if (!wasUp) {
    appendEvent(core, "watchdog-up", {});
  }
  writeJson(SOV_FILE, core.state);
}

async function runEngineCycle(core: Core, trigger: "auto" | "kick"): Promise<{ ok: boolean; steps?: Record<string, unknown>; error?: string; ms: number }> {
  if (core.cycleBusy) return { ok: false, error: "cycle-busy", ms: 0 };
  if (core.state.paused && trigger === "auto") return { ok: false, error: "paused", ms: 0 };
  core.cycleBusy = true;
  const t0 = Date.now();
  try {
    const r = await fetch(`${ENGINE_HTTP}/cycle`, { method: "POST", signal: AbortSignal.timeout(90_000), cache: "no-store" });
    const j = (await r.json()) as { ok?: boolean; steps?: Record<string, unknown>; error?: string };
    const ms = Date.now() - t0;
    const ok = Boolean(j?.ok);
    if (trigger === "auto") {
      core.state.cycles.autoRuns++;
      if (ok) core.state.cycles.ok++; else core.state.cycles.fail++;
      core.state.cycles.lastAt = nowIso();
      core.state.cycles.lastOk = ok;
      core.state.cycles.lastMs = ms;
      core.state.cycles.nextAt = new Date(Date.now() + CYCLE_MS).toISOString();
    }
    appendEvent(core, ok ? `cycle-ok(${trigger})` : `cycle-fail(${trigger})`, {
      ms, steps: j?.steps ? Object.keys(j.steps).length : 0,
      verdict: j?.steps && typeof j.steps === "object" ? (j.steps as Record<string, { verdict?: string }>).peg?.verdict ?? null : null,
    });
    writeJson(SOV_FILE, core.state);
    return { ok, steps: j?.steps, error: j?.error, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    if (trigger === "auto") {
      core.state.cycles.autoRuns++; core.state.cycles.fail++;
      core.state.cycles.lastAt = nowIso(); core.state.cycles.lastOk = false; core.state.cycles.lastMs = ms;
      core.state.cycles.nextAt = new Date(Date.now() + CYCLE_MS).toISOString();
    }
    appendEvent(core, `cycle-error(${trigger})`, { ms, error: String((e as Error)?.message ?? e).slice(0, 160) });
    writeJson(SOV_FILE, core.state);
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160), ms };
  } finally {
    core.cycleBusy = false;
  }
}

async function runSelftest(core: Core): Promise<void> {
  if (core.testBusy) return;
  core.testBusy = true;
  try {
    const out = await new Promise<{ code: number; text: string }>((resolve) => {
      try {
        const p = spawn("bun", ["selftest.mjs"], { cwd: ENGINE_DIR, env: { ...process.env } });
        let text = "";
        p.stdout.on("data", (d) => { text += String(d); });
        p.stderr.on("data", (d) => { text += String(d); });
        const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* */ } }, 120_000);
        p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, text }); });
        p.on("error", () => { clearTimeout(t); resolve({ code: -1, text }); });
      } catch { resolve({ code: -1, text: "" }); }
    });
    const m = /SELFTEST (\d+)\/(\d+)/.exec(out.text);
    core.state.selftest.runs++;
    core.state.selftest.lastAt = nowIso();
    core.state.selftest.lastOk = out.code === 0;
    core.state.selftest.passed = m ? Number(m[1]) : null;
    core.state.selftest.total = m ? Number(m[2]) : null;
    appendEvent(core, "selftest", { code: out.code, passed: core.state.selftest.passed, total: core.state.selftest.total });
    writeJson(SOV_FILE, core.state);
  } finally {
    core.testBusy = false;
  }
}

function control(core: Core, action: string, by: string, note?: string): void {
  core.state.control.unshift({ at: nowIso(), action, by, note });
  core.state.control = core.state.control.slice(0, 20);
}

/** נקודת-הצתה אחת — idempotent, HMR-safe, self-arming */
export function ensureSovereign(by = "auto"): Core {
  if (g.__saosSovereign) return g.__saosSovereign;
  const prev = readJson<SovereignState | null>(SOV_FILE, null);
  const core: Core = {
    state: {
      bootedAt: nowIso(),
      pid: process.pid,
      armed: true,
      paused: prev?.paused ?? false,
      watchdog: {
        checks: 0, downs: 0, heals: 0, healVerified: 0, healFailed: 0,
        lastCheckAt: null, engineUp: false, lastSpawnAt: null,
      },
      cycles: { autoRuns: 0, ok: 0, fail: 0, lastAt: null, lastOk: null, lastMs: null, nextAt: null },
      selftest: { runs: 0, lastAt: null, lastOk: null, passed: null, total: null },
      control: prev?.control?.slice(0, 20) ?? [],
    },
    events: [],
    timers: {},
    cycleBusy: false,
    testBusy: false,
  };
  g.__saosSovereign = core;
  control(core, "boot", by, "SovereignCore armed");
  appendEvent(core, "boot", { pid: process.pid, resumed: prev?.paused ?? false });

  // immediate first check + adopt-or-heal, then cadence
  void watchdogTick(core);
  core.timers.wd = setInterval(() => void watchdogTick(core), WD_MS);
  // first autonomous cycle shortly after boot (engine may still be warming)
  setTimeout(() => { if (!core.state.paused) void runEngineCycle(core, "auto"); }, 45_000);
  core.timers.cycle = setInterval(() => void runEngineCycle(core, "auto"), CYCLE_MS);
  core.timers.st = setInterval(() => void runSelftest(core), SELFTEST_MS);
  return core;
}

/* ── ממשק-שליטה (control & responsibility) ─────────────────────────────── */

export function sovereignSnapshot(): Record<string, unknown> {
  const core = ensureSovereign("api-snapshot");
  return {
    ok: true,
    at: nowIso(),
    state: core.state,
    events: core.events.slice(-12).reverse(),
  };
}

export function sovereignControl(action: string, by = "operator-cockpit"): Record<string, unknown> {
  const core = ensureSovereign("api-control");
  switch (action) {
    case "pause":
      core.state.paused = true;
      control(core, "pause", by);
      appendEvent(core, "pause", { by });
      return { ok: true, paused: true };
    case "resume":
      core.state.paused = false;
      control(core, "resume", by);
      appendEvent(core, "resume", { by });
      return { ok: true, paused: false };
    case "kick-cycle":
      if (core.state.paused) return { ok: false, error: "paused — הפעל ריבונות קודם" };
      void runEngineCycle(core, "kick").then(() => writeJson(SOV_FILE, core.state));
      return { ok: true, kicked: true };
    case "force-heal":
      void healEngine(core, "operator-forced").then(() => writeJson(SOV_FILE, core.state));
      return { ok: true, healing: true };
    default:
      return { ok: false, error: `unknown-action: ${action}` };
  }
}

export const SOVEREIGN_INTERVALS = { watchdogSec: WD_MS / 1000, cycleSec: CYCLE_MS / 1000, selftestSec: SELFTEST_MS / 1000 };
export const SOVEREIGN_FILES = { SOV_FILE, SOV_EVENTS, PID_FILE, LOG_FILE };
