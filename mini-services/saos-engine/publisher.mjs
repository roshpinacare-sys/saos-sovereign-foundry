/**
 * publisher.mjs — R236 · המסילה-החסרה: הטיוטות משודרות.
 *
 * גילוי-הפער (R236 audit): 12 טיוטות ישבו ב-state/content-ops.json ואף
 * מסילה לא שידרה אותן — promo מפרסם רק דוח-יומי אחד, וחלון-הפוסט של
 * ה-executor מאצל ל-"content rail" שרק מטייט. תוצאה מדודה: authorOps 0,
 * authorSbdPerDay 0 — מסילת-תגמולי-המחבר הייתה דוממת בגלל חוליה חסרה,
 * לא בגלל מדיניות.
 *
 * המסילה הזו סוגרת את הצינור: טיוטה-מטוהרת (חוק-החשיפה כבר יושב ב-
 * sanitizeDraft — חסימת-חשיפה מצטברת נמדדה) → פרסום-מאסטר → txid על-השרשרת.
 *
 * חוקי-ברזל:
 *   · מקס 2 פוסטים/יום-UTC — מוגבל, כנה, לעולם לא מציף.
 *   · idempotent לפי יום: אותה טיוטה לא משודרת פעמיים (posted-ids).
 *   · RC רצפה: אין שידור ב-RC נמוך (HOLD-LOW-RC, לא מסומן-כבוצע).
 *   · fail-isolated לכל פוסט: כישלון אחד לא עוצר את הבא.
 *   · כל פרסום נרשם עם txid ל-events.jsonl — אפס-טענות בלי ראיה.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { executeAs, masterAccount, armedConf, execPaused, loadCredential } from "./signer.mjs";
import { accountState } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const QUEUE_FILE = path.join(STATE, "content-ops.json");
const FILE = path.join(STATE, "publisher.json");
const EVENTS = path.join(STATE, "events.jsonl");
export const PUBLISHER_MAX_PER_DAY = 2;
const RC_FLOOR_PCT = 15;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };

/* ── pure helpers (selftest-vectorable) ────────────────────────────────── */

/** pure: title → deterministic permlink (slug + day), ≤255, no collisions per day */
export function titleToPermlink(title, day) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return `${slug || "post"}-${day}`.slice(0, 255);
}

/** pure: which drafts publish now — status "drafted" only, oldest first, capped */
export function pickDraftsForPublishing(queue, day, postedIds, maxPerDay = PUBLISHER_MAX_PER_DAY) {
  const already = postedIds instanceof Set ? postedIds : new Set(postedIds ?? []);
  const eligible = (Array.isArray(queue) ? queue : [])
    .filter((d) => d && d.status === "drafted" && d.id && !already.has(d.id) && d.title && d.body);
  return [...eligible].reverse().slice(0, maxPerDay); // queue is newest-first → oldest drafts publish first
}

/* ── state ─────────────────────────────────────────────────────────────── */
export function publisherState() { return readJson(FILE, null); }

/* ── THE RAIL ──────────────────────────────────────────────────────────── */
export async function runPublisher({ now = new Date().toISOString() } = {}) {
  const conf = armedConf();
  if (conf.coordination?.publish === false) return { ok: false, verdict: "DISABLED-CONF" };
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED" };
  loadCredential(); // typed fail before any network — T-16 law

  const master = masterAccount();
  const day = String(now).slice(0, 10);
  const prev = readJson(FILE, null);
  const carried = prev?.day === day ? prev : { day, posted: [], verdict: null };
  const already = new Set((carried.posted ?? []).map((p) => p.id));

  const queueDoc = readJson(QUEUE_FILE, null);
  const queue = Array.isArray(queueDoc?.queue) ? queueDoc.queue : [];
  /* the 2/day law counts POSTED only — failed attempts retry (honest), posted never repeat */
  const postedToday = (carried.posted ?? []).filter((p) => p.verdict === "POSTED").length;
  const budget = Math.max(0, PUBLISHER_MAX_PER_DAY - postedToday);
  const picks = budget > 0 ? pickDraftsForPublishing(queue, day, already, budget) : [];

  if (!picks.length) {
    carried.verdict = queue.some((d) => d && d.status === "drafted")
      ? "ALL-DONE-TODAY"
      : "NO-DRAFTS";
    writeJson(FILE, { ...carried, at: now });
    return { ok: true, verdict: carried.verdict, posted: 0 };
  }

  /* RC floor — a post is cheap but not free; the law holds */
  const acc = await accountState(master).catch(() => null);
  const rcPct = acc?.ok ? acc.rcPct : null;
  if (rcPct != null && rcPct < RC_FLOOR_PCT) {
    carried.verdict = "HOLD-LOW-RC";
    writeJson(FILE, { ...carried, rcPct, at: now });
    return { ok: false, verdict: "HOLD-LOW-RC", rcPct, posted: 0 };
  }

  const posted = [];
  for (const d of picks) {
    const permlink = titleToPermlink(d.title, day);
    /* root posts need a non-empty parent_permlink (the category) — first tag,
     * "steem" fallback. Empty parent_permlink = chain permlink-size assert
     * (R236 live-measured: 4 attempts died on it before this fix). */
    const category = (Array.isArray(d.tags) && d.tags[0] && String(d.tags[0]).length >= 3) ? String(d.tags[0]).slice(0, 24) : "steem";
    const op = [["comment", {
      parent_author: "", parent_permlink: category,
      author: master, permlink,
      title: String(d.title).slice(0, 160),
      body: String(d.body).slice(0, 8000),
      json_metadata: JSON.stringify({ app: "saos-sovereign-engine", tags: Array.isArray(d.tags) ? d.tags.slice(0, 5) : [] }),
    }]];
    let entry = { id: d.id, title: String(d.title).slice(0, 80), permlink, verdict: "SKIP", at: now, txid: null };
    try {
      const res = await executeAs(master, op, { tag: "publisher", role: "posting" });
      entry.verdict = res.ok ? "POSTED" : `POST-FAIL:${String(res.error ?? res.verdict ?? "?").slice(0, 40)}`;
      entry.txid = res.txid ?? null;
    } catch (e) {
      entry.verdict = `POST-ERR:${String(e?.message ?? e).slice(0, 40)}`;
    }
    posted.push(entry);
    appendLine(EVENTS, { type: "publish.post", at: now, ...entry });
    if (entry.verdict === "POSTED") {
      d.status = "posted"; d.postedAt = now; d.txid = entry.txid; d.permlink = entry.permlink;
    }
  }

  carried.posted = [...(carried.posted ?? []), ...posted].slice(0, 40);
  carried.verdict = posted.some((p) => p.verdict === "POSTED") ? "PUBLISHED" : "NO-LAND";
  carried.rcPct = rcPct;
  writeJson(FILE, { ...carried, at: now });
  if (posted.some((p) => p.verdict === "POSTED")) writeJson(QUEUE_FILE, queueDoc); // persist status flips
  return {
    ok: true, verdict: carried.verdict, posted: posted.filter((p) => p.verdict === "POSTED").length,
    attempts: posted.length, txids: posted.filter((p) => p.txid).map((p) => p.txid),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPublisher({ force: true }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("PUBLISHER-FAIL", e); process.exit(1); });
}
