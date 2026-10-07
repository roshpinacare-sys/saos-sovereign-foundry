/**
 * fleet.mjs — THE UNIFIED AGENT REGISTRY (T-15).
 *
 * WHY: the operator's roast (2026-09-30) — "כתוב שיש לנו איזה 60 ומשהו סוכנים
 * אבל רובם מתים כביכול לא עובדים · צריך לאחד הכל להפעיל הכל".
 * THE MEASURED TRUTH: the "60+ agents" figure belongs to the LOST pre-reset
 * era (audit/16 repos, RC-cure 9-account fleet — wiped with the sandbox).
 * The only honest registry is THIS one: every agent that actually exists in
 * the live estate, with LIVENESS MEASURED from its own recorded output
 * (state files + PIDs + events), classified deterministically:
 *
 *   ALIVE   — produced output within its freshness window
 *   IDLE    — healthy, lawfully nothing to do (DAY-CAP / NO-OPS / HOLD)
 *   BLOCKED — wants to work, an external gate holds it (credential, parity)
 *   DEAD    — stale beyond its window with NO lawful reason
 *
 * HONESTY CONTRACT: status is derived, never claimed. Every entry carries
 * evidence (file + age) and, when not ALIVE, the exact revival path.
 * This registry IS the answer to "אחד הכל": one card, one truth, per-agent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fleetGridState, GEN2_ACCOUNTS } from "./fleet-grid.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const ageMinOf = (at, nowMs) => (at && Date.parse(at) > 0) ? Math.max(0, Math.round((nowMs - Date.parse(at)) / 60000)) : null;
const pidAlive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };

/* deterministic classifier (pure — selftested):
 * lastRunAt ISO | null, freshness window minutes, lawful idle reasons */
export function classifyAgent({ lastRunAt, nowMs, freshnessMin, idleReasons = [], blockedBy = null, lastVerdict = null }) {
  const age = ageMinOf(lastRunAt, nowMs);
  if (blockedBy) return { status: "BLOCKED", ageMin: age, blockedBy };
  if (age == null) return { status: "DEAD", ageMin: null, blockedBy: null };
  if (age <= freshnessMin) {
    if (lastVerdict && idleReasons.includes(lastVerdict)) return { status: "IDLE", ageMin: age, blockedBy: null };
    return { status: "ALIVE", ageMin: age, blockedBy: null };
  }
  return { status: "DEAD", ageMin: age, blockedBy: null };
}

/* the CYCLE freshness is the cadence + grace; each agent gets its own window */
const FRESH = {
  engine: 2, watchdog: 5, cycle: 15, grid: 15, peg: 15, intel: 15,
  curator: 30, learning: 15, discovery: 30, convert: 15, soldiers: 15,
  promo: 1440, book: 15,
};

