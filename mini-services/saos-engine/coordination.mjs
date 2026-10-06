/**
 * coordination.mjs — R231 · מרכז-תיאום הצי (המענה להוראת-המפעיל 2026-10-06).
 *
 * המדידה שקדמה לקוד (אמת-שרשרת, 2026-10-06T20:10-20:56Z):
 *   - החותם-השני משדר את הצבא: 4 פוסטים בתוך 90 שניות (macrame 20:10:51 →
 *     tov 20:11:21 → wic 20:11:45 → woq 20:12:24) + הצבעות בדחיפות דומה
 *   - headcorner (המסלול שלנו) ב-VP 5.1% — מנוחת VP-FLOOR חוקית
 *   - שיחות בין-חשבוניות קיימות אורגנית אך לא מתוכננות
 *
 * מה המרכז עושה:
 *   1. לו"ז מפוזר דטרמיניסטי — כל חשבון נכנס בזמן אחר (post + votes + engage
 *      windows), מרווח מינימום בין-חשבוני; מחושב מ-hash(חשבון+יום) — שני
 *      הכותבים שמריצים את אותה החוק מקבלים את אותו הלו"ז (תיאום בלי-אמון).
 *   2. חוק-הצבעות לפי מצב-כוח — VP/RC נקראים חי מהשרשרת (קריאות פומביות,
 *      ללא חזקות): משקל גבוה כשהסוללה מלאה (שלא יבזבזו כוח), הפחתה
 *      בהתרוקנות, מנוחה מתחת לרצפה; רצפת RC נפרדת.
 *   3. מטריצת-שיחות — הפוסטים שלנו × מי כבר הגיב; פערים = משימות-תגובה
 *      לחלונות-השיחה ("יעבור על הפוסטים שלנו ויגיב לכולם"), קיורציה
 *      קרוס-ציית (כל אחד מצביע לרעהו בזמנו לפי יכולת-הכוח שלו).
 *   4. מנשר-תיאום ציבורי — saos.fleet.coordination.v1 כ-custom_json חתום
 *      (posting authority): החוזה המכונה-קריא שהחותם-השני (וכל סוכן עתידי)
 *      יכול לאמץ. זהו "תנסה לתאם איתם" בפועל — השרשרת עצמה היא ערוץ-התיאום.
 *
 * כל-הקריאות פומביות (אין-חזקות במדידה); השידור היחיד הוא custom_json
 * ללא-כל-תזוזת-כספים, דוקטרינה-חסומה (day-cap + pause + armed-conf).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, execPaused, loadCredential } from "./signer.mjs";
import { trendsState } from "./trends.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "coordination.json");
export const PROTOCOL = "saos.fleet.coordination.v1";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

/* ── the fleet roster (the ONE body, all 14) ─────────────────────────── */
export const FLEET_ROSTER = [
  { name: "headcorner", kind: "master", lane: "zai" },
  ...["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"]
    .map((name) => ({ name, kind: "army", lane: "second-signer" })),
  ...["hcsoldier1", "hcsoldier2", "hcsoldier3"].map((name) => ({ name, kind: "soldier", lane: "zai" })),
];
const FLEET_NAMES = FLEET_ROSTER.map((a) => a.name);

