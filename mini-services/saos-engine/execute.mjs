/**
 * execute.mjs — R232 · מבצע-החלונות של המסלול שלנו ("שכל אחד יעשה את
 * הפעילות שלו בזמנו" — החוק חל גם עלינו, לא רק על החותם-השני).
 *
 * מה שהמבצע עושה כשחלון של headcorner נפתח (±30 דק, פעם-ביום-לחלון):
 *   - חלון-שיחה (engage): משימות-מטריצת-השיחות של החשבון (פערים קודם,
 *     פיתוח-שיחות אחר; עד 3 לחלון) — תגובה מנוסחת-גשר-AI (מסלול
 *     /api/saos/ai/reply) עם נושאי-השיחה של מכ"ם-הטרנדים; נפילה-חזרה
 *     לתבנית-כנה (רק-מה שקראנו בפוסט עצמו — אפס-המצאות).
 *   - חלונות-הצבעה (vote): חוק-מצב-הכוח במלאו — VP<30 = מנוחה-חוקית
 *     (פסק-דין כנה, לא-שקט); אחרת הצבעה לפוסט-צי שטרם קיבל מאיתנו, במשקל
 *     החוק. קיורציה קרוס-ציית: כל אחד מצביע לרעהו בחלון שלו.
 *   - חלון-פרסום (post): מואצל למסילת-התוכן (content-ops) — אין-פרסום
 *     אוטומטי-כפול מ-R232; פסק-דין כנה POST-DELEGATED.
 *
 * שערים (בסדר): DISABLED-CONF → OPERATOR-PAUSED → CREDENTIAL (טיפוסי,
 * אפס-רשת) → RC-FLOOR 20% → חלון-פעיל → DAY-CAP לחלון → תקציב 3/חלון.
 * הרשאת-פרסום בלבד; אפס-תזוזת-כספים; כל-פסק-דין ביומן (events.jsonl).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, execPaused, loadCredential } from "./signer.mjs";
import { buildSchedule, hhmm, powerVerdict, RC_FLOOR_PCT, coordinationState } from "./coordination.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "execution.json");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";
const WINDOW_TOL_MIN = 30;
const ENGAGE_BUDGET = 3;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* ── pure helpers (selftest-vectorable) ──────────────────────────────── */
export function minuteOfDay(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((t / 60000) % 1440) : null;
}
export function circDistMin(a, b) {
  const d = Math.abs(((a - b) % 1440 + 1440) % 1440);
  return d > 720 ? 1440 - d : d;
}
export function inWindow(minute, win, tol = WINDOW_TOL_MIN) {
  if (!Number.isFinite(minute) || !Number.isFinite(win)) return false;
  return circDistMin(minute, win) <= tol;
}
export function windowKindActive(minute, sched, tol = WINDOW_TOL_MIN) {
  const out = [];
  if (sched?.post != null && inWindow(minute, sched.post, tol)) out.push("post");
  for (const [i, v] of (sched?.votes ?? []).entries()) if (inWindow(minute, v, tol)) out.push(`vote${i + 1}`);
  if (sched?.engage != null && inWindow(minute, sched.engage, tol)) out.push("engage");
  return out;
}

/** pure: the vote target — newest fleet post we have NOT engaged (vote or reply) */
export function pickVoteTarget(engPosts, me) {
  for (const p of (Array.isArray(engPosts) ? engPosts : [])) {
    const voted = (p.fleetVotes ?? []).includes(me);
    const replied = (p.fleetRepliers ?? []).includes(me);
    const missing = (p.missing ?? []).includes(me);
    if (!voted && !replied && missing) return { author: p.author, permlink: p.permlink, title: p.title };
  }
  return null;
}

/** pure: safe reply permlink (steem convention re-<author>-<permlink>-<stamp>) */
export function replyPermlink(parentAuthor, parentPermlink, iso) {
  const clean = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
  const stamp = String(iso ?? new Date().toISOString()).replace(/[-:TZ.]/g, "").slice(0, 14);
  return `re-${clean(parentAuthor)}-${clean(parentPermlink)}-${stamp}z`.slice(0, 255);
}

/* ── reply composer: AI bridge with honest fallback ──────────────────── */
/* R236: exported — the fleet-grind rail reuses the SAME reply engine
 * (one exposure posture, one fallback law) instead of reinventing it. */
export async function composeReply({ title, excerpt, talkTrack, msBudget = 20000 }) {
  try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: String(title ?? "").slice(0, 200), excerpt: String(excerpt ?? "").slice(0, 600), talkTrack: String(talkTrack ?? "").slice(0, 300) }),
      signal: AbortSignal.timeout(msBudget),
    });
    const j = await r.json();
    if (j?.ok && typeof j.text === "string" && j.text.trim().length >= 20) {
      return { text: j.text.trim().slice(0, 700), via: "ai-bridge" };
    }
  } catch { /* bridge down → fallback below */ }
  // fallback: template built ONLY from what we actually read (no invention)
  const tt = String(talkTrack ?? "").trim();
  const core = `Read your piece "${String(title ?? "").slice(0, 80)}" — the part that stands out to me is how practical it stays.`;
  const open = tt ? ` ${tt.split(/[•\n]/)[0].trim().slice(0, 180)}` : " What would you say is the smallest step a newcomer could take on this today?";
  return { text: `${core}${open} Curious where you land on it.`, via: "template-fallback" };
}

