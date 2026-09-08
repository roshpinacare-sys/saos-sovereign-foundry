#!/usr/bin/env node
/**
 * vault-guardian — שומר-הכספת (Task 17)
 *
 * רקע: דמון-gitkeeper (על תשתית הבעלים, מחוץ לסנדבוקס) החזיר את כספת ה-fleet
 * אל ההיסטוריה הנקייה של steem (קומיט 41603ca, loop 21). ניסיון לחסום דחיפות
 * בצד-השרת (branch protection) נכשל: תוכנית-חינם לא תומכת (HTTP 403, דרוש Pro).
 *
 * הפשרה שניתנת למימוש מהסנדבוקס: סריקה-חוזרת כל 10 דקות של ראשי-הענפים, ואם
 * הדמון הדליף שוב — (1) גיבוי ה-blobs ל-~/.secrets/vault-recovery/guardian-<ts>/,
 * (2) נטרול הנתיבים מהקומיט-הראש (plumbing, ההורים נשמרים), (3) force-push,
 * (4) אימות מרחוק. חלון-החשיפה יורד מ"נצחי" ל"עד-10-דקות".
 *
 * גדרות-בטיחות קשיחות:
 *  - מתערב רק על נתיבים ברשימה-השחורה המפורשת (fleet_keys.enc/meta, agent/keys/)
 *  - לא נוגע בשום קובץ אחר; ההורים של הקומיט-הראש חייבים להיות נקיים
 *  - אם הדליפה עמוקה בהיסטוריה → CRITICAL ללוג, אין-fix אוטומטי (ידני)
 *  - אף ערך-סוד לא נדפס/נרשם — רק נתיבים, SHA-ים ומספרים
 *  - race: אם הראש זז בזמן הכתיבה → retry במחזור הבא
 *
 * זה לא מונע את הדחיפה (לא ניתן בתוכנית-חינם) — הוא מנטרל את הדליפה. המניעה
 * האמיתית: הבעלים מסיר את הרשאת-הכתיבה מהטוקן של הדמון (צד-בעלים).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const execP = promisify(execCb);

const PORT = 3031;
/** Task 19: קצב-נפרד לכל ריפו — steem (הריפו-שדלף) נסרק כל 90 שניות,
 * השאר כל 10 דקות. טיק פנימי כל 30 שניות בודק מי בזמן. */
const STEEM_INTERVAL_MS = 90 * 1000;
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const TICK_MS = 30 * 1000;
const TOKEN_PATH = path.join(os.homedir(), ".secrets", "github-token");
const RECOVERY_DIR = path.join(os.homedir(), ".secrets", "vault-recovery");
const LOG_PATH = path.join(import.meta.dir, "guardian.log");
const API = "https://api.github.com";

/** רשימת-הריפואים והנתיבים האסורים המפורשים (מדויק, לא רחב-מדי) */
const WATCH = [
  { repo: "steem", branch: "main", forbidden: ["agent/fleet_keys.enc", "agent/fleet_keys.meta.json"] },
  // Task 25-c: סתימת נקודת-העיוור — קובץ-העיגון תחת scripts/ לא נתפס ברשימה הישנה (מבוססת-נתיב צרה).
  // הקובץ נבדק ובטוח (הצירוף מ-env), אבל אם מישהו יטמיע בו צירוף-אמת — ה-guardian יתפוס, יגבה וידווח
  // (ב-DEV_MODE לא מוחק); בפרודקשן הנטרול-הכוחני הוא היעד המתועד (vault+stub).
  { repo: "saos-sovereign-platform", branch: "main", forbidden: ["scripts/anchor-sovereign-mnemonic.ts"], forbiddenPrefix: ["agent/keys/"], forbiddenSuffix: [".enc"] },
  { repo: "anchor-baseline", branch: "main", forbiddenSuffix: [".enc"] },
];

/** Task 25-c: דה-דופ ל-DEV_MODE — גיבוי+ALERT רק כשהחתימה (head-sha + hits) משתנה.
 * הוכחה: אותו head-sha = אותו עץ = אותם בלובים → גיבוי-חוזר על אותו head הוא רעש, לא בטיחות.
 * head חדש עם היטים → תמיד מגובה. */
const lastHitSig: Record<string, string> = {};

// Task 24 (הנחיית-בעלים 2026-09-08): מצב-פיתוח — סוכנים מורשים לגישת-מפתחות בסביבה הפרטית.
// DEV_MODE (ברירת-מחדל ON): נתיב אסור ב-HEAD → דווח + גיבוי ל-vault, בלי מחיקת-כוח.
// נטרול-כוחני חוזר רק עם GUARDIAN_DEV_MODE=0 (שלב-פרודקשן).
const DEV_MODE = process.env.GUARDIAN_DEV_MODE !== "0";