/* ── pure schedule law (deterministic, selftestable, zero network) ────── */
export function hashSeed(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** pure: the day's staggered schedule — minutes-of-day per account.
 * Each account: 1 post window + 2 vote windows + 1 engage window.
 * Deterministic relaxation: seeded picks → sorted → push-forward walk that
 * keeps ≥minGapMin between ANY two fleet windows. Same day key ⇒ same
 * schedule on every machine (the public law both signers compute). */
export function buildSchedule(day, { minGapMin = 20 } = {}) {
  const DAY = 24 * 60;
  const picks = [];
  for (const acc of FLEET_NAMES) {
    const kinds = [["post", 1], ["vote", 2], ["engage", 1]];
    for (const [kind, n] of kinds) {
      for (let i = 0; i < n; i++) {
        const seed = hashSeed(`${acc}|${kind}|${i}|${day}`);
        picks.push({ acc, kind, i, minute: seed % DAY });
      }
    }
  }
  // deterministic relaxation: stable sort by minute, then a single forward
  // walk pushing each window to keep the gap (wraps under DAY cap)
  picks.sort((a, b) => (a.minute - b.minute) || a.acc.localeCompare(b.acc) || a.kind.localeCompare(b.kind));
  let prev = -Infinity;
  for (const p of picks) {
    let m = Math.max(p.minute, prev + minGapMin);
    if (m >= DAY) m = p.minute % Math.max(minGapMin, Math.floor(DAY / picks.length)); // overflow → deterministic wrap spread
    p.minute = m;
    prev = m;
  }
  const out = {};
  for (const acc of FLEET_NAMES) out[acc] = { post: null, votes: [], engage: null };
  for (const p of picks) {
    if (p.kind === "post") out[p.acc].post = p.minute;
    else if (p.kind === "vote") out[p.acc].votes.push(p.minute);
    else out[p.acc].engage = p.minute;
  }
  for (const acc of FLEET_NAMES) {
    if (out[acc].post == null) out[acc].post = 0;
    if (out[acc].engage == null) out[acc].engage = 0;
    out[acc].votes.sort((a, b) => a - b);
  }
  return out;
}

/** pure: minutes-of-day → HH:MM (UTC — chain time) */
export function hhmm(minute) {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/* ── pure power law ("הצבעות לפי מצב הכוח — שלא יבזבזו כוח") ─────────── */
export function powerVerdict(vpEff) {
  if (vpEff == null || !Number.isFinite(vpEff)) return { verdict: "VP-UNKNOWN", weightPct: 0, votesPerWindow: 0 };
  if (vpEff >= 80) return { verdict: "READY-FULL", weightPct: 100, votesPerWindow: 1 };
  if (vpEff >= 60) return { verdict: "READY", weightPct: 80, votesPerWindow: 1 };
  if (vpEff >= 30) return { verdict: "REDUCED", weightPct: 50, votesPerWindow: 1 };
  return { verdict: "VP-REST", weightPct: 0, votesPerWindow: 0 };
}
export const RC_FLOOR_PCT = 20;

/** live power board for the whole fleet (public chain reads only) */
export async function powerBoard() {
  const r = await rpcCall("condenser_api.get_accounts", [FLEET_NAMES]);
  if (!r.ok) return { ok: false, error: String(r.error ?? "chain-read-fail").slice(0, 120) };
  const rc = await rpcCall("rc_api.find_rc_accounts", { accounts: FLEET_NAMES }).catch(() => ({ ok: false, result: null }));
  const rcMap = {};
  for (const a of (rc.ok ? rc.result?.rc_accounts ?? [] : [])) rcMap[a.account] = a;
  const accounts = (r.result ?? []).filter(Boolean).map((acc) => {
    const vests = Number(String(acc.vesting_shares ?? "0").split(" ")[0]) || 0;
    const mana = Number(acc.voting_manabar?.current_mana ?? 0);
    const vpEff = vests > 0 ? Math.round((mana / (vests * 1e6)) * 1000) / 10 : null;
    let rcPct = null;
    const rcA = rcMap[acc.name];
    if (rcA) {
      const cur = Number(rcA.rc_manabar?.current_mana ?? 0);
      const max = Number(rcA.rc_manabar?.max_rc ?? 0);
      rcPct = max > 0 ? Math.round((cur / max) * 1000) / 10 : null;
    }
    const law = powerVerdict(vpEff);
    const lowRc = rcPct != null && rcPct < RC_FLOOR_PCT;
    return {
      name: acc.name, sp: Math.round(vests / 1e6 * 100) / 100, vpEff, rcPct,
      verdict: law.verdict, weightPct: law.weightPct,
      lowRc, rcGate: lowRc ? "LOW-RC-HOLD" : null,
      steem: Number(String(acc.balance ?? "0").split(" ")[0]) || 0,
      lastVote: acc.last_vote_time ?? null,
    };
  });
  return { ok: true, accounts, at: new Date().toISOString() };
}

/* ── engagement matrix ("יעבור על הפוסטים שלנו ויגיב לכולם") ──────────── */
export async function engagementMatrix({ nowMs = Date.now(), maxPosts = 12 } = {}) {
  const fleetSet = new Set(FLEET_NAMES);
  const posts = [];
  for (const acc of FLEET_NAMES) {
    try {
      const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acc, limit: 5 }]);
      if (!r.ok) continue;
      for (const p of (r.result ?? [])) {
        const createdMs = p.created ? Date.parse(p.created.endsWith("Z") ? p.created : p.created + "Z") : 0;
        if (!(createdMs > 0) || nowMs - createdMs > 3 * 86400_000) continue; // last 72h only
        posts.push({
          author: p.author, permlink: p.permlink, title: String(p.title ?? "(comment)").slice(0, 90),
          createdMs, children: p.children ?? 0,
          fleetVotes: (p.active_votes ?? []).map((v) => v.voter).filter((v) => fleetSet.has(v)),
          fleetRepliers: [],
        });
      }
    } catch { /* per-account fail-isolated */ }
  }
  // dedupe (reblogs put the same post under several blogs)
  const seen = new Map();
  for (const p of posts) { const k = `${p.author}/${p.permlink}`; if (!seen.has(k)) seen.set(k, p); }
  const uniq = [...seen.values()].sort((a, b) => b.createdMs - a.createdMs).slice(0, maxPosts);
  // bounded reply scan: only fresh posts (≤48h) — the developing-conversation layer
  let replyReads = 0;
  for (const p of uniq) {
    if (nowMs - p.createdMs > 48 * 3600_000 || replyReads >= 10) continue;
    try {
      const rr = await rpcCall("condenser_api.get_content_replies", [p.author, p.permlink]);
      if (rr.ok) p.fleetRepliers = (rr.result ?? []).map((c) => c.author).filter((a) => fleetSet.has(a));
      replyReads++;
    } catch { /* bounded best-effort */ }
  }
  const rows = uniq.map((p) => {
    const engaged = new Set([...p.fleetVotes, ...p.fleetRepliers]);
    const missing = FLEET_NAMES.filter((a) => !engaged.has(a));
    const coverage = Math.round(((FLEET_NAMES.length - missing.length) / FLEET_NAMES.length) * 100);
    const threads = new Set(p.fleetRepliers).size;
    return {
      author: p.author, permlink: p.permlink, title: p.title,
      ageH: Math.round((nowMs - p.createdMs) / 3600_000),
      fleetVotes: p.fleetVotes, fleetRepliers: p.fleetRepliers,
      threads, coveragePct: coverage, missing: missing.slice(0, 14),
      covered: missing.length === 0,
    };
  });
  const avgCoverage = rows.length ? Math.round((rows.reduce((s, r) => s + r.coveragePct, 0) / rows.length) * 10) / 10 : 0;
  const openThreads = rows.reduce((s, r) => s + (r.threads > 0 ? 1 : 0), 0);
  return { ok: true, posts: rows, summary: { posts: rows.length, avgCoveragePct: avgCoverage, fullyCovered: rows.filter((r) => r.covered).length, openThreads } };
}