/* ── state ───────────────────────────────────────────────────────────── */
export function executionState() { return readJson(FILE, null); }

/* R236: exported — fleet-grind reuses the identical RC read (same chain shape). */
export async function rcPctOf(acc) {
  try {
    const r = await rpcCall("rc_api.find_rc_accounts", { accounts: [acc] });
    const a = r.ok ? r.result?.rc_accounts?.[0] : null;
    const cur = Number(a?.rc_manabar?.current_mana ?? 0);
    const max = Number(a?.max_rc ?? 0); // account-level (R231 measured chain shape)
    return max > 0 ? Math.min(100, Math.round((cur / max) * 1000) / 10) : null;
  } catch { return null; }
}

/* R236: exported — fleet-grind reuses the identical VP read. */
export async function vpEffOf(acc) {
  const r = await rpcCall("condenser_api.get_accounts", [[acc]]);
  const a = r.ok ? r.result?.[0] : null;
  if (!a) return { vpEff: null, raw: null };
  const vests = Number(String(a.vesting_shares ?? "0").split(" ")[0]) || 0;
  const recv = Number(String(a.received_vesting_shares ?? "0").split(" ")[0]) || 0;
  const dele = Number(String(a.delegated_vesting_shares ?? "0").split(" ")[0]) || 0;
  const eff = Math.max(0, vests + recv - dele);
  const mana = Number(a.voting_manabar?.current_mana ?? 0);
  return { vpEff: eff > 0 ? Math.min(100, Math.round((mana / (eff * 1e6)) * 1000) / 10) : null, raw: a };
}

/* ── R233 · dry preflight: pure plan verdicts (selftestable, zero signing) ── */
/** pure: what the executor WOULD do for one window kind right now */
export function dryVerdictFor(kind, { rcHold = false, vpEff = null, tasksCount = 0, target = null, weightPct = 0 } = {}) {
  if (kind === "post") return { kind, verdict: "DRY-POST-DELEGATED-TO-CONTENT-RAIL" };
  if (rcHold) return { kind, verdict: "DRY-HOLD-LOW-RC" };
  if (kind === "engage") {
    return tasksCount > 0
      ? { kind, verdict: `DRY-ENGAGE:${Math.min(tasksCount, ENGAGE_BUDGET)}`, tasksCount: Math.min(tasksCount, ENGAGE_BUDGET) }
      : { kind, verdict: "DRY-NO-TASKS" };
  }
  // vote kinds
  if (vpEff == null) return { kind, verdict: "DRY-VP-UNKNOWN" };
  if (weightPct === 0) return { kind, verdict: "DRY-VP-REST", vpEff };
  if (!target) return { kind, verdict: "DRY-NO-TARGET", vpEff };
  return { kind, verdict: `DRY-VOTE:${weightPct}%`, vpEff, target: `${target.author}/${target.permlink}` };
}

