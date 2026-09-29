/**
 * index.ts — SAOS sovereign-local engine HTTP service (port 3040).
 * Keyless: reads public chain/market data, writes local state, runs cycles.
 * NEVER holds or signs with keys — execute step is operator-gated by design.
 */
import { runCycle } from "./daily.mjs";
import { externalParity, internalFeed, accountState, openOrders, measureAll } from "./measure.mjs";
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

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/health") return json({ ok: true, service: "saos-engine", account: ACCOUNT, at: new Date().toISOString(), keyless: true });
    if (p === "/status") {
      return json({
        ok: true, at: new Date().toISOString(), account: ACCOUNT,
        observe: readJson(path.join(STATE, "observe.json")),
        state: readJson(path.join(STATE, "state.json")),
        offer: readJson(path.join(STATE, "offer.json")),
        convertPlan: readJson(path.join(STATE, "convert-plan.json")),
        daily: readJson(path.join(STATE, "daily-report.json")),
        events: readLines(path.join(STATE, "events.jsonl"), 20),
        notes: ["keyless sovereign-local engine · state lives inside my-project · zero repo dependency"],
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
    return json({ ok: false, error: "not-found", routes: ["/health", "/status", "/cycle", "/live", "/fills"] }, 404);
  },
});

console.log(`saos-engine listening on :${PORT} (keyless, account=${ACCOUNT})`);
