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
import { execSync } from "child_process";

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
  { repo: "saos-sovereign-platform", branch: "main", forbiddenPrefix: ["agent/keys/"] },
  { repo: "anchor-baseline", branch: "main", forbiddenSuffix: [".enc"] },
];

let runCount = 0;
const actions: { at: string; repo: string; hits: number; result: string }[] = [];
let cycling = false; // נעילת-חפיפה: טיימר + /run-now לא מריצים שני מחזורים במקביל
const dueAt: Record<string, number> = {}; // repo → epoch-ms של הסריקה-הבאה
const lastRunByRepo: Record<string, string> = {};

function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
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

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  sh(`rm -rf ${work}`);
  sh(`git -c "http.extraHeader=${header}" clone --depth 10 --filter=blob:none ${url} ${work}`);
  // ההורים חייבים להיות נקיים — אחרת זה תיקון-ידני, לא אוטומטי
  const parents = sh(`git rev-list --parents -n 1 HEAD`, work).split(" ").slice(1);
  for (const par of parents) {
    const listing = sh(`git ls-tree -r --name-only ${par}`, work);
    const parentHits = listing.split("\n").filter((p) => hits.includes(p));
    if (parentHits.length) {
      log("CRITICAL", `${w.repo}: leak exists in parent history (${parentHits.length} paths) — manual purge needed, NOT auto-fixed`);
      return { done: false, reason: "deep-history" };
    }
  }
  const cloneHead = sh(`git rev-parse HEAD`, work);
  const { json: headJson } = await headOf(w.repo, w.branch);
  const remoteHead = headJson.sha;
  if (cloneHead !== remoteHead) {
    log("WARN", `${w.repo}: head moved during rewrite (${cloneHead.slice(0, 8)} → ${remoteHead.slice(0, 8)}), retry next cycle`);
    return { done: false, reason: "race" };
  }
  for (const p of hits) sh(`git rm --cached -q "${p}"`, work);
  const tree = sh(`git write-tree`, work);
  const msg = `guardian: auto-neutralize ${hits.length} forbidden path(s) re-introduced by automation (backup: ~/.secrets/vault-recovery/guardian-${stamp}) — vault-guardian, no secrets logged`;
  const commit = sh(
    `git -c user.name="vault-guardian" -c user.email="guardian@saos.local" commit-tree ${tree} -p HEAD -m "${msg}"`,
    work
  );
  sh(`git update-ref refs/heads/${w.branch} ${commit}`, work);
  sh(`git -c "http.extraHeader=${header}" push --force ${url} refs/heads/${w.branch}:refs/heads/${w.branch}`, work);
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
        if (!hits.length) { log("OK", `${w.repo}: clean (${paths.length} files, head ${head.sha.slice(0, 10)})`); continue; }
        log("ALERT", `${w.repo}: ${hits.length} forbidden path(s) in head ${head.sha.slice(0, 10)}: ${hits.join(", ")}`);
        await backupBlobs(w.repo, head.sha, hits, stamp);
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

Bun.serve({
  port: PORT,
  fetch(req: Request) {
    const u = new URL(req.url);
    if (u.pathname === "/status") {
      return Response.json({
        ok: true, runCount, cycling,
        cadence: { steem: "90s", others: "10min" },
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

log("INFO", `vault-guardian up on :${PORT} — steem every ${STEEM_INTERVAL_MS / 1000}s, others every ${DEFAULT_INTERVAL_MS / 60000}min, no-overlap lock on`);
// סריקה ראשונית אחרי 5 שניות, ואז טיק כל 30 שניות שמריץ כל ריפו לפי-קצבו
setTimeout(cycle, 5000);
setInterval(() => {
  const now = Date.now();
  for (const w of WATCH) {
    if ((dueAt[w.repo] ?? 0) <= now) cycle(w.repo);
  }
}, TICK_MS);
