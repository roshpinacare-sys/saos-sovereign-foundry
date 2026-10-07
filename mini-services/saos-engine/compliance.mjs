/**
 * compliance.mjs — R232 · טלמטריית-ציות הצי (ההמשך הישיר של R231).
 *
 * R231 פרסם את החוזה (saos.fleet.coordination.v1 על-השרשרת). R232 מודד
 * באמת-שרשרת האם הפעילות בפועל נחתה בתוך החלונות: פוסטים/הצבעות/תגובות
 * של כל אחד מ-14 החשבונות מושווים ללו"ז הדטרמיניסטי שאותו יום.
 *
 * שאלת-המפעיל שהמודול עונה עליה כל-יום:
 *   "האם החותם-השני אימץ את החוזה — או עדיין מפרסם צפוף?"
 *
 * מדידות (כולן קריאות-פומביות, אמת-שרשרת, אפס-המצאות):
 *   1. ציות-חלונות — לכל פעולה, המרחק המעגלי לחלון-המתוכנן של אותו סוג;
 *      בתוך סבלנות 30 דק = בחלון. ציות = בחלון/סך-הפעולות.
 *   2. צפיפות — קלאסטרים-עצמיים (פער <5 דק בין פעולות-עצמיות) + הפרץ
 *      הצפוף ביותר של הצי כולו (חלון-הזזה 30 דק) — "הם עדיין מפרסמים צפוף"
 *      נמדד כאן, לא נאמד.
 *   3. פסק-דין-צי — ADOPTED (ממוצע ≥80) · PARTIAL (≥40) · NOT-ADOPTED (<40)
 *      · QUIET (אפס פעילות — היום עדיין שקט, לא-ציות ולא-הפרה).
 *
 * הליבה הפורית (complianceFromActions) נבדקת-וקטורים ב-selftest — אפס-רשת.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { FLEET_ROSTER, buildSchedule, hhmm } from "./coordination.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "compliance.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

export const TOLERANCE_MIN = 30;   // "בחלון" = מרחק מעגלי ≤30 דק מהחלון-המתוכנן
export const DENSITY_GAP_MIN = 5;  // פער <5 דק בין פעולות-עצמיות = קלאסטר-צפוף
export const BURST_WINDOW_MIN = 30;

/* ── pure time helpers (selftest-vectorable, zero network) ───────────── */
export function minuteOfUtc(ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t / 60000) % 1440);
}

/** pure: circular minutes-of-day distance (0..720) */
export function circDistMin(a, b) {
  const d = Math.abs(((a - b) % 1440 + 1440) % 1440);
  return d > 720 ? 1440 - d : d;
}

/* ── pure core: actions vs schedule (the selftested law) ─────────────── */
/**
 * pure: score actions against the day schedule.
 * actions: [{acc, kind: "post"|"vote"|"comment", minute, ts}]
 * schedule: buildSchedule(day) shape {acc: {post, votes[], engage}}
 * returns { rows, summary } — rows include per-account compliance and
 * self-density clusters; summary carries the fleet burst + verdict.
 */
