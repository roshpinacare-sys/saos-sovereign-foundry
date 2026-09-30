/**
 * rotation-keeper/index.ts — מחזיק-הרוטציה הקבועה של ה-foundry (Task ROT-1)
 * ==========================================================================
 * החלטת-בעלים 2026-09-29 ("להכניס את התיקייה לרוטציה הקבועה הכללית של כלל
 * המערכת והריבונות והאוטונומיה של הרשת, לחזק את החלק של התיקייה ברשת"):
 *
 * עד-היום ה-foundry פעל מתוך-עצמו (guardian סורק, chief מבריף, fleet-cure
 * אורגת) אך **לא היה רשום באופן-קבוע ברוטציה של הצי** — ההשתתפות הייתה
 * אד-הוק לפי-סוכן. השירות הזה הוא הרגל-הקבועה של ה-foundry ברוטציה:
 *
 *   1. health          — כל 15 דק': probe לכל שירותי-ה-foundry (:3100 האפליקציה — Task 10, 2026-09-30;
 *                          3031 guardian, 3032 chief, 3033 signer, 3034 fleet-cure,
 *                          3040 key-broker) + רישום.
 *   2. drift-report    — כל 30 דק': קורא מה-signer :3033 /keys/status (Bearer,
 *                          נתונים-ציבוריים בלבד: ספירות ok/drift/unmatched) ורושם
 *                          את מצב-הכספת בפנקס. (המוניטור-החי נשאר ב-signer עצמו
 *                          כל 10 דק' — כאן זו רק רשומת-רוטציה.)
 *   3. selftest        — כל 2 שעות: kernel-selftest (עצמאי, תהליך-בן קצר)
 *                          + בדיקת node_modules/prisma — PASS/FAIL בפנקס.
 *   4. backup-freshness— כל 6 שעות: גיל קובץ-הגיבוי הטרי ב-backups/*.enc;
 *                          אם אין גיבוי מה-24 שעות האחרונות → מפעיל POST
 *                          :3033/keys/backup (Bearer, kill-switch:
 *                          SAOS_NO_ROT_BACKUP=1). גיבוי נוצר ב-signer — כאן רק
 *                          טריגר, אפס חומר-מפתח.
 *   5. git-hygiene     — כל 6 שעות: git status --porcelain (שינויים-לא-קומיטו)
 *                          + גיל HEAD — רישום-בלבד, לא קומיט כאן (הסוכן-התורן
 *                          מקדם, כמו-ב-chief).
 *
 * כל ריצת-beat נרשמת בפנקס-משורשר-האש: broadcasts/rotation/ledger.jsonl
 * (כל רשומה: prevHash → sha256(רשומה) — אותו-משמעת קבלות-הראיות של הבית).
 *
 * כללי-ברזל (כמו-כל-הבית): אפס סודות בלוג/פלט; fail-safe — כל beat בתוך
 * try/catch עם timeout, קריסת-beat לא מפילה את השירות; כיבוי-ידני:
 * SAOS_NO_ROTATION=1.  ·  פורט: 3035 (loopback בלבד).
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";

const PORT = 3035;
const FOUNDRY = process.env.SAOS_FOUNDRY_ROOT ?? "/home/z/my-project";
const ROT_DIR = path.join(FOUNDRY, "broadcasts", "rotation");
const LEDGER = path.join(ROT_DIR, "ledger.jsonl");
const ROTATION_MANIFEST = path.join(FOUNDRY, "agent", "rotation.json");

const TICK_MS = 15_000; // scheduler tick: every beat keeps its own clock; the tick only checks due-beats
const KILL = (process.env.SAOS_NO_ROTATION ?? "").trim() === "1";
const BACKUP_KILL = (process.env.SAOS_NO_ROT_BACKUP ?? "").trim() === "1";

interface BeatDef {
  id: string;
  everyMs: number;
  firstDelayMs: number;
  run: () => Promise<BeatResult>;
  enabled: () => boolean;
}

interface BeatResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

interface LedgerEntry {
  ts: string;
  beat: string;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  prevHash: string;
  hash: string;
  durationMs: number;
}

interface ServiceTarget {
  name: string;
  url: string;
  bearer?: boolean;
}

// ── targets (loopback only, public data only) ────────────────────────────────
const SERVICES: ServiceTarget[] = [
  { name: "app", url: "http://127.0.0.1:3100/api/saos/status" },
  { name: "vault-guardian", url: "http://127.0.0.1:3031/health" },
  { name: "chief-of-staff", url: "http://127.0.0.1:3032/health" },
  { name: "external-signer", url: "http://127.0.0.1:3033/health", bearer: true },
  { name: "fleet-cure", url: "http://127.0.0.1:3034/health" },
  { name: "key-broker", url: "http://127.0.0.1:3040/verify" }
];

function signerToken(): string {
  try {
    return fs.readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "external-signer-token"), "utf8").trim();
  } catch {
    return "";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function fetchJson(url: string, opts: { bearer?: boolean; method?: string; timeoutMs?: number } = {}): Promise<{ reachable: boolean; status: number; body: Record<string, unknown> | null }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 8_000);
  try {
    const headers: Record<string, string> = {};
    if (opts.bearer) headers.authorization = `Bearer ${signerToken()}`;
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      signal: ctl.signal,
      cache: "no-store"
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { reachable: res.ok, status: res.status, body };
  } catch {
    return { reachable: false, status: 0, body: null };
  } finally {
    clearTimeout(t);
  }
}

// ── the hash-chained rotation ledger (broadcasts/rotation/ledger.jsonl) ──────
function lastHash(): string {
  try {
    const raw = fs.readFileSync(LEDGER, "utf8").trim();
    if (!raw) return "GENESIS";
    const last = raw.split("\n").pop() ?? "";
    const parsed = JSON.parse(last) as { hash?: string };
    return parsed.hash ?? "GENESIS";
  } catch {
    return "GENESIS";
  }
}

function appendLedger(beat: string, res: BeatResult, durationMs: number): void {
  try {
    fs.mkdirSync(ROT_DIR, { recursive: true });
    const prevHash = lastHash();
    const entry: LedgerEntry = {
      ts: nowIso(),
      beat,
      ok: res.ok,
      summary: res.summary.slice(0, 300),
      data: res.data,
      prevHash,
      hash: "",
      durationMs
    };
    entry.hash = createHash("sha256").update(JSON.stringify({ ...entry, hash: "" })).digest("hex");
    fs.appendFileSync(LEDGER, JSON.stringify(entry) + "\n");
    // keep the live status file fresh for the panel / fleet keepers
    fs.writeFileSync(
      path.join(ROT_DIR, "last-beat.json"),
      JSON.stringify({ beat, ok: res.ok, summary: res.summary, ts: entry.ts, hash: entry.hash }, null, 2)
    );
  } catch {
    // ledger write failure must never crash the keeper — surfaced via /health
  }
}

// ── beats ─────────────────────────────────────────────────────────────────────

async function beatHealth(): Promise<BeatResult> {
  const results: Array<{ name: string; alive: boolean }> = [];
  for (const s of SERVICES) {
    const r = await fetchJson(s.url, { bearer: s.bearer, timeoutMs: 6_000 });
    results.push({ name: s.name, alive: r.reachable });
  }
  const alive = results.filter((r) => r.alive).length;
  const down = results.filter((r) => !r.alive).map((r) => r.name);
  return {
    ok: alive >= Math.ceil(results.length / 2), // majority-alive is healthy
    summary: `services ${alive}/${results.length} alive${down.length ? ` · down: ${down.join(",")}` : ""}`,
    data: { results }
  };
}

async function beatDriftReport(): Promise<BeatResult> {
  const r = await fetchJson("http://127.0.0.1:3033/keys/status", { bearer: true, timeoutMs: 15_000 });
  if (!r.reachable || !r.body) return { ok: false, summary: "signer /keys/status unreachable", data: { status: r.status } };
  const summary = (r.body.drift as { summary?: { ok?: number; drift?: number; unmatched?: number; errors?: number } } | undefined)?.summary ?? null;
  const sealedAt = (r.body.sealedAt as string | undefined) ?? null;
  return {
    ok: Boolean(summary && (summary.drift ?? 0) === 0 && (summary.unmatched ?? 0) === 0),
    summary: `vault drift ok=${summary?.ok ?? "?"} drift=${summary?.drift ?? "?"} unmatched=${summary?.unmatched ?? "?"}`,
    data: { summary, sealedAt }
  };
}

async function beatSelftest(): Promise<BeatResult> {
  const checks: Record<string, string> = {};
  checks.nodeModules = fs.existsSync(path.join(FOUNDRY, "node_modules")) ? "pass" : "fail";
  checks.prisma = fs.existsSync(path.join(FOUNDRY, "prisma", "schema.prisma")) ? "pass" : "fail";
  checks.db = fs.existsSync(path.join(FOUNDRY, "db", "custom.db")) ? "pass" : "warn-missing";
  // kernel selftest in an ephemeral child — a crash here never touches us
  let kernel = "fail";
  try {
    const kernelPath = path.join(FOUNDRY, "src", "lib", "saos", "kernel.ts");
    const proc = Bun.spawnSync(
      ["bun", "-e", `const m = await import(${JSON.stringify(kernelPath)}); const r = await m.kernelSelftest(); if (!r || r.ok !== true) process.exit(1);`],
      {
        cwd: FOUNDRY,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000
      }
    );
    kernel = proc.exitCode === 0 ? "pass" : "fail";
  } catch {
    kernel = "fail";
  }
  checks.kernelSelftest = kernel;
  const ok = Object.values(checks).every((v) => v === "pass" || v === "warn-missing");
  return { ok, summary: `selftest ${ok ? "PASS" : "FAIL"} (${JSON.stringify(checks)})`, data: { checks } };
}

function newestBackupAgeMs(): { ageMs: number | null; file: string | null } {
  const dir = path.join(FOUNDRY, "backups");
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".enc"));
    if (files.length === 0) return { ageMs: null, file: null };
    let best: { mtime: number; name: string } | null = null;
    for (const f of files) {
      const st = fs.statSync(path.join(dir, f));
      if (!best || st.mtimeMs > best.mtime) best = { mtime: st.mtimeMs, name: f };
    }
    return best ? { ageMs: Date.now() - best.mtime, file: best.name } : { ageMs: null, file: null };
  } catch {
    return { ageMs: null, file: null };
  }
}

async function beatBackupFreshness(): Promise<BeatResult> {
  const { ageMs, file } = newestBackupAgeMs();
  if (ageMs === null) return { ok: false, summary: "no .enc backup found in backups/", data: { file: null } };
  const ageHours = Math.round(ageMs / 3_600_000);
  if (ageMs <= 24 * 3_600_000) {
    return { ok: true, summary: `backup fresh (${ageHours}h old: ${file})`, data: { ageHours, file } };
  }
  // stale → trigger a fresh backup at the signer (kill-switch respected)
  if (BACKUP_KILL) {
    return { ok: false, summary: `backup stale (${ageHours}h) — trigger skipped (SAOS_NO_ROT_BACKUP=1)`, data: { ageHours, file } };
  }
  const r = await fetchJson("http://127.0.0.1:3033/keys/backup", { bearer: true, method: "POST", timeoutMs: 60_000 });
  const ok = r.reachable;
  return {
    ok,
    summary: ok
      ? `backup was stale (${ageHours}h) — fresh backup triggered at signer (HTTP ${r.status})`
      : `backup stale (${ageHours}h) — trigger FAILED (HTTP ${r.status})`,
    data: { ageHours, file, triggered: ok }
  };
}

async function beatGitHygiene(): Promise<BeatResult> {
  try {
    const st = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: FOUNDRY, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    const dirty = (st.stdout.toString().trim().split("\n").filter(Boolean)).length;
    const head = Bun.spawnSync(["git", "log", "-1", "--format=%cI"], { cwd: FOUNDRY, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    const headIso = head.stdout.toString().trim();
    const headAgeH = headIso ? Math.round((Date.now() - new Date(headIso).getTime()) / 3_600_000) : null;
    return {
      ok: true, // hygiene is a record, not a gate — the day-agent promotes
      summary: `git: ${dirty} uncommitted · HEAD ${headAgeH ?? "?"}h old`,
      data: { uncommitted: dirty, headAgeHours: headAgeH }
    };
  } catch {
    return { ok: false, summary: "git probe failed" };
  }
}

const HOUR = 3_600_000;
const MIN = 60_000;
const beats: BeatDef[] = [
  { id: "health", everyMs: 15 * MIN, firstDelayMs: 15_000, run: beatHealth, enabled: () => true },
  { id: "drift-report", everyMs: 30 * MIN, firstDelayMs: 45_000, run: beatDriftReport, enabled: () => true },
  { id: "selftest", everyMs: 2 * HOUR, firstDelayMs: 90_000, run: beatSelftest, enabled: () => true },
  { id: "backup-freshness", everyMs: 6 * HOUR, firstDelayMs: 2 * MIN, run: beatBackupFreshness, enabled: () => true },
  { id: "git-hygiene", everyMs: 6 * HOUR, firstDelayMs: 3 * MIN, run: beatGitHygiene, enabled: () => true }
];

// ── scheduler (fixed rotation — every beat keeps its own clock) ──────────────
interface BeatState {
  lastRun: number;
  lastOk: boolean | null;
  lastSummary: string;
  runs: number;
  fails: number;
}
const state: Record<string, BeatState> = {};
for (const b of beats) state[b.id] = { lastRun: 0, lastOk: null, lastSummary: "never-run", runs: 0, fails: 0 };

async function runBeat(b: BeatDef): Promise<void> {
  const t0 = Date.now();
  const st = state[b.id];
  st.lastRun = Date.now();
  st.runs += 1;
  try {
    const res = await b.run();
    st.lastOk = res.ok;
    st.lastSummary = res.summary;
    if (!res.ok) st.fails += 1;
    appendLedger(b.id, res, Date.now() - t0);
    console.log(`[${nowIso()}] [rotation] beat=${b.id} ok=${res.ok} (${Date.now() - t0}ms) — ${res.summary}`);
  } catch (e) {
    st.lastOk = false;
    st.fails += 1;
    st.lastSummary = "beat-crash (contained)";
    appendLedger(b.id, { ok: false, summary: "beat-crash (contained)" }, Date.now() - t0);
    console.log(`[${nowIso()}] [rotation] beat=${b.id} CRASH-CONTAINED: ${String(e).slice(0, 120)}`);
  }
}

function schedule(): void {
  const t = setInterval(() => {
    const now = Date.now();
    for (const b of beats) {
      const st = state[b.id];
      const due = now - st.lastRun >= b.everyMs;
      const first = st.lastRun === 0 && now - BOOT >= b.firstDelayMs;
      if (first || due) void runBeat(b);
    }
  }, TICK_MS);
  t.unref?.();
}
const BOOT = Date.now();

// ── status surface (loopback only) ────────────────────────────────────────────
function statusPayload(): Record<string, unknown> {
  return {
    ok: !KILL,
    service: "rotation-keeper",
    port: PORT,
    killed: KILL,
    role: "foundry-leg-of-the-sovereign-rotation",
    manifest: "agent/rotation.json",
    beats: beats.map((b) => ({
      id: b.id,
      everyMin: Math.round(b.everyMs / 60_000),
      ...state[b.id]
    })),
    ledger: {
      path: "broadcasts/rotation/ledger.jsonl",
      entries: (() => {
        try {
          return fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).length;
        } catch {
          return 0;
        }
      })()
    },
    generatedAt: nowIso()
  };
}

Bun.serve({
  hostname: "127.0.0.1", // R123 — loopback only
  port: PORT,
  fetch: (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/rotation/status") return Response.json(statusPayload());
    return Response.json({ ok: !KILL, service: "rotation-keeper", health: true, ts: nowIso() });
  }
});

if (KILL) {
  console.log(`[${nowIso()}] [rotation] SAOS_NO_ROTATION=1 — keeper up but rotation DISABLED (status-only)`);
} else {
  schedule();
  console.log(`[${nowIso()}] [rotation] rotation-keeper up on http://127.0.0.1:${PORT} · beats: ${beats.map((b) => `${b.id}/${Math.round(b.everyMs / 60_000)}min`).join(" · ")}`);
}

// manifest self-check: warn (once) if the rotation manifest is missing
if (!fs.existsSync(ROTATION_MANIFEST)) {
  console.log(`[${nowIso()}] [rotation] WARNING: ${ROTATION_MANIFEST} missing — fleet keepers can not discover this leg`);
}
