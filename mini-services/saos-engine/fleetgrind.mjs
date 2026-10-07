/**
 * fleetgrind.mjs — R236 · גרינד-הצי: 13 חשבונות × (הצבעה + אינטראקציה) ביום.
 *
 * הפער-המבני (R236 audit): צי-הגריד עושה רק הזמנות-שוק (R234/R235), הציות
 * (compliance) נמדד לכל 14 החשבונות אבל החלונות מבוצעים רק למאסטר —
 * תוצאה מדודה: 0% ציות צי. פקודת-מפעיל עומדת: "לוודא שגם החשבונות שלנו
 * הקיימים עושים גריד". המסילה הזו מבצעת: כל חשבון-מפתח (army 10 + gen-2 3,
 * אפוטרופסות-מוכחות מ-.secrets/soldiers.json) מקבל חלון-יומי דטרמיניסטי
 * מפוזר — הצבעה אחת ותגובה אחת לפוסטים קהילתיים.
 *
 * חוק-חשיפה: אף חשבון-צי לא מצביע ולא מגיב לפוסט של חשבון-צי אחר או של
 * המאסטר (אפס-דפוס-ראוי). יעדים מגיעים מ-coordination.engagement.posts
 * (סריקת-קהילה ממודדת).
 *
 * חוקי-ברזל:
 *   · RC רצפה 12% (חוק-הצי של fleet-grid) — HOLD-LOW-RC, לא מסומן-כבוצע.
 *   · חוק-VP (powerVerdict): אותו פס-משקל כמו המאסטר; VP-REST = דילוג-חוקי.
 *   · חלון מפוזר: hash(שם) → דקה 360..1080 UTC — אף-התפרצות-סנכרונית.
 *   · idempotent לפי יום; fail-isolated לכל חשבון; כל פסק נרשם.
 *   · אפס מפתחות ביומן — פסקים בלבד.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, execPaused, loadCredential } from "./signer.mjs";
import { powerVerdict, coordinationState } from "./coordination.mjs";
import { rcPctOf, vpEffOf, composeReply } from "./execute.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "fleet-grind.json");
const EVENTS = path.join(STATE, "events.jsonl");
export const FLEET_GRIND_RC_FLOOR_PCT = 12;
export const GRIND_WINDOW_MIN = 45;
export const GRIND_DAY_START_MIN = 360; // 06:00 UTC — the band starts
/* R237 · catch-up grace: measured live failure — the sandbox froze processes
 * across the 06:12/06:42 windows; on thaw the gate saw them as "not active"
 * and the accounts lost their daily grind forever (WINDOWS-LATER verdict at
 * 09:43 with past windows = dishonest). Law: a window that ended ≤ grace
 * minutes ago with outstanding work still executes (verdict marked catchup). */
export const GRIND_CATCHUP_GRACE_MIN = 240;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };

/* ── pure helpers (selftest-vectorable) ────────────────────────────────── */

/** pure: FNV-1a — deterministic, no deps */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h >>> 0;
}

/** pure: account → its daily window start (minute-of-day, UTC), 360..1080 */
export function grindMinute(name) {
  return GRIND_DAY_START_MIN + (fnv1a(`grind:${name}`) % 720);
}

/** pure: is the window open at this minute (inclusive end) */
export function grindWindowActive(minuteOfDay, offset) {
  return minuteOfDay >= offset && minuteOfDay <= offset + GRIND_WINDOW_MIN;
}

/** pure: R237 — should the account execute now? Active window, or catch-up
 *  grace when the window already passed BUT work is still outstanding
 *  (engine-down/freeze recovery). force bypasses everything. */
export function grindShouldRun(minuteOfDay, offset, rec = {}, force = false, graceMin = GRIND_CATCHUP_GRACE_MIN) {
  if (force) return { run: true, catchup: false };
  if (grindWindowActive(minuteOfDay, offset)) return { run: true, catchup: false };
  const end = offset + GRIND_WINDOW_MIN;
  if (minuteOfDay > end && minuteOfDay <= end + graceMin) {
    if (!rec?.vote || !rec?.engage) return { run: true, catchup: true };
  }
  return { run: false, catchup: false };
}