let runCount = 0;
const actions: { at: string; repo: string; hits: number; result: string }[] = [];
let cycling = false; // נעילת-חפיפה: טיימר + /run-now לא מריצים שני מחזורים במקביל
const dueAt: Record<string, number> = {}; // repo → epoch-ms של הסריקה-הבאה
const lastRunByRepo: Record<string, string> = {};

/** Task 20: מצב-טוקן חינני — סנדבוקס-ריסט מחק את ~/.secrets (16:32).
 * במקום spam של ENOENT בכל מחזור: מזהים חוסר פעם-אחת, משהים מחזורים (אפס-קריאות API),
 * וממשיכים לבדוק קיום-קובץ כל-טיק — המשך-עבודה אוטומטי ברגע שהטוקן חוזר. */
let tokenMissingSince: number | null = null;
let lastTokenMissLogAt = 0;
const TOKEN_MISS_LOG_EVERY_MS = 30 * 60 * 1000; // תזכורת בלוג פעם ב-30 דקות בלבד
const TOKEN_RETRY_WHEN_MISSING_MS = TICK_MS; // כשאין טוקן: בדיקת-קיום זולה כל-טיק

function tokenPresent(): boolean {
  try { fs.accessSync(TOKEN_PATH); return true; } catch { return false; }
}

/** Task 20: פעימות-לב — ה-טיק הפנימי מעדכן זמן; המפקח (instrumentation) בודק
 * שהפעימה טרייה. זה תופס מצב-זומבי שבו ה-/status חי אבל הטיימרים מתו
 * (נצפה בפועל ב-reload מהיר של bun --hot). */
let lastTickAt = Date.now();
function tickAlive(): boolean {
  return Date.now() - lastTickAt < 3 * TICK_MS;
}

function log(level, msg) {
  // choke point: שורות-פקודה/שגיאות git עשויות להכיל כותרת-אימות — מחוסן לפני לוג
  const safe = String(msg)
    .replace(/Authorization:\s*(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "Authorization: [REDACTED]")
    .replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, "gh***[REDACTED]");
  const line = `${new Date().toISOString()} [${level}] ${safe}`;
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
  console.log(line);
}

function token() {
  return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "saos-vault-guardian",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { status: res.status, json };
}