/** pure: per-account engagement assignment — uncovered-first, thread-develop
 * second, each account takes its slice in ITS OWN window (no clumping) */
export function assignEngagement(rows, schedule, { perWindow = 3 } = {}) {
  const need = [];
  for (const r of rows) {
    if (r.missing.length > 0) {
      need.push({ author: r.author, permlink: r.permlink, title: r.title, kind: "cover-gap", missing: r.missing });
      if (r.fleetRepliers.length > 0 && r.fleetRepliers.length < FLEET_NAMES.length) {
        need.push({ author: r.author, permlink: r.permlink, title: r.title, kind: "develop-thread", involved: r.fleetRepliers });
      }
    }
  }
  const out = {};
  let i = 0;
  for (const acc of FLEET_NAMES) out[acc] = [];
  for (const acc of FLEET_NAMES) {
    const taken = [];
    while (taken.length < perWindow && i < need.length * FLEET_NAMES.length) {
      const task = need[i % Math.max(1, need.length)];
      if (!task) break;
      i++;
      if (task.kind === "cover-gap" && !task.missing.includes(acc)) continue; // only who hasn't engaged
      if (task.kind === "develop-thread" && !task.involved.includes(acc)) continue;
      if (taken.some((t) => t.permlink === task.permlink)) continue; // one task per post per window
      taken.push({ author: task.author, permlink: task.permlink, title: task.title, kind: task.kind });
    }
    out[acc] = taken;
  }
  return out;
}

/* ── state + manifest ─────────────────────────────────────────────────── */
export function coordinationState() { return readJson(FILE, null); }

export function buildManifest({ day, schedule, power, engagement, trends } = {}) {
  const sched = {};
  for (const acc of FLEET_NAMES) {
    sched[acc] = [hhmm(schedule[acc].post), schedule[acc].votes.map(hhmm).join(","), hhmm(schedule[acc].engage)].join("|");
  }
  return {
    v: 1, protocol: PROTOCOL, day, publishedBy: masterAccount(),
    law: {
      gap: "one account enters at a time — no two fleet windows within 20min",
      votes: "per power: VP>=80 weight100 · 60-80 w80 · 30-60 w50 · <30 rest; RC<20% hold broadcasts; per-author cap 1/day; cross-fleet curation each in own vote window",
      engagement: "respond to uncovered fleet posts first, develop open threads; 3 posts max per window (RC budget)",
      trends: "talk tracks come from the measured trend radar — our contexts only",
    },
    scheduleMin: sched,
    powerNow: (power.accounts ?? []).map((a) => ({ n: a.name, vp: a.vpEff, rc: a.rcPct, w: a.weightPct })).filter((a) => a.n),
    engagementNow: engagement.summary ?? null,
    trends: (trends.topics ?? []).slice(0, 3).map((t) => t.topic.slice(0, 120)),
    note: "public contract: any signer holding these accounts adopts this schedule by recomputing it deterministically from the day key; deltas → publish an amendment, never a silent override",
  };
}