export function complianceFromActions(actions, schedule, {
  tolMin = TOLERANCE_MIN, densityGapMin = DENSITY_GAP_MIN, burstWindowMin = BURST_WINDOW_MIN,
} = {}) {
  const roster = Object.keys(schedule ?? {});
  const byAcc = new Map();
  for (const a of roster) byAcc.set(a, []);
  for (const a of (Array.isArray(actions) ? actions : [])) {
    if (!byAcc.has(a.acc) || !Number.isFinite(a.minute)) continue;
    const kind = a.kind === "post" || a.kind === "vote" || a.kind === "comment" ? a.kind : null;
    if (!kind) continue;
    byAcc.get(a.acc).push({ kind, minute: a.minute, ts: a.ts ?? null });
  }

  const rows = roster.map((acc) => {
    const sched = schedule[acc] ?? { post: null, votes: [], engage: null };
    const mine = (byAcc.get(acc) ?? []).slice().sort((x, y) => x.minute - y.minute);
    let total = 0, inWindow = 0;
    const misses = [];
    for (const act of mine) {
      const wins = act.kind === "post" ? [sched.post]
        : act.kind === "comment" ? [sched.engage]
        : (sched.votes ?? []);
      const valid = (wins ?? []).filter((w) => Number.isFinite(w));
      if (!valid.length) continue; // no window of this kind scheduled — not scored
      total++;
      let bestWin = valid[0], bestDist = circDistMin(act.minute, valid[0]);
      for (const w of valid.slice(1)) {
        const d = circDistMin(act.minute, w);
        if (d < bestDist) { bestDist = d; bestWin = w; }
      }
      if (bestDist <= tolMin) inWindow++;
      else misses.push({ kind: act.kind, at: hhmm(act.minute), nearest: hhmm(bestWin) });
    }
    // self-density: consecutive own actions closer than the gap
    let clusters = 0;
    for (let i = 1; i < mine.length; i++) {
      const gap = circDistMin(mine[i].minute, mine[i - 1].minute);
      if (gap < densityGapMin) clusters++;
    }
    const compliancePct = total > 0 ? Math.round((inWindow / total) * 100) : null;
    return {
      acc, total, inWindow, compliancePct, clusters, misses: misses.slice(0, 4),
      verdict: total === 0 ? "NO-ACTIVITY" : compliancePct >= 80 ? "COMPLIANT" : compliancePct >= 40 ? "PARTIAL" : "OFF-SCHEDULE",
    };
  });

  // fleet burst: max actions in any sliding window (the "dense publishing" meter)
  const all = (Array.isArray(actions) ? actions : [])
    .filter((a) => Number.isFinite(a.minute)).map((a) => a.minute).sort((x, y) => x - y);
  let burst = 0, burstAt = null;
  for (let i = 0; i < all.length; i++) {
    let j = i;
    while (j < all.length && circDistMin(all[j], all[i]) <= burstWindowMin) j++;
    if (j - i > burst) { burst = j - i; burstAt = hhmm(all[i]); }
  }

  const scored = rows.filter((r) => r.compliancePct != null);
  const avgCompliancePct = scored.length
    ? Math.round((scored.reduce((s, r) => s + r.compliancePct, 0) / scored.length) * 10) / 10
    : null;
  const totalActions = rows.reduce((s, r) => s + r.total, 0);
  const verdict = totalActions === 0 ? "QUIET"
    : avgCompliancePct >= 80 ? "ADOPTED"
    : avgCompliancePct >= 40 ? "PARTIAL"
    : "NOT-ADOPTED";
  return {
    rows, summary: {
      accounts: roster.length, accountsActive: scored.length, totalActions,
      avgCompliancePct, densestBurst: burst, burstAt,
      clusterViolations: rows.reduce((s, r) => s + r.clusters, 0),
      verdict,
    },
  };
}

/* ── chain extraction (bounded, public reads) ────────────────────────── */
/** extract today's post/vote/comment actions for one account from history */
export async function extractAccountActions(acc, day, { limit = 250 } = {}) {
  const r = await rpcCall("condenser_api.get_account_history", [acc, -1, limit]);
  if (!r.ok) return { ok: false, actions: [] };
  const actions = [];
  for (const [, ev] of (r.result ?? [])) {
    const ts = ev?.timestamp ? `${ev.timestamp}Z` : null;
    if (!ts || String(ts).slice(0, 10) !== day) continue;
    const [opType, op] = ev?.op ?? [];
    if (opType === "vote" && op?.voter === acc) {
      actions.push({ acc, kind: "vote", minute: minuteOfUtc(ts), ts });
    } else if (opType === "comment" && op?.author === acc) {
      actions.push({ acc, kind: op?.parent_author ? "comment" : "post", minute: minuteOfUtc(ts), ts });
    }
  }
  return { ok: true, actions };
}

/* ── state + runner ──────────────────────────────────────────────────── */
export function complianceState() { return readJson(FILE, null); }

/** full compliance refresh — cadence-gated 30min inside the cycle (force to bypass) */
export async function runCompliance({ now = new Date().toISOString(), force = false } = {}) {
  const day = String(now).slice(0, 10);
  const prev = readJson(FILE, null);
  if (!force && prev?.day === day && prev?.at) {
    const age = Date.now() - Date.parse(prev.at);
    if (Number.isFinite(age) && age < 30 * 60_000) {
      return { ...prev, verdict: prev.summary?.verdict ?? "CACHED", cadence: "GATED-30MIN" };
    }
  }
  const t0 = Date.now();
  const schedule = buildSchedule(day);
  const roster = FLEET_ROSTER.map((a) => a.name);
  const actions = [];
  const readFails = [];
  for (const acc of roster) {
    try {
      const r = await extractAccountActions(acc, day);
      if (r.ok) actions.push(...r.actions); else readFails.push(acc);
    } catch { readFails.push(acc); }
  }
  const { rows, summary } = complianceFromActions(actions, schedule);
  const doc = {
    protocol: "saos.fleet.compliance.v1", day, at: now,
    scheduleHint: `${roster.length} accounts × (post+2vote+engage) · tol ${TOLERANCE_MIN}min`,
    rows, summary, readFails,
    note: "ציות = הפעולה בפועל נחתה בתוך חלון-הלו\"ז הדטרמיניסטי (אותו יום, אותו חוק). QUIET = עדיין אין פעילות-היום — לא-ציות ולא-הפרה.",
    ms: Date.now() - t0,
  };
  writeJson(FILE, doc);
  return { ...doc, cadence: "MEASURED" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCompliance({ force: true }).then((r) => {
    console.log(JSON.stringify({ day: r.day, summary: r.summary, ms: r.ms }, null, 2));
    process.exit(0);
  }).catch((e) => { console.error("COMPLIANCE-FAIL", e); process.exit(1); });
}