// אסינכרוני: לא חוסם את ה-event loop — /status ופעימות-הלב ממשיכות לנשום גם
// בזמן clone ארוך (שורש-תיקון לסערת-ה-spawn של המפקח: execSync היה חוסם הכל)
async function sh(cmd, cwd) {
  try {
    const r = await execP(cmd, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return String(r.stdout).trim();
  } catch (e) {
    const err = e as Error & { cmd?: string };
    throw new Error(`git op failed: ${String(err.message || e).slice(0, 160)}`);
  }
}

function headOf(repo, branch) {
  return api(`${API}/repos/roshpinacare-sys/${repo}/commits/${branch}`);
}

async function treeOf(repo, sha) {
  const { json } = await api(`${API}/repos/roshpinacare-sys/${repo}/git/trees/${sha}?recursive=1`);
  return json.tree || [];
}

function forbiddenIn(w, paths) {
  const hits = [];
  for (const p of paths) {
    if (w.forbidden && w.forbidden.includes(p)) hits.push(p);
    if (w.forbiddenPrefix && w.forbiddenPrefix.some((pre) => p.startsWith(pre))) hits.push(p);
    if (w.forbiddenSuffix && w.forbiddenSuffix.some((suf) => p.endsWith(suf))) hits.push(p);
  }
  return hits;
}

async function backupBlobs(repo, treeSha, hits, stamp) {
  const dir = path.join(RECOVERY_DIR, `guardian-${stamp}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { json: tree } = await api(`${API}/repos/roshpinacare-sys/${repo}/git/trees/${treeSha}?recursive=1`);
  const shaByPath = Object.fromEntries((tree.tree || []).filter((t) => t.type === "blob").map((t) => [t.path, t.sha]));
  for (const p of hits) {
    const { json: blob } = await api(`${API}/repos/roshpinacare-sys/${repo}/git/blobs/${shaByPath[p]}`);
    if (blob?.content) {
      const buf = Buffer.from(blob.content, "base64");
      const local = path.join(dir, p.replace(/\//g, "__"));
      fs.writeFileSync(local, buf, { mode: 0o600 });
      log("INFO", `backup: ${repo}:${p} -> ${path.basename(local)} (${buf.length}B)`);
    } else log("WARN", `backup: could not fetch ${repo}:${p}`);
  }
  return dir;
}

async function neutralize(w, hits, stamp) {
  const work = `/tmp/guardian-${w.repo}`;
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token()}`).toString("base64")}`;
  const url = `https://github.com/roshpinacare-sys/${w.repo}.git`;
  await sh(`rm -rf ${work}`);
  await sh(`git -c "http.extraHeader=${header}" clone -q --depth 10 --filter=blob:none ${url} ${work}`);
  // ההורים חייבים להיות נקיים — אחרת זה תיקון-ידני, לא אוטומטי
  const parents = (await sh(`git rev-list --parents -n 1 HEAD`, work)).split(" ").slice(1);
  for (const par of parents) {
    const listing = await sh(`git ls-tree -r --name-only ${par}`, work);
    const parentHits = listing.split("\n").filter((p) => hits.includes(p));
    if (parentHits.length) {
      log("CRITICAL", `${w.repo}: leak exists in parent history (${parentHits.length} paths) — manual purge needed, NOT auto-fixed`);
      return { done: false, reason: "deep-history" };
    }
  }
  const cloneHead = await sh(`git rev-parse HEAD`, work);
  const { json: headJson } = await headOf(w.repo, w.branch);
  const remoteHead = headJson.sha;
  if (cloneHead !== remoteHead) {
    log("WARN", `${w.repo}: head moved during rewrite (${cloneHead.slice(0, 8)} → ${remoteHead.slice(0, 8)}), retry next cycle`);
    return { done: false, reason: "race" };
  }
  for (const p of hits) await sh(`git rm --cached -q "${p}"`, work);
  const tree = await sh(`git write-tree`, work);
  const msg = `guardian: auto-neutralize ${hits.length} forbidden path(s) re-introduced by automation (backup: ~/.secrets/vault-recovery/guardian-${stamp}) — vault-guardian, no secrets logged`;
  const commit = await sh(
    `git -c user.name="vault-guardian" -c user.email="guardian@saos.local" commit-tree ${tree} -p HEAD -m "${msg}"`,
    work
  );
  await sh(`git update-ref refs/heads/${w.branch} ${commit}`, work);
  await sh(`git -c "http.extraHeader=${header}" push --force ${url} refs/heads/${w.branch}:refs/heads/${w.branch}`, work);
  // אימות מרחוק
  const { json: after } = await headOf(w.repo, w.branch);
  const paths = (await treeOf(w.repo, after.sha)).map((t) => t.path);
  const still = forbiddenIn(w, paths);
  if (still.length) { log("CRITICAL", `${w.repo}: post-push verification FAILED (${still.length})`); return { done: false, reason: "verify-failed" }; }
  log("INFO", `${w.repo}: neutralized ${hits.length} path(s), new head ${after.sha.slice(0, 10)}, remote-verified clean`);
  return { done: true };
}