/** pure: pick vote + engage targets — community only, never fleet-authored, never done */
export function pickGrindTargets(posts, account, fleetSet, doneKeys) {
  const done = doneKeys instanceof Set ? doneKeys : new Set(doneKeys ?? []);
  const fleet = fleetSet instanceof Set ? fleetSet : new Set(fleetSet ?? []);
  const eligible = (Array.isArray(posts) ? posts : [])
    .filter((p) => p && p.author && p.permlink)
    .filter((p) => p.author !== account && !fleet.has(p.author))
    .filter((p) => !done.has(`vote:${p.author}/${p.permlink}`) && !done.has(`engage:${p.author}/${p.permlink}`));
  const vote = eligible[0] ?? null;
  const engage = eligible.length >= 2 ? eligible[1] : null;
  return { vote, engage };
}

/** pure: day-rollover carry — honest, bounded */
export function grindCarried(prev, day) {
  return prev?.day === day ? prev : { day, accounts: {}, at: null };
}

/** pure: R237 — eligible community targets from a raw scan. The engagement
 *  matrix is INTERNAL by design (fleet blogs → cross-fleet coverage) but the
 *  grind's exposure law FORBIDS cross-fleet targets — R236 fed the grind from
 *  the internal matrix → eligible = 0 forever → the rail never fired a single
 *  vote (measured: 0 grind events since birth). Community content is the
 *  grind's real feed. Laws here: non-fleet authors only, deduped, fresh ≤72h. */
export function eligibleCommunity(rows, fleetSet, nowMs, maxAgeMs = 72 * 3600_000) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    if (!p?.author || !p?.permlink) continue;
    if (fleetSet instanceof Set ? fleetSet.has(p.author) : (fleetSet ?? []).includes(p.author)) continue;
    const k = `${p.author}/${p.permlink}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const ms = Number(p.createdMs ?? 0);
    if (!(ms > 0) || nowMs - ms > maxAgeMs) continue;
    out.push(p);
  }
  return out;
}

/** R237: bounded community scan — public discussions by tag (trend tags first,
 *  fallback niche tags), 3 tags × 8 posts, per-tag fail-isolated. */
export async function scanCommunityPosts({ tags = ["life", "steem", "writing"], fleetSet = new Set(), nowMs = Date.now(), perTag = 8 } = {}) {
  const raw = [];
  const clean = (Array.isArray(tags) ? tags : []).filter((t) => typeof t === "string" && t.length > 1).slice(0, 3);
  for (const tag of (clean.length ? clean : ["life", "steem", "writing"])) {
    try {
      const r = await rpcCall("condenser_api.get_discussions_by_created", [{ tag, limit: perTag }]);
      if (!r?.ok) continue;
      for (const p of (r.result ?? [])) {
        const createdMs = p?.created ? Date.parse(String(p.created).endsWith("Z") ? p.created : p.created + "Z") : 0;
        raw.push({ author: p?.author, permlink: p?.permlink, title: String(p?.title ?? "").slice(0, 90), createdMs });
      }
    } catch { /* per-tag fail-isolated */ }
  }
  return eligibleCommunity(raw, fleetSet, nowMs);
}

/** pure: R237 — day verdict from CUMULATIVE counters (the old code wrote each
 *  run's counters over the day's evidence — a fresh cycle erased GRIND:V4/R4
 *  from the state top-level; honesty requires the day's totals to stick). */
export function grindVerdict(votes, replies, skipped, total) {
  return votes || replies ? `GRIND:V${votes}/R${replies}` : skipped === total ? "WINDOWS-LATER" : "IDLE-GATES";
}

/* ── state ─────────────────────────────────────────────────────────────── */
export function fleetGrindState() {
  const st = readJson(FILE, null);
  let accounts = [];
  try { accounts = (armedConf()?.fleetGrid?.accounts ?? []).filter(Boolean); } catch { /* no conf → empty schedule */ }
  const schedule = accounts.map((name) => {
    const m = grindMinute(name);
    return { name, windowStart: `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, windowEnd: `${String(Math.floor((m + GRIND_WINDOW_MIN) / 60) % 24).padStart(2, "0")}:${String((m + GRIND_WINDOW_MIN) % 60).padStart(2, "0")}` };
  });
  return { ...st, law: "fleet-grind: חשבונות-מפתח עושים גרינד יומי (1 הצבעה + 1 תגובה, חלונות מפוזרים, חוק-חשיפה: אף-צולב-פנימי), RC רצפה 12%, VP powerVerdict", schedule };
}