/* ── THE EXECUTOR ────────────────────────────────────────────────────── */
export async function runWindowExecution({ now = new Date().toISOString(), force = false, dry = false } = {}) {
  const conf = armedConf();
  if (conf.coordination?.execute === false) return { ok: false, verdict: "DISABLED-CONF" };
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED" };
  loadCredential(); // typed fail before any network — T-16 law

  const me = masterAccount();
  const day = String(now).slice(0, 10);
  const minute = minuteOfDay(now);
  const coord = coordinationState();
  const sched = coord?.schedule?.[me] ?? buildSchedule(day)[me] ?? null;
  if (!sched) return { ok: false, verdict: "NO-SCHEDULE" };

  const prev = readJson(FILE, null);
  const carried = prev?.day === day ? prev : { day, windows: {}, actions: [] };

  const active = force ? ["engage", "vote1", "vote2", "post"] : windowKindActive(minute, sched);
  const verdicts = [];

  const rcNow = await rcPctOf(me);
  const rcHold = rcNow != null && rcNow < RC_FLOOR_PCT;

  /* R233 · dry preflight — proves the gates/laws/targets resolve BEFORE the
   * windows open; zero signing, zero state writes, zero journaling. */
  if (dry) {
    const { vpEff } = await vpEffOf(me);
    const law = powerVerdict(vpEff);
    const tasksCount = (coord?.assignments?.[me] ?? []).length;
    const target = pickVoteTarget(coord?.engagement?.posts ?? [], me);
    const plan = active.map((kind) => ({ ...dryVerdictFor(kind, { rcHold, vpEff, tasksCount, target, weightPct: law.weightPct }), window: kind === "post" ? sched.post : kind === "engage" ? sched.engage : sched.votes?.[Number(kind.slice(4)) - 1] ?? null, at: now }));
    return { ok: true, dry: true, day, minute, active, rcPct: rcNow, vpEff, plan };
  }

  for (const kind of active) {
    const doneEntry = carried.windows[kind];
    if (doneEntry && !force) { verdicts.push({ kind, verdict: "ALREADY-DONE", at: doneEntry.at }); continue; }

    if (kind === "post") {
      const v = { kind, verdict: "POST-DELEGATED-TO-CONTENT-RAIL", at: now };
      carried.windows[kind] = { at: now, verdict: v.verdict };
      verdicts.push(v); continue;
    }

    if (rcHold) {
      const v = { kind, verdict: "HOLD-LOW-RC", rcPct: rcNow, at: now };
      verdicts.push(v); // NOT marked done — the hold re-checks next cycle until RC recovers
      continue;
    }

    if (kind === "engage") {
      const tasks = (coord?.assignments?.[me] ?? []).slice(0, ENGAGE_BUDGET);
      if (!tasks.length) {
        const v = { kind, verdict: "NO-TASKS", at: now };
        carried.windows[kind] = { at: now, verdict: v.verdict };
        verdicts.push(v); continue;
      }
      let landed = 0;
      for (const t of tasks) {
        try {
          const cr = await rpcCall("condenser_api.get_content", [t.author, t.permlink]);
          const body = cr.ok ? String(cr.result?.body ?? "").replace(/[#*>\n]/g, " ").slice(0, 600) : "";
          const trend = (coord?.trends?.topics ?? []).find((x) => x?.talkTrack)?.talkTrack ?? null;
          const { text, via } = await composeReply({ title: t.title, excerpt: body, talkTrack: trend });
          const permlink = replyPermlink(t.author, t.permlink, now);
          const res = await executeAs(me, [[
            "comment",
            { parent_author: t.author, parent_permlink: t.permlink, author: me, permlink, title: "", body: text, json_metadata: JSON.stringify({ app: "saos-sovereign-engine", tags: ["community"] }) },
          ]], { tag: `coord-${kind}`, role: "posting" });
          const v = { kind, verdict: res.ok ? "REPLIED" : `REPLY-FAIL:${String(res.error ?? res.verdict ?? "?").slice(0, 40)}`, to: `${t.author}/${t.permlink}`, via, txid: res.txid ?? null, at: now };
          verdicts.push(v);
          carried.actions.push(v);
          appendLine(path.join(STATE, "events.jsonl"), { type: "exec.engage", at: now, ...v });
          if (res.ok) landed++;
        } catch (e) {
          const v = { kind, verdict: `REPLY-ERR:${String(e?.message ?? e).slice(0, 40)}`, to: `${t.author}/${t.permlink}`, at: now };
          verdicts.push(v);
          appendLine(path.join(STATE, "events.jsonl"), { type: "exec.engage-err", at: now, ...v });
        }
      }
      carried.windows[kind] = { at: now, verdict: landed > 0 ? `ENGAGED:${landed}` : "ENGAGE-NO-LAND", landed };
      continue;
    }

    if (kind.startsWith("vote")) {
      const { vpEff } = await vpEffOf(me);
      const law = powerVerdict(vpEff);
      if (law.votesPerWindow === 0) {
        const v = { kind, verdict: "VP-REST", vpEff, at: now }; // the lawful skip — honest, journaled
        carried.windows[kind] = { at: now, verdict: v.verdict, vpEff };
        verdicts.push(v);
        appendLine(path.join(STATE, "events.jsonl"), { type: "exec.vote-rest", at: now, vpEff });
        continue;
      }
      const target = pickVoteTarget(coord?.engagement?.posts ?? [], me);
      if (!target) {
        const v = { kind, verdict: "NO-TARGET", vpEff, at: now };
        carried.windows[kind] = { at: now, verdict: v.verdict, vpEff };
        verdicts.push(v); continue;
      }
      try {
        const weight = Math.round(law.weightPct * 100); // 10000 = 100%
        const res = await executeAs(me, [[
          "vote",
          { voter: me, author: target.author, permlink: target.permlink, weight },
        ]], { tag: `coord-${kind}`, role: "posting" });
        const v = { kind, verdict: res.ok ? `VOTED:${law.weightPct}%` : `VOTE-FAIL:${String(res.error ?? res.verdict ?? "?").slice(0, 40)}`, vpEff, target: `${target.author}/${target.permlink}`, txid: res.txid ?? null, at: now };
        verdicts.push(v);
        carried.actions.push(v);
        carried.windows[kind] = { at: now, verdict: v.verdict, vpEff };
        appendLine(path.join(STATE, "events.jsonl"), { type: "exec.vote", at: now, ...v });
      } catch (e) {
        const v = { kind, verdict: `VOTE-ERR:${String(e?.message ?? e).slice(0, 40)}`, at: now };
        verdicts.push(v);
        appendLine(path.join(STATE, "events.jsonl"), { type: "exec.vote-err", at: now, ...v });
      }
      continue;
    }
  }

  carried.at = now;
  carried.minute = minute;
  carried.rcPct = rcNow;
  writeJson(FILE, carried);
  return { ok: true, day, verdicts, windows: carried.windows, rcPct: rcNow };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWindowExecution().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }).catch((e) => { console.error("EXEC-FAIL", String(e?.message ?? e)); process.exit(1); });
}