/** the ONE broadcast: signed custom_json, posting authority, no funds move */
export async function publishManifest({ now = new Date().toISOString(), force = false } = {}) {
  const conf = armedConf();
  if (conf.coordination?.publish === false) return { ok: false, verdict: "DISABLED-CONF" };
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED" };
  const prev = readJson(FILE, null);
  const day = String(now).slice(0, 10);
  const lastAt = prev?.lastPublish?.at ? Date.parse(prev.lastPublish.at) : 0;
  if (!force && prev?.lastPublish?.day === day) return { ok: false, verdict: "DAY-GATED", lastDay: prev.lastPublish.day };
  if (force && Number.isFinite(lastAt) && Date.now() - lastAt < 30 * 60_000) return { ok: false, verdict: "RATE-GATED-30MIN", lastAt: prev.lastPublish.at };
  loadCredential(); // typed fail before any network signing
  const st = prev?.schedule && prev?.day === day ? prev : await runCoordination({ now, publish: false });
  const manifest = buildManifest({ day, schedule: st.schedule, power: st.power, engagement: st.engagement, trends: st.trends ?? trendsState() ?? {} });
  const json = JSON.stringify(manifest);
  const res = await executeAs(masterAccount(), [[
    "custom_json",
    { required_auths: [], required_posting_auths: [masterAccount()], id: PROTOCOL, json },
  ]], { tag: "coordination-manifest", role: "posting" });
  const published = { day, at: new Date().toISOString(), ok: !!res.ok, verdict: res.verdict ?? null, txid: res.txid ?? null, error: res.error ?? null, bytes: json.length };
  const cur = readJson(FILE, null) ?? st;
  writeJson(FILE, { ...cur, lastPublish: published });
  return { ok: published.ok, published, manifestBytes: json.length };
}

/** the full coordination refresh (day-gated when driven by the cycle) */
export async function runCoordination({ now = new Date().toISOString(), publish = true } = {}) {
  const day = String(now).slice(0, 10);
  const prev = readJson(FILE, null);
  const t0 = Date.now();
  const schedule = buildSchedule(day);
  const power = await powerBoard();
  const engagement = await engagementMatrix({ nowMs: Date.parse(now) });
  const trends = trendsState() ?? { topics: [], fetchedAt: null, verdict: "NOT-RUN-YET" };
  const assignments = engagement.ok ? assignEngagement(engagement.posts, schedule) : {};
  const nowMin = (Date.parse(now) / 60000) % 1440;
  const nextWindows = [];
  for (const p of FLEET_NAMES) {
    const s = schedule[p];
    for (const [kind, m] of [["post", s.post], ...s.votes.map((v, i) => [`vote${i + 1}`, v]), ["engage", s.engage]]) {
      let delta = m - nowMin;
      if (delta < 0) delta += 1440;
      nextWindows.push({ acc: p, kind, at: hhmm(m), inMin: Math.round(delta) });
    }
  }
  nextWindows.sort((a, b) => a.inMin - b.inMin);
  const doc = {
    protocol: PROTOCOL, day, at: now,
    schedule, scheduleNote: "UTC minutes-of-day · deterministic from hash(account|kind|i|day) · gap 20min — שני-הכותבים מחשבים את אותו הלו\"ז",
    power, engagement, assignments,
    trends: { fetchedAt: trends.fetchedAt, verdict: trends.verdict, topics: (trends.topics ?? []).slice(0, 6) },
    nextWindows: nextWindows.slice(0, 12),
    law: {
      stagger: "שכל-אחד יכנס בזמן אחר — מרווח 20 דק בין כל-שני חלונות-צי",
      power: "הצבעות לפי מצב-הכוח: משקל מלא ב-VP≥80, הפחתה מתחת, מנוחה מ-30; רצפת RC 20%",
      engage: "יעבור על הפוסטים שלנו ויגיב לכולם — פערים קודם, פיתוח-שיחות אחר; 3 פוסטים לחלון (תקציב-RC)",
    },
    ms: Date.now() - t0,
  };
  writeJson(FILE, doc);
  let pub = null;
  if (publish) { try { pub = await publishManifest({ now }); } catch (e) { pub = { ok: false, error: String(e?.message ?? e).slice(0, 120) }; } }
  return { ...doc, publish: pub };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCoordination({ now: new Date().toISOString() }).then((r) => {
    console.log(JSON.stringify({ day: r.day, power: r.power?.ok, engagement: r.engagement?.summary, next: r.nextWindows?.slice(0, 6), publish: r.publish }, null, 2));
    process.exit(0);
  }).catch((e) => { console.error("COORDINATION-FAIL", e); process.exit(1); });
}