/* ── THE RAIL ──────────────────────────────────────────────────────────── */
export async function runFleetGrind({ now = new Date().toISOString(), force = false } = {}) {
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED" };
  loadCredential(); // typed fail before any network — T-16 law

  const conf = armedConf();
  const accounts = Array.isArray(conf.fleetGrid?.accounts) ? conf.fleetGrid.accounts : [];
  if (!accounts.length) return { ok: false, verdict: "NO-FLEET" };

  const master = masterAccount();
  const fleetSet = new Set([...accounts, master]); // exposure law: no cross-fleet engagement
  const day = String(now).slice(0, 10);
  const prev = readJson(FILE, null);
  const carried = grindCarried(prev, day);
  carried.accounts = carried.accounts ?? {};

  const coord = coordinationState();
  /* R237: the grind feeds on COMMUNITY content (exposure law), never on the
   * internal engagement matrix (fleet blogs). Trend tags steer the scan; a
   * failed scan falls back to the internal list (old behavior) honestly. */
  const trendTags = (coord?.trends?.topics ?? []).flatMap((t) => Array.isArray(t?.tags) ? t.tags : []).slice(0, 3);
  let communityCount = 0;
  let posts = [];
  try {
    posts = await scanCommunityPosts({ tags: trendTags, fleetSet, nowMs: Date.parse(now) });
    communityCount = posts.length;
  } catch { posts = []; }
  if (!posts.length) posts = coord?.engagement?.posts ?? [];

  const d = new Date(now);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();

  /* R237: counters are DAY-CUMULATIVE and DERIVED FROM EVIDENCE — recounted
   * from the carried accounts' own verdicts every run (survives state loss,
   * never trusts a stored counter); the loop adds only this run's delta. */
  let votes = 0, replies = 0, skipped = 0, failed = 0;
  for (const a of Object.values(carried.accounts ?? {})) {
    if (a?.vote?.verdict === "VOTED") votes++;
    if (a?.engage?.verdict === "REPLIED") replies++;
    if (String(a?.vote?.verdict ?? "").startsWith("VOTE-")) failed++;
    if (String(a?.engage?.verdict ?? "").startsWith("REPLY-")) failed++;
  }

  for (const account of accounts) {
    const rec = carried.accounts[account] ?? { vote: null, engage: null };

    /* window gate — active window OR catch-up grace (R237); zero chain reads when closed */
    const offset = grindMinute(account);
    const gate = grindShouldRun(minute, offset, rec, force);
    if (!gate.run) {
      skipped++;
      continue;
    }
    const late = gate.catchup === true;

    const doneKeys = new Set();
    if (rec.vote?.target) doneKeys.add(`vote:${rec.vote.target}`);
    if (rec.engage?.target) doneKeys.add(`engage:${rec.engage.target}`);
    const targets = pickGrindTargets(posts, account, fleetSet, doneKeys);
    if (!targets.vote && !targets.engage) {
      /* honest visibility (day-guarded): the window/catch-up was open but the
       * target pool is dry — never again a silent IDLE-GATES with no clue */
      if (rec.noTargetsDay !== day) {
        rec.noTargetsDay = day;
        appendLine(EVENTS, { type: "grind.no-targets", at: now, account, community: communityCount, catchup: late });
      }
    }

    /* ── vote ── */
    if (!rec.vote && targets.vote) {
      const rc = await rcPctOf(account).catch(() => null);
      if (rc != null && rc < FLEET_GRIND_RC_FLOOR_PCT) {
        /* NOT marked done — the hold re-checks next cycle until RC recovers */
        appendLine(EVENTS, { type: "grind.rc-hold", at: now, account, kind: "vote", rcPct: rc });
      } else {
        const { vpEff } = await vpEffOf(account).catch(() => ({ vpEff: null }));
        const law = powerVerdict(vpEff);
        if (law.votesPerWindow === 0) {
          rec.vote = { target: `${targets.vote.author}/${targets.vote.permlink}`, verdict: "VP-REST", vpEff, at: now, ...(late ? { catchup: true } : {}) };
          carried.accounts[account] = { ...rec, engage: rec.engage ?? null };
          appendLine(EVENTS, { type: "grind.vote-rest", at: now, account, vpEff });
        } else {
          const op = [["vote", { voter: account, author: targets.vote.author, permlink: targets.vote.permlink, weight: Math.round(law.weightPct * 100) }]];
          let v = { target: `${targets.vote.author}/${targets.vote.permlink}`, weightPct: law.weightPct, verdict: "SKIP", at: now, txid: null, ...(late ? { catchup: true } : {}) };
          try {
            const res = await executeAs(account, op, { tag: "fleet-grind", role: "posting", rcPct: rc });
            v.verdict = res.ok ? "VOTED" : `VOTE-FAIL:${String(res.error ?? res.verdict ?? "?").slice(0, 40)}`;
            v.txid = res.txid ?? null;
          } catch (e) {
            v.verdict = `VOTE-ERR:${String(e?.message ?? e).slice(0, 40)}`;
          }
          rec.vote = v;
          appendLine(EVENTS, { type: "grind.vote", at: now, account, ...v });
          if (v.verdict === "VOTED") votes++; else if (!String(v.verdict).startsWith("VP-REST")) failed++;
        }
      }
    }

    /* ── engage ── */
    if (!rec.engage && targets.engage) {
      const rc = await rcPctOf(account).catch(() => null);
      if (rc != null && rc < FLEET_GRIND_RC_FLOOR_PCT) {
        /* NOT marked done — re-checks next cycle until RC recovers */
        appendLine(EVENTS, { type: "grind.rc-hold", at: now, account, kind: "engage", rcPct: rc });
      } else {
        let v = { target: `${targets.engage.author}/${targets.engage.permlink}`, verdict: "SKIP", at: now, txid: null, ...(late ? { catchup: true } : {}) };
        try {
          const cr = await rpcCall("condenser_api.get_content", [targets.engage.author, targets.engage.permlink]);
          const body = cr.ok ? String(cr.result?.body ?? "").replace(/[#*>\n]/g, " ").slice(0, 600) : "";
          const trend = (coord?.trends?.topics ?? []).find((x) => x?.talkTrack)?.talkTrack ?? null;
          const { text } = await composeReply({ title: targets.engage.title, excerpt: body, talkTrack: trend });
          const permlink = `re-grind-${String(targets.engage.permlink).replace(/[^a-z0-9-]/gi, "").slice(0, 60)}-${String(now).replace(/[-:TZ.]/g, "").slice(0, 14)}z`.slice(0, 255);
          const op = [["comment", { parent_author: targets.engage.author, parent_permlink: targets.engage.permlink, author: account, permlink, title: "", body: text, json_metadata: JSON.stringify({ app: "saos-sovereign-engine", tags: ["community"] }) }]];
          const res = await executeAs(account, op, { tag: "fleet-grind", role: "posting", rcPct: rc });
          v.verdict = res.ok ? "REPLIED" : `REPLY-FAIL:${String(res.error ?? res.verdict ?? "?").slice(0, 40)}`;
          v.txid = res.txid ?? null;
        } catch (e) {
          v.verdict = `REPLY-ERR:${String(e?.message ?? e).slice(0, 40)}`;
        }
        rec.engage = v;
        appendLine(EVENTS, { type: "grind.engage", at: now, account, ...v });
        if (v.verdict === "REPLIED") replies++; else failed++;
      }
    }

    carried.accounts[account] = { vote: rec.vote ?? null, engage: rec.engage ?? null, noTargetsDay: rec.noTargetsDay };
  }

  carried.at = now;
  const verdict = grindVerdict(votes, replies, skipped, accounts.length);
  writeJson(FILE, { day, accounts: carried.accounts, at: now, verdict, votes, replies, failed, skipped });
  return { ok: true, verdict, votes, replies, failed, skipped, fleet: accounts.length };
}
