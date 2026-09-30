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
const KEY_FILE = path.join(process.cwd(), ".secrets", "headcorner.key");

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
    autoRuns: number; ok: number; fail: number; blocked: number;
    lastAt: string | null; lastOk: boolean | null; lastHealth: "ok" | "blocked" | "fail" | null;
    lastMs: number | null; nextAt: string | null;
  };
  selftest: { runs: number; lastAt: string | null; lastOk: boolean | null; passed: number | null; total: number | null };
  cred: {
    present: boolean | null; firstDownAt: string | null; lastDownAt: string | null;
    alerts: number; lastAlertAt: string | null;
  };
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

/** בדיקת-בעלות: האם ה-pid הזה באמת תהליך-המנוע שלנו (מנע הריגת תהליך-זר שמיחזר pid) */
function pidIsOurEngine(pid: number): boolean {
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmd.includes("index.ts");
  } catch { return false; }
}

/** הרמת תהליך-מנוע נפרד (detached) — שורד גם ריסטרט של שרת-Next; force=ניסיון-חוזר-פנימי בתוך ריפוי */
function spawnEngine(core: Core, reason: string, force = false): void {
  const t = Date.now();
  if (!force && core.state.watchdog.lastSpawnAt && t - new Date(core.state.watchdog.lastSpawnAt).getTime() < SPAWN_COOLDOWN_MS) return;
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

/** ריפוי: סיום-תהליך-תקוע משלנו והרמה מחדש, עם לולאת-אימות-וניסיון-חוזר (תיקון T-11: מירוץ EADDRINUSE) */
async function healEngine(core: Core, reason: string): Promise<void> {
  appendEvent(core, "heal-attempt", { reason });
  let pid = NaN;
  try { pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10); } catch { /* no pidfile yet — first boot or externally-started engine */ }
  if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) {
    if (!pidIsOurEngine(pid)) {
      // pid מוחזר-לתהליך-זר או cmdline לא-זמין — לא הורגים; רק מנסים להרים (הפורט יכריע)
      appendEvent(core, "heal-skip-foreign-pid", { pid });
    } else {
      appendEvent(core, "heal-kill-stale", { pid });
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
      // המתנה-עד-מוות-אמיתי (עד 5s) — מונע EADDRINUSE בהרמה-מחדש
      for (let i = 0; i < 10 && pidAlive(pid); i++) await new Promise((r) => setTimeout(r, 500));
      try { if (pidAlive(pid)) process.kill(pid, "SIGKILL"); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  // הרמה + לולאת-אימות: 3 סבבים × (4s המתנה + בדיקת-דופק); אם נפל — מרימים שוב (force)
  let up = false;
  for (let round = 1; round <= 3 && !up; round++) {
    if (round > 1) {
      appendEvent(core, "heal-retry", { round });
      spawnEngine(core, `${reason}:retry${round}`, true);
      await new Promise((r) => setTimeout(r, 4000));
    } else {
      spawnEngine(core, reason);
      await new Promise((r) => setTimeout(r, 4000));
    }
    const first = await engineHealth();
    up = first.up;
    if (!up) await new Promise((r) => setTimeout(r, 4000));
    const second = up ? { up: true } : await engineHealth();
    up = second.up;
  }
  core.state.watchdog.engineUp = up;
  if (up) {
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
  // T-15 SIGNING-PULSE (the silent-rot lesson, measured live): the engine can
  // be HEALTHY while the whole signing fleet is DEAD (credential lost in a
  // cold-reset — 3 agents rotted with raw ENOENT for a full day, unnoticed).
  // The watchdog now treats armed-but-credential-missing as its own DOWN state:
  // journaled hourly (no spam), surfaced in state, revival path carried.
  try {
    const present = fs.existsSync(KEY_FILE);
    const prevPresent = core.state.cred.present;
    core.state.cred.present = present;
    if (!present) {
      core.state.cred.lastDownAt = nowIso();
      if (core.state.cred.firstDownAt == null) core.state.cred.firstDownAt = nowIso();
      const hourAgo = Date.now() - 3600_000;
      if (!core.state.cred.lastAlertAt || Date.parse(core.state.cred.lastAlertAt) < hourAgo) {
        core.state.cred.alerts++;
        core.state.cred.lastAlertAt = nowIso();
        appendEvent(core, "cred-missing", {
          verdict: "SIGNING-DEAD",
          agentsAffected: ["curate", "execute", "soldiers", "promo"],
          revival: "drop upload/headcorner.txt → engine self-adopts (0600) on next cycle",
        });
      }
    } else if (prevPresent === false) {
      appendEvent(core, "cred-restored", { at: nowIso() });
      core.state.cred.firstDownAt = null;
    }
  } catch { /* credential-pulse is best-effort; never break the watchdog */ }
  writeJson(SOV_FILE, core.state);
}

/** T-14: סיווג-כשל — רק כשל-חיבור זכאי לניסיון-חוזר (timeout לא: המחזור עשוי
 * לרוץ-בצד-השרת, וניסיון-שני יכפיל פעולות; מדיניות-המכסות תוחמת גם-זאת, אך
 * זהירות קודם-כל). */
function isConnLevelFailure(err: unknown): boolean {
  const s = String((err as Error)?.message ?? err ?? "");
  return /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket|network|other side closed/i.test(s)
    && !/timeout|abort/i.test(s);
}

/* T-17: START-ACK + MARKER POLL. The old flow held a 90s HTTP wait — every
 * real multi-vote signing cycle outlived it and was journaled "fail" WHILE
 * ITS VOTES WERE LANDING ON-CHAIN (measured live 16:54-16:57: two real votes
 * broadcast, two cycle-fail events at exactly 90010/90006 ms), and the
 * busy-flag release admitted the next cycle INTO the still-running one (a
 * real double-vote window). Now: POST /cycle returns an immediate start-ack;
 * the engine owns a cycle-run.json marker (start + end, try/finally) plus a
 * module-level single-flight mutex; we poll /cycle-status until the marker
 * closes and classify from the ENGINE's own truth (ok | blocked | fail) with
 * the engine-measured duration. Guards hoisted, lies removed, overlap dead. */
const CYCLE_POLL_MS = 4_000;
const CYCLE_WAIT_MAX_MS = 15 * 60_000; // poll budget — beyond any measured healthy cycle

async function runEngineCycle(core: Core, trigger: "auto" | "kick"): Promise<{ ok: boolean; steps?: Record<string, unknown>; error?: string; ms: number }> {
  if (core.cycleBusy) return { ok: false, error: "cycle-busy", ms: 0 };
  if (core.state.paused && trigger === "auto") return { ok: false, error: "paused", ms: 0 };
  core.cycleBusy = true;
  const t0 = Date.now();
  type Ack = { ok?: boolean; started?: boolean; error?: string; since?: string | null };
  const postAck = async (): Promise<{ j?: Ack; err?: unknown }> => {
    try {
      const r = await fetch(`${ENGINE_HTTP}/cycle`, { method: "POST", signal: AbortSignal.timeout(8000), cache: "no-store" });
      return { j: (await r.json()) as Ack };
    } catch (err) { return { err }; }
  };
  const pollStatus = async (): Promise<{ running?: boolean; marker?: { running?: boolean; startedAt?: string; ms?: number; health?: string; steps?: Record<string, unknown>; blockedSteps?: string[] | null; error?: string | null } | null } | null> => {
    try {
      const r = await fetch(`${ENGINE_HTTP}/cycle-status`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
      return (await r.json()) as { running?: boolean; marker?: { running?: boolean; startedAt?: string; ms?: number; health?: string; steps?: Record<string, unknown>; blockedSteps?: string[] | null; error?: string | null } | null };
    } catch { return null; }
  };
  const journalCycleFail = (kind: string, extra: Record<string, unknown>) => {
    const ms = Date.now() - t0;
    if (trigger === "auto") {
      core.state.cycles.autoRuns++; core.state.cycles.fail++;
      core.state.cycles.lastAt = nowIso(); core.state.cycles.lastOk = false; core.state.cycles.lastHealth = "fail";
      core.state.cycles.lastMs = ms;
      core.state.cycles.nextAt = new Date(Date.now() + CYCLE_MS).toISOString();
    }
    appendEvent(core, kind, { ms, ...extra });
    writeJson(SOV_FILE, core.state);
  };
  try {
    // תיקון T-11: אם המנוע נפל בין-הצצות-שעון — ריפוי-מקדים במקום מחזור-שנכשל
    const pre = await engineHealth(2000);
    if (!pre.up && !(core.state.paused && trigger === "auto")) {
      await healEngine(core, `cycle-preheal(${trigger})`);
    }
    // 1 · start-ack (one conn-level heal+retry — T-14 pattern preserved)
    /* ackAt is captured BEFORE the POST: the engine writes its marker's
     * startedAt DURING request handling, i.e. strictly after this moment —
     * capturing it after the response would make every marker look "stale"
     * by a few ms and doom the poll to its full wait budget (measured
     * 17:30:00: marker .695 vs ack .700 → the exact bug, fixed here). */
    const ackAt = new Date().toISOString(); // only trust markers opened at/after this moment
    let ack = await postAck();
    if (!ack.j && ack.err !== undefined && isConnLevelFailure(ack.err)) {
      const h = await engineHealth(2500);
      if (!h.up) await healEngine(core, `cycle-retry-preheal(${trigger})`);
      appendEvent(core, `cycle-retry(${trigger})`, { error: String((ack.err as Error)?.message ?? ack.err).slice(0, 120), engineUpAfterHeal: h.up || core.state.watchdog.engineUp });
      ack = await postAck();
    }
    // 2 · ack outcomes — every path is explicit, none is a silent "fail"
    if (!ack.j) {
      const error = String((ack.err as Error)?.message ?? ack.err).slice(0, 160);
      journalCycleFail(`cycle-error(${trigger})`, { error });
      return { ok: false, error, ms: Date.now() - t0 };
    }
    if (ack.j.error === "cycle-in-flight") {
      /* a cycle is ALREADY running on the engine (duplicate trigger / kick
       * while auto is in flight) — a lawful SKIP, never a fail: nothing
       * malfunctioned and no double-execution was admitted. */
      appendEvent(core, `cycle-skip(${trigger})`, { reason: "engine-cycle-in-flight", since: ack.j.since ?? null });
      writeJson(SOV_FILE, core.state);
      return { ok: false, error: "cycle-in-flight", ms: Date.now() - t0 };
    }
    if (!ack.j.started) {
      const error = String(ack.j.error ?? "unexpected-ack").slice(0, 160);
      journalCycleFail(`cycle-error(${trigger})`, { error });
      return { ok: false, error, ms: Date.now() - t0 };
    }
    // 3 · poll the engine's own marker until it closes (or the budget dies)
    const deadline = t0 + CYCLE_WAIT_MAX_MS;
    let marker: NonNullable<Awaited<ReturnType<typeof pollStatus>>>["marker"] = null;
    let pollFails = 0;
    let healedMidCycle = false;
    for (;;) {
      await new Promise((r) => setTimeout(r, CYCLE_POLL_MS));
      const st = await pollStatus();
      if (!st) {
        pollFails++;
        if (pollFails >= 3 && !healedMidCycle) { healedMidCycle = true; await healEngine(core, `cycle-midpoll-heal(${trigger})`); }
        if (Date.now() > deadline) break;
        continue;
      }
      pollFails = 0;
      const m = st.marker ?? null;
      const fresh = !!m && typeof m.startedAt === "string" && m.startedAt >= ackAt;
      if (fresh && m!.running === false) { marker = m; break; } // normal completion
      if (st.running === false && fresh && m!.running !== false) {
        // phantom marker: the engine (re)started mid-cycle — module state says
        // no cycle runs, the marker never closed ⇒ the process died mid-cycle
        marker = { ...m!, running: false, health: "fail", error: "engine-restarted-mid-cycle" };
        break;
      }
      if (Date.now() > deadline) break;
    }
    // 4 · classify from ENGINE truth (T-16 taxonomy, engine-measured ms)
    const closedFresh = !!marker && marker.running === false && typeof marker.startedAt === "string" && marker.startedAt >= ackAt;
    if (!closedFresh) {
      journalCycleFail(`cycle-fail(${trigger})`, { error: "cycle-wait-timeout", waitMs: CYCLE_WAIT_MAX_MS });
      return { ok: false, error: "cycle-wait-timeout", ms: Date.now() - t0 };
    }
    const health: "ok" | "blocked" | "fail" = marker!.health === "ok" ? "ok" : marker!.health === "blocked" ? "blocked" : "fail";
    const engineMs = typeof marker!.ms === "number" && marker!.ms! > 0 ? marker!.ms! : Date.now() - t0;
    if (trigger === "auto") {
      core.state.cycles.autoRuns++;
      if (health === "ok") core.state.cycles.ok++;
      else if (health === "blocked") core.state.cycles.blocked++;
      else core.state.cycles.fail++;
      core.state.cycles.lastAt = nowIso();
      core.state.cycles.lastOk = health === "ok";
      core.state.cycles.lastHealth = health;
      core.state.cycles.lastMs = engineMs;
      core.state.cycles.nextAt = new Date(Date.now() + CYCLE_MS).toISOString();
    }
    appendEvent(core, health === "ok" ? `cycle-ok(${trigger})` : health === "blocked" ? `cycle-blocked(${trigger})` : `cycle-fail(${trigger})`, {
      ms: engineMs, engineMeasured: true,
      steps: marker!.steps && typeof marker!.steps === "object" ? Object.keys(marker!.steps).length : 0,
      verdict: null,
      blockedSteps: marker!.blockedSteps ?? null,
      error: marker!.error ?? null,
    });
    writeJson(SOV_FILE, core.state);
    return { ok: health === "ok", steps: marker!.steps, error: marker!.error ?? undefined, ms: engineMs };
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
        // T-11: מונים מצטברים-על-פני-אתחולים — רציפות-אמת חוצה-הפעלות (שדות-נדיפים מתאפסים)
        checks: prev?.watchdog?.checks ?? 0, downs: prev?.watchdog?.downs ?? 0,
        heals: prev?.watchdog?.heals ?? 0, healVerified: prev?.watchdog?.healVerified ?? 0, healFailed: prev?.watchdog?.healFailed ?? 0,
        lastCheckAt: null, engineUp: false, lastSpawnAt: null,
      },
      cycles: {
        autoRuns: prev?.cycles?.autoRuns ?? 0, ok: prev?.cycles?.ok ?? 0, fail: prev?.cycles?.fail ?? 0,
        blocked: prev?.cycles?.blocked ?? 0,
        lastAt: prev?.cycles?.lastAt ?? null, lastOk: prev?.cycles?.lastOk ?? null,
        lastHealth: prev?.cycles?.lastHealth ?? null, lastMs: prev?.cycles?.lastMs ?? null, nextAt: null,
      },
      selftest: {
        runs: prev?.selftest?.runs ?? 0, lastAt: prev?.selftest?.lastAt ?? null, lastOk: prev?.selftest?.lastOk ?? null,
        passed: prev?.selftest?.passed ?? null, total: prev?.selftest?.total ?? null,
      },
      cred: {
        present: prev?.cred?.present ?? null, firstDownAt: prev?.cred?.firstDownAt ?? null,
        lastDownAt: prev?.cred?.lastDownAt ?? null, alerts: prev?.cred?.alerts ?? 0,
        lastAlertAt: prev?.cred?.lastAlertAt ?? null,
      },
      control: prev?.control?.slice(0, 20) ?? [],
    },
    events: [],
    timers: {},
    cycleBusy: false,
    testBusy: false,
  };
  g.__saosSovereign = core;
  control(core, "boot", by, "SovereignCore armed");
  appendEvent(core, "boot", {
    pid: process.pid,
    resumed: prev?.paused ?? false,
    carriedOver: { checks: core.state.watchdog.checks, cyclesOk: core.state.cycles.ok, heals: core.state.watchdog.heals },
  });

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
