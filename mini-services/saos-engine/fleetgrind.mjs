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
  const posts = coord?.engagement?.posts ?? [];

  const d = new Date(now);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();

  let votes = 0, replies = 0, skipped = 0, failed = 0;

  for (const account of accounts) {
    const rec = carried.accounts[account] ?? { vote: null, engage: null };

    /* window gate — zero chain reads when closed (the cheap skip) */
    const offset = grindMinute(account);
    if (!force && !grindWindowActive(minute, offset)) {
      skipped++;
      continue;
    }

    const doneKeys = new Set();
    if (rec.vote?.target) doneKeys.add(`vote:${rec.vote.target}`);
    if (rec.engage?.target) doneKeys.add(`engage:${rec.engage.target}`);
    const targets = pickGrindTargets(posts, account, fleetSet, doneKeys);

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
          rec.vote = { target: `${targets.vote.author}/${targets.vote.permlink}`, verdict: "VP-REST", vpEff, at: now };
          carried.accounts[account] = { ...rec, engage: rec.engage ?? null };
          appendLine(EVENTS, { type: "grind.vote-rest", at: now, account, vpEff });
        } else {
          const op = [["vote", { voter: account, author: targets.vote.author, permlink: targets.vote.permlink, weight: Math.round(law.weightPct * 100) }]];
          let v = { target: `${targets.vote.author}/${targets.vote.permlink}`, weightPct: law.weightPct, verdict: "SKIP", at: now, txid: null };
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
        let v = { target: `${targets.engage.author}/${targets.engage.permlink}`, verdict: "SKIP", at: now, txid: null };
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

    carried.accounts[account] = { vote: rec.vote ?? null, engage: rec.engage ?? null };
  }

  carried.at = now;
  const verdict = votes || replies
    ? `GRIND:V${votes}/R${replies}`
    : skipped === accounts.length ? "WINDOWS-LATER" : "IDLE-GATES";
  writeJson(FILE, { day, accounts: carried.accounts, at: now, verdict, votes, replies, failed, skipped });
  return { ok: true, verdict, votes, replies, failed, skipped, fleet: accounts.length };
}