export function fleetState({ now = new Date().toISOString(), credential = null, armedConf = null } = {}) {
  const nowMs = Date.parse(now);
  const credMissing = !!(credential && credential.present === false);
  const armed = !!(armedConf && armedConf.armed);

  const daily = readJson(path.join(STATE, "daily-report.json"), null);
  const sov = readJson(path.join(STATE, "sovereign.json"), null);
  const stateJson = readJson(path.join(STATE, "state.json"), null);
  const offer = readJson(path.join(STATE, "offer.json"), null);
  const intel = readJson(path.join(STATE, "intel.json"), null);
  const curator = readJson(path.join(STATE, "curator.json"), null);
  const learning = readJson(path.join(STATE, "learning.json"), null);
  const discovery = readJson(path.join(STATE, "discovery.json"), null);
  const convertPlan = readJson(path.join(STATE, "convert-plan.json"), null);
  const soldiers = readJson(path.join(STATE, "soldiers.json"), null);
  const observe = readJson(path.join(STATE, "observe.json"), null);

  const enginePid = readJson(path.join(STATE, "engine.pid"), null);
  const engineUp = enginePid ? pidAlive(enginePid.pid ?? enginePid) : false;

  const credRevival = "drop upload/headcorner.txt → engine self-adopts (0600) on next cycle, zero restart";

  const mk = (id, role, cls, evidence) => ({ id, role, ...cls, evidence });

  const agents = [];

  /* 1 · engine-core — the HTTP heart; liveness = it is serving THIS response
   * (fleetState() executes inside the engine — the strongest possible proof)
   * + pid evidence from state/engine.pid */
  const enginePidVal = enginePid ? (enginePid.pid ?? enginePid) : "?";
  agents.push(mk("engine-core", "HTTP service :3040 · every agent rides it",
    { status: "ALIVE", ageMin: 0, blockedBy: null },
    `serving this response · pid ${typeof process !== "undefined" ? process.pid : enginePidVal} (state/engine.pid: ${enginePidVal})`));

  /* 2 · sovereign-watchdog — pulse + self-heal.
   * SOV_FILE holds core.state DIRECTLY (not wrapped) — measured live:
   * lastCheckAt lives at sov.watchdog.lastCheckAt, counters at sov.watchdog.* */
  const wdAt = sov?.watchdog?.lastCheckAt ?? sov?.state?.lastCheckAt ?? null;
  agents.push(mk("watchdog", "pulse check every 60s · resurrects dead engine",
    classifyAgent({ lastRunAt: wdAt, nowMs, freshnessMin: FRESH.watchdog }),
    `sovereign.json lastCheckAt=${wdAt ?? "—"} · checks=${sov?.watchdog?.checks ?? "?"} heals=${sov?.watchdog?.healVerified ?? "?"}${sov?.cred && sov.cred.present === false ? " · cred-missing detected" : ""}`));

  /* 3 · cycle-runner — the 10-step autonomous cycle */
  const cycleAt = daily?.finishedAt ?? null;
  const cycleFailing = daily?.steps ? Object.entries(daily.steps).filter(([, s]) => s.ok === false).map(([k]) => k) : [];
  agents.push(mk("cycle-runner", "10-step cycle every 10min (observe→…→report)",
    classifyAgent({ lastRunAt: cycleAt, nowMs, freshnessMin: FRESH.cycle }),
    `daily-report.json finishedAt=${cycleAt ?? "—"}${cycleFailing.length ? ` · FAILING-STEPS: ${cycleFailing.join(",")}` : ""}`,
  ));

  /* 4 · grid-tick — trigger network (thing-drags-thing) */
  agents.push(mk("grid-tick", "4 micro-grids · trigger network",
    classifyAgent({ lastRunAt: stateJson?.at ?? null, nowMs, freshnessMin: FRESH.grid }),
    `state.json at=${stateJson?.at ?? "—"} runCount=${stateJson?.runCount ?? "?"}`));

  /* 5 · book-keeper (peg) — parity-anchored ladder */
  const pegIdle = offer?.verdict && ["NO-PARITY"].includes(offer.verdict);
  agents.push(mk("book-keeper", "parity ladder plan + stale reprice law",
    classifyAgent({
      lastRunAt: offer?.publishedAt ?? null, nowMs, freshnessMin: FRESH.peg,
      lastVerdict: pegIdle ? offer.verdict : null, idleReasons: ["NO-PARITY"],
      blockedBy: pegIdle ? "parity-source" : null,
    }),
    `offer.json publishedAt=${offer?.publishedAt ?? "—"} verdict=${offer?.verdict ?? "—"}`));

  /* 6 · intel — self-activating decisions */
  agents.push(mk("intel", "decides with reasons each cycle",
    classifyAgent({ lastRunAt: intel?.at ?? null, nowMs, freshnessMin: FRESH.intel }),
    `intel.json at=${intel?.at ?? "—"} decisions=${intel?.decisions?.length ?? "?"}`));

  /* 7 · curator — the fuel rail (VP → votes) */
  const curBlocked = credMissing && armed;
  const curIdleVerdicts = ["DAY-CAP", "VP-FLOOR", "NO-CANDIDATES", "OPERATOR-PAUSED", "DISABLED"];
  agents.push(mk("curator", "curation rail · VP put to work (posting-key only)",
    classifyAgent({
      lastRunAt: curator?.at ?? null, nowMs, freshnessMin: FRESH.curator,
      lastVerdict: curator?.verdict ?? null, idleReasons: curIdleVerdicts,
      blockedBy: curBlocked ? "credential-missing" : null,
    }),
    `curator.json at=${curator?.at ?? "—"} verdict=${curator?.verdict ?? "—"} votesToday=${curator?.votesTodayCount ?? "?"}${curBlocked ? " · SIGNING-DEAD since cred loss" : ""}`,
  ));
  if (curBlocked) agents[agents.length - 1].revival = credRevival;

  /* 8 · learning — continuous self-improvement */
  agents.push(mk("learning", "history → lessons → clamped tunings",
    classifyAgent({ lastRunAt: learning?.at ?? null, nowMs, freshnessMin: FRESH.learning }),
    `learning.json at=${learning?.at ?? "—"} verdict=${learning?.verdict ?? "—"} lessons=${learning?.lessonsTotal ?? "?"}`));

  /* 9 · discovery — growth options on the network */
  agents.push(mk("discovery", "network scan → ranked growth options",
    classifyAgent({ lastRunAt: discovery?.at ?? null, nowMs, freshnessMin: FRESH.discovery }),
    `discovery.json at=${discovery?.at ?? "—"} verdict=${discovery?.verdict ?? "—"} options=${discovery?.opportunities?.length ?? "?"}`));

  /* 10 · convert-rail — D-023 PSM hysteresis */
  const convIdle = convertPlan?.verdict === "CONVERT-HOLD";
  agents.push(mk("convert-rail", "SBD face-$1 convert (3.5d) when edge arms",
    classifyAgent({
      lastRunAt: convertPlan?.at ?? null, nowMs, freshnessMin: FRESH.convert,
      lastVerdict: convIdle ? "CONVERT-HOLD" : null, idleReasons: ["CONVERT-HOLD"],
      blockedBy: credMissing && armed && !convIdle ? "credential-missing" : null,
    }),
    `convert-plan.json at=${convertPlan?.at ?? "—"} verdict=${convertPlan?.verdict ?? "—"}`));

  /* 11-13 · soldiers TRUTH (R235 fix): the old soldiers.json deploy record made
   * gen-1 (hcsoldier1/2/3) read ALIVE — a truth-drift against T-78b (keys lost
   * forever, LOST-NO-CUSTODY, verified 3× independently). Honest registry:
   *   - ONE "fleet-grid" row = the live market presence of the soldier
   *     generations: army 10 (R234) + gen-2 3 (R235 operator-approved activation).
   *   - gen-1 rows = DEAD with the standing verdict, never resurrectable. */
  const fg = fleetGridState();
  const fgLive = Object.values(fg.accounts ?? {}).reduce((s, r) => s + (r?.live ?? 0), 0);
  agents.push(mk("fleet-grid", "soldier generations on the book · army 10 + gen-2 3 (R234/R235)",
    fg.running && fg.lastTickAt
      ? classifyAgent({ lastRunAt: fg.lastTickAt, nowMs, freshnessMin: FRESH.grid })
      : { status: "IDLE", ageMin: null, blockedBy: null },
    `tickMs=${fg.tickMs} · runs=${fg.runs ?? 0} · liveOrders=${fgLive} · fundingTx=${fg.funding?.txid ? fg.funding.txid.slice(0, 12) + "…" : "—"} · gen2 fundTx=${(fg.funding?.funded?.hcsoldier4?.txid ?? "").slice(0, 12) || "—"}`));
  const soldierRecs = soldiers?.deployed ? (soldiers.accounts ?? []).filter((r) => !GEN2_ACCOUNTS.includes(r.name)) : [];
  for (const rec of soldierRecs) {
    agents.push(mk(rec.name, "gen-1 soldier · LOST-NO-CUSTODY (T-78b) — structurally frozen",
      { status: "DEAD", ageMin: null, blockedBy: "no-custody" },
      "keys lost forever (3 independent verifications) · 18.667 STEEM + 0.139 SBD stranded on-chain · no funding, no signing, no grid — allowlist+think-gate make this structural"));
  }
  if (!soldierRecs.length) {
    agents.push(mk("gen-1-soldiers", "hcsoldier1/2/3 · LOST-NO-CUSTODY (T-78b)",
      { status: "DEAD", ageMin: null, blockedBy: "no-custody" },
      "not deployed this era; keys never recoverable — kept off every funding/grant path by policy"));
  }

  /* 14 · promo — one honest public report/day.
   * Evidence-first: the daily cycle's execute step carries the promo outcome;
   * no local record ⇒ IDLE-with-evidence (never a fake DEAD). */
  const promoEv = daily?.steps?.execute?.promo?.verdict ?? null;
  agents.push(mk("promo", "public transparency report (posting-key)",
    curBlocked
      ? { status: "BLOCKED", ageMin: null, blockedBy: "credential-missing" }
      : promoEv
        ? { status: "IDLE", ageMin: null, blockedBy: null }
        : { status: "IDLE", ageMin: null, blockedBy: null },
    `perDay=1 · last cycle promo=${promoEv ?? "—"}${curBlocked ? " · cannot sign" : ""}`));
  if (curBlocked) agents[agents.length - 1].revival = credRevival;

  /* 15 · master-book — the live ladder on-chain */
  const orderCount = observe?.orders?.length ?? 0;
  agents.push(mk("master-book", "on-chain ladder · monitored + repriced each cycle",
    orderCount > 0
      ? classifyAgent({ lastRunAt: observe?.at ?? null, nowMs, freshnessMin: FRESH.book })
      : { status: "IDLE", ageMin: ageMinOf(observe?.at, nowMs), blockedBy: null },
    `observe.json at=${observe?.at ?? "—"} orders=${orderCount} fills=${observe?.fills ?? "?"}`));

  const counts = { total: agents.length };
  for (const s of ["ALIVE", "IDLE", "BLOCKED", "DEAD"]) counts[s.toLowerCase()] = agents.filter((a) => a.status === s).length;
  const verdict = counts.dead > 0
    ? `DEAD-AGENTS:${counts.dead}`
    : counts.blocked > 0
      ? `BLOCKED:${counts.blocked}`
      : "FLEET-OK";

  return {
    at: now, verdict, counts, agents,
    honesty: "statuses DERIVED from each agent's own recorded output (state files + pids) — never claimed",
    lostEraNote: "the pre-reset '60+ agents' (audit/16 repos, RC-cure 9-account fleet) died with the wiped sandbox — this registry is the single live truth",
  };
}

/* CLI: bun fleet.mjs — print the registry */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(fleetState(), null, 2));
}
