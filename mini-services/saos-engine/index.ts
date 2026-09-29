/**
 * index.ts — SAOS sovereign engine HTTP service (port 3040).
 * T-12: master credential is ENGINE-HELD (operator's standing order) —
 * signing is doctrine-capped in signer.mjs; credentials never leave memory;
 * every broadcast is journaled with txids (never keys).
 */
import { runCycle } from "./daily.mjs";
import { externalParity, internalFeed, accountState, openOrders, measureAll } from "./measure.mjs";
import { execStatus } from "./signer.mjs";
import { soldiersPublic } from "./soldiers.mjs";
import { intelState } from "./intel.mjs";
import { curatorState } from "./curator.mjs";
import { learningState } from "./learning.mjs";
import { discoveryState } from "./discovery.mjs";
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = 3040;
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const readLines = (p, n = 20) => {
  try {
    return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 120) }; } });
  } catch { return []; }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function handle(req) {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/health") return json({ ok: true, service: "saos-engine", account: ACCOUNT, at: new Date().toISOString(), keyless: false, doctrine: "capped-autonomy" });
  if (p === "/status") {
    const execLog = (() => { try { return fs.readFileSync(path.join(STATE, "exec-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).slice(-8).map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 80) }; } }); } catch { return []; } })();
    let exec = null;
    try { exec = await execStatus(); } catch (e) { exec = { ok: false, reason: String(e?.message ?? e).slice(0, 80) }; }
    return json({
      ok: true, at: new Date().toISOString(), account: ACCOUNT,
      observe: readJson(path.join(STATE, "observe.json")),
      state: readJson(path.join(STATE, "state.json")),
      offer: readJson(path.join(STATE, "offer.json")),
      convertPlan: readJson(path.join(STATE, "convert-plan.json")),
      daily: readJson(path.join(STATE, "daily-report.json")),
      intel: intelState(),
      curator: curatorState(),
      learning: learningState(),
      discovery: discoveryState(),
      soldiers: soldiersPublic(),
      execution: exec,
      execLog,
      events: readLines(path.join(STATE, "events.jsonl"), 20),
      notes: ["sovereign engine · state lives inside my-project · master credential engine-held, doctrine-capped, never logged", "T-14: continuous-learning layer live — lessons from recorded history, hard-clamped tunings, growth-option discovery"],
    });
  }
  if (p === "/cycle") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const r = await runCycle();
    return json(r);
  }
  if (p === "/live") {
    try {
      const [par, feed, acc, oo] = await Promise.all([externalParity(), internalFeed(), accountState(ACCOUNT), openOrders(ACCOUNT)]);
      return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, parity: par, feed, account_state: acc, orders: oo.orders });
    } catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, 502); }
  }
  if (p === "/fills") {
    const meas = await measureAll(ACCOUNT);
    return json({ ok: meas.ok, at: new Date().toISOString(), account: ACCOUNT, ...meas });
  }
  if (p === "/exec-status") {
    try { return json({ ok: true, at: new Date().toISOString(), ...(await execStatus()) }); }
    catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
  }
  return json({ ok: false, error: "not-found", routes: ["/health", "/status", "/cycle", "/live", "/fills", "/exec-status"] }, 404);
}

// T-11: הרמה-עמידה — אם הפורט עדיין תפוס (תהליך-קודם גוסס / TIME_WAIT) מנסים שוב לפני כניעה
let bound = false;
for (let attempt = 1; attempt <= 8 && !bound; attempt++) {
  try {
    Bun.serve({
      port: PORT,
      fetch: (req) => handle(req),
      // T-14 root-cause fix (proven in engine.log): Bun's default idleTimeout
      // is 10s — a full cycle takes 10-12s, so the connection was killed
      // mid-cycle and the sovereign got "fetch failed" (1 real cycle fall).
      // 255s = Bun max; doctrine timeout (90s sovereign, 18s exec client)
      // still bounds every caller from the outside.
      idleTimeout: 255,
    });
    bound = true;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (attempt === 8 || !/EADDRINUSE|address already in use/i.test(msg)) throw e;
    console.log(`bind attempt ${attempt} failed (${msg}) — retrying in 1.5s`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

console.log(`saos-engine listening on :${PORT} (keyless, account=${ACCOUNT})`);