async function cycle(onlyRepo?: string) {
  if (cycling) { log("INFO", "cycle skipped — previous cycle still running (no-overlap lock)"); return; }
  // ── Task 20: שער-טוקן — בלי קובץ-טוקן אין טעם לנסות API (רק ENOENT יצטבר) ──
  if (!tokenPresent()) {
    if (tokenMissingSince === null) {
      tokenMissingSince = Date.now();
      log("WARN", `TOKEN-MISSING at ${TOKEN_PATH} — cycles paused (zero API calls), auto-resume the moment the file is restored`);
    } else if (Date.now() - lastTokenMissLogAt >= TOKEN_MISS_LOG_EVERY_MS) {
      log("INFO", `TOKEN-MISSING since ${new Date(tokenMissingSince).toISOString()} — still paused, watching for restore`);
    }
    if (Date.now() - lastTokenMissLogAt >= TOKEN_MISS_LOG_EVERY_MS) lastTokenMissLogAt = Date.now();
    for (const w of (onlyRepo ? WATCH.filter((w) => w.repo === onlyRepo) : WATCH)) dueAt[w.repo] = Date.now() + TOKEN_RETRY_WHEN_MISSING_MS;
    return;
  }
  if (tokenMissingSince !== null) {
    const downMin = Math.round((Date.now() - tokenMissingSince) / 60000);
    log("INFO", `TOKEN-RESTORED — resuming guardianship after ~${downMin}min pause; running immediate verification cycle`);
    tokenMissingSince = null;
  }
  cycling = true;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    runCount++;
    log("INFO", `cycle #${runCount} start${onlyRepo ? " (" + onlyRepo + ")" : ""}`);
    for (const w of WATCH) {
      if (onlyRepo && w.repo !== onlyRepo) continue;
      try {
        const { json: head, status } = await headOf(w.repo, w.branch);
        if (status !== 200) { log("ERROR", `${w.repo}: head fetch HTTP ${status}`); continue; }
        const paths = (await treeOf(w.repo, head.sha)).filter((t) => t.type === "blob").map((t) => t.path);
        const hits = forbiddenIn(w, paths);
        if (!hits.length) { log("OK", `${w.repo}: clean (${paths.length} files, head ${head.sha.slice(0, 10)})`); delete lastHitSig[w.repo]; continue; }
        if (DEV_MODE) {
          // Task 25-c: דה-דופ לפי חתימה — אותו head = אותם בלובים, גיבוי-חוזר הוא רעש
          const sig = `${head.sha}:${hits.join(",")}`;
          if (lastHitSig[w.repo] === sig) {
            log("INFO", `${w.repo}: dev-mode-observed (deduped, unchanged head ${head.sha.slice(0, 10)}, ${hits.length} path(s))`);
            continue;
          }
          lastHitSig[w.repo] = sig;
          await backupBlobs(w.repo, head.sha, hits, stamp); // גיבוי תמיד על head חדש — stay safe
          log("ALERT", `${w.repo}: ${hits.length} forbidden path(s) in head ${head.sha.slice(0, 10)}: ${hits.join(", ")} — DEV-MODE: backed up, observing only (owner keys-access directive 2026-09-08, no force-push)`);
          actions.push({ at: new Date().toISOString(), repo: w.repo, hits: hits.length, result: "dev-mode-observed" });
          continue;
        }
        await backupBlobs(w.repo, head.sha, hits, stamp); // פרודקשן: גיבוי לפני נטרול
        log("ALERT", `${w.repo}: ${hits.length} forbidden path(s) in head ${head.sha.slice(0, 10)}: ${hits.join(", ")}`);
        const r = await neutralize(w, hits, stamp);
        actions.push({ at: new Date().toISOString(), repo: w.repo, hits: hits.length, result: r.done ? "neutralized" : r.reason });
      } catch (e) {
        log("ERROR", `${w.repo}: ${(e as Error).message}`);
      } finally {
        lastRunByRepo[w.repo] = new Date().toISOString();
        dueAt[w.repo] = Date.now() + (w.repo === "steem" ? STEEM_INTERVAL_MS : DEFAULT_INTERVAL_MS);
      }
    }
    log("INFO", `cycle #${runCount} end`);
  } finally {
    cycling = false;
  }
}

try {
  Bun.serve({
  port: PORT,
  fetch(req: Request) {
    const u = new URL(req.url);
    if (u.pathname === "/status") {
      return Response.json({
        ok: true, runCount, cycling, devMode: DEV_MODE,
        cadence: { steem: "90s", others: "10min" },
        token: { present: tokenPresent(), missingSince: tokenMissingSince ? new Date(tokenMissingSince).toISOString() : null },
        tick: { lastTickAt: new Date(lastTickAt).toISOString(), alive: tickAlive() },
        lastRunByRepo, dueAt, actions: actions.slice(-20),
        watch: WATCH.map((w) => w.repo),
      });
    }
    if (u.pathname === "/run-now" && req.method === "POST") {
      cycle();
      return Response.json({ ok: true, triggered: true });
    }
    return new Response("vault-guardian: /status (GET) · /run-now (POST)\n");
  },
});
} catch (e) {
  // פורט-תפוס (למשל ילד-קודם עדיין מחזיק): לא לשכב כזומבי-צופה — לצאת מיד;
  // המפקח יריץ מחדש כשיהיה-צורך. בלי זה bun --hot נשאר חי עם שרת-מת.
  console.log(`port ${PORT} busy — exiting cleanly (${String((e as Error)?.message || e).slice(0, 80)})`);
  process.exit(0);
}

log("INFO", `vault-guardian up on :${PORT} — steem every ${STEEM_INTERVAL_MS / 1000}s, others every ${DEFAULT_INTERVAL_MS / 60000}min, no-overlap lock on`);
// סריקה ראשונית אחרי 5 שניות, ואז טיק כל 30 שניות שמריץ כל ריפו לפי-קצבו
setTimeout(cycle, 5000);
setInterval(() => {
  lastTickAt = Date.now();
  const now = Date.now();
  for (const w of WATCH) {
    if ((dueAt[w.repo] ?? 0) <= now) cycle(w.repo);
  }
}, TICK_MS);
