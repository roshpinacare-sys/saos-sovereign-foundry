/**
 * economics.mjs — T-21 · THE MULTI-RAIL ECONOMICS ROLLUP
 * ("מערך-כלכלי מדומה → להתחיל להריץ ולהפוך לערך אמיתי").
 * The operator asked the simulated economic array to start RUNNING and to
 * be converted, step by step, into real value. The honest form of that is
 * ONE measured rollup of every rail the machine actually runs, each labeled
 * measured | estimated | blocked with its own evidence note — measured and
 * estimated totals NEVER merge (the honesty contract, enforced in the pure
 * core aggregateRails, lib.mjs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { aggregateRails } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ECON_FILE = path.join(STATE, "economics.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

export function runEconomics(now = new Date().toISOString()) {
  const observe = readJson(path.join(STATE, "observe.json"), null);
  const market = readJson(path.join(STATE, "market.json"), null);
  const convert = readJson(path.join(STATE, "convert-plan.json"), null);
  const hyper = readJson(path.join(STATE, "hyper-grid.json"), null);
  const daily = readJson(path.join(STATE, "daily-report.json"), null);
  const discovery = readJson(path.join(STATE, "discovery.json"), null);
  const conf = readJson(path.join(DIR, "..", "..", ".secrets", "exec-armed.json"), null)
    ?? readJson(path.join(STATE, "exec-armed-doctrine.json"), null);

  const parity = observe?.parity?.parity ?? null;
  const sbdUsd = observe?.parity?.sbdUsd ?? null;
  const steemUsd = observe?.parity?.steemUsd ?? null;

  /* realized trading: measured by pnlFromFills over the observable fill
   * window; per-day normalization waits for fill-timestamp windows (honest) */
  const realizedSbd = daily?.rollup?.realizedSbd ?? null;

  const curationEst = (discovery?.opportunities ?? []).find((o) => o.id === "curation-share")?.potential ?? null;

  const out = aggregateRails({
    realizedSbdTotal: realizedSbd,
    realizedWindowDays: null,
    sbdUsd, steemUsd, parity,
    curationEstSteemPerDay: curationEst,
    convertEdgeBps: convert?.edgeBps ?? null,
    convertAmountSbd: convert?.amountSbd ?? null,
    convertVerdict: convert?.verdict ?? null,
    promoPostsPerDay: conf?.promo?.perDay ?? null,
    promoEstUsdPerPost: null,
    fuelUsdPerDay: observe?.fuel?.fuelUsdPerDay ?? null,
    hyperOpsPerDay: hyper?.economics?.opsPerDay ?? null,
    fillsToday: observe?.fills ?? null,
    marketFillsPerDay: market?.tradesPerDay ?? null,
  });

  const doc = {
    ...out,
    asof: now,
    context: {
      venueFillsPerDay: market?.tradesPerDay ?? null,
      venueVolSteem24h: market?.volSteem ?? null,
      ourFillsObservable: observe?.fills ?? null,
      scalingLaw: "ops/day ∝ RC ∝ SP — ההון-החכם מכפיל את התקרה, לא את הקוד",
    },
    pid: process.pid,
  };
  writeJson(ECON_FILE, doc);
  return doc;
}

export function economicsState() {
  return readJson(ECON_FILE, null);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runEconomics(), null, 2));
}
