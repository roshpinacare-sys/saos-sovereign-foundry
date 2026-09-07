import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { authConfigured } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { saosMode } from "@/lib/saos/modes";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/repo-status — repo, backup & secret-hygiene state (Task 10).
 *
 * Purpose: the Security & Repo screen needs REAL data for "push status",
 * "pending commits", "backups" and "secrets" instead of guesses. Everything
 * here is read-only and value-free: booleans, counts and metadata only —
 * NEVER file contents, env values or key material.
 *
 * Sources:
 *   git (read-only subprocess, best-effort)   → branch, last commit, dirty/unpushed counts
 *   backups/ + OpLog(op=backup)               → backup list + authoritative verified flag
 *   fs.stat(.env)                              → existence + permissions (06xx octal, no values)
 *   authConfigured()                           → boolean only
 *   filename/content pattern scan (cached 5m) → live secret-pattern sweep over TRACKED files
 */
function run(cmd: string, args: string[], timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: process.cwd(), timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? null : stdout.toString().trim());
    });
  });
}

const SECRET_FILE_PATTERNS = [
  { id: "env-file", re: /(^|\/)\.env($|\.)/ },
  { id: "key-file", re: /(^|\/)(id_rsa|id_ed25519|.*\.pem|.*\.key)$/ },
  { id: "token-name", re: /(^|\/)(token|secret|credential|password)[a-z0-9_.-]*\.(txt|json|env|key)$/i },
  { id: "admin-key-name", re: /admin-key/i }
];
const SECRET_CONTENT_PATTERNS = [
  { id: "github-token", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: "private-key-block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "aws-key", re: /AKIA[0-9A-Z]{16}/ },
  { id: "generic-bearer-secret", re: /(?:password|passwd|api[_-]?key|secret)\s*[:=]\s*["'][^"'\s]{16,}["']/i }
];
const SCAN_CACHE_MS = 5 * 60_000;
let scanCache: { at: string; scannedFiles: number; matches: { file: string; pattern: string }[] } | null = null;

async function secretScan(): Promise<{ at: string; scannedFiles: number; matches: { file: string; pattern: string }[] }> {
  if (scanCache && Date.now() - new Date(scanCache.at).getTime() < SCAN_CACHE_MS) return scanCache;
  const tracked = await run("git", ["ls-files"]);
  const files = tracked ? tracked.split("\n").filter(Boolean) : [];
  const matches: { file: string; pattern: string }[] = [];
  for (const file of files) {
    // filename patterns (any tracked path) — .env.example is the intentional template
    if (file !== ".env.example") {
      for (const p of SECRET_FILE_PATTERNS) {
        if (p.re.test(file)) matches.push({ file, pattern: p.id });
      }
    }
    // content patterns — text files only, size-capped
    try {
      const full = path.join(process.cwd(), file);
      const st = statSync(full);
      if (!st.isFile() || st.size > 200_000) continue;
      const buf = readFileSync(full);
      if (buf.includes(0)) continue; // binary
      const text = buf.toString("utf8");
      for (const p of SECRET_CONTENT_PATTERNS) {
        if (p.re.test(text)) matches.push({ file, pattern: p.id });
      }
    } catch {
      // unreadable — skip silently (read-only sweep)
    }
  }
  scanCache = { at: new Date().toISOString(), scannedFiles: files.length, matches };
  return scanCache;
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("repo-status", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    // ── git state (best-effort, read-only) ─────────────────────────────────
    const [branch, headSubject, headIso, headSha, dirty, unpushed, remoteUrl] = await Promise.all([
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
      run("git", ["log", "-1", "--pretty=%s"]),
      run("git", ["log", "-1", "--pretty=%cI"]),
      run("git", ["rev-parse", "--short=12", "HEAD"]),
      run("git", ["status", "--porcelain"]),
      run("git", ["rev-list", "--count", "origin/main..HEAD"]),
      run("git", ["remote", "get-url", "origin"])
    ]);
    const gitAvailable = branch !== null;
    const dirtyLines = dirty ? dirty.split("\n").filter(Boolean) : [];
    // remote URL is reported scrubbed — only whether it exists and its host
    const remoteHost = remoteUrl ? (remoteUrl.match(/@([^/]+)\//)?.[1] ?? remoteUrl.replace(/^https?:\/\//, "").split("/")[0]) : null;

    // ── backups (dir + authoritative OpLog) ────────────────────────────────
    const backupDir = path.join(process.cwd(), "backups");
    const dirs: { name: string; createdAt: string | null; files: number; bytes: number }[] = [];
    if (existsSync(backupDir)) {
      for (const d of readdirSync(backupDir)) {
        const full = path.join(backupDir, d);
        try {
          if (!statSync(full).isDirectory()) continue;
          let createdAt: string | null = null;
          let files = 0;
          let bytes = 0;
          const manifestPath = path.join(full, "manifest.json");
          if (existsSync(manifestPath)) {
            const m = JSON.parse(readFileSync(manifestPath, "utf8")) as { createdAt?: string; files?: { bytes: number }[] };
            createdAt = m.createdAt ?? null;
            files = m.files?.length ?? 0;
            bytes = m.files?.reduce((s, f) => s + (f.bytes ?? 0), 0) ?? 0;
          }
          dirs.push({ name: d, createdAt, files, bytes });
        } catch {
          // unreadable backup dir — skip
        }
      }
    }
    const backupOps = await db.opLog.findMany({ where: { op: "backup" }, orderBy: { createdAt: "desc" }, take: 5 });
    const lastBackupOp = backupOps[0] ?? null;
    const verifiedByName = new Map<string, boolean>();
    for (const op of backupOps) {
      const name = op.detail?.match(/backup-\d{4}-\d{2}-\d{2}T[\d-]+/)?.[0];
      if (name) verifiedByName.set(name, /verified=true/.test(op.detail ?? ""));
    }
    const backups = dirs
      .map((d) => ({ ...d, verified: verifiedByName.get(d.name) ?? null }))
      .sort((a, b) => (a.name < b.name ? 1 : -1))
      .slice(0, 10);

    // ── secrets posture (booleans + permissions only) ──────────────────────
    const envPath = path.join(process.cwd(), ".env");
    const envStat = existsSync(envPath) ? statSync(envPath) : null;
    const envPerms = envStat ? `0${(envStat.mode & 0o777).toString(8)}` : null;
    const scan = await secretScan();

    // SH-7 (Task 11): is the local admin-key file still inside the project
    // tree? EXISTENCE ONLY via stat — the file's content is never read,
    // never printed and never stored (docs/secret-hygiene.md SH-7).
    const adminKeyPath = path.join(process.cwd(), "upload", "saos-admin-key.txt");
    let adminKeyFileInTree = false;
    try {
      adminKeyFileInTree = statSync(adminKeyPath).isFile();
    } catch {
      adminKeyFileInTree = false;
    }

    const mode = saosMode();
    return NextResponse.json({
      ok: true,
      git: {
        available: gitAvailable,
        branch: gitAvailable ? branch : null,
        lastCommit: gitAvailable && headSha ? { sha: headSha, subject: headSubject, at: headIso } : null,
        uncommittedFiles: gitAvailable ? dirtyLines.length : null,
        uncommittedSample: dirtyLines.slice(0, 10),
        unpushedCommits: gitAvailable && unpushed !== null ? Number(unpushed) : null,
        remoteConfigured: remoteUrl !== null,
        remoteHost
      },
      backups: {
        directory: dirs.length > 0,
        count: dirs.length,
        recent: backups,
        lastVerifiedAt: lastBackupOp?.createdAt ?? null,
        lastVerifiedOk: lastBackupOp ? /verified=true/.test(lastBackupOp.detail ?? "") : false
      },
      secrets: {
        authConfigured: authConfigured(),
        envFilePresent: envStat !== null,
        envFilePerms: envPerms,
        envValuesExposed: false,
        adminKeyFileInTree,
        adminKeyRule: "המערכת מאחסנת hash בלבד (SAOS_ADMIN_KEY_HASH) — לעולם לא את המפתח הגלוי; קובץ מפתח בתוך עץ הפרויקט הוא פריט SH-7 פתוח (החלטת בעלים)",
        scanPerformedAt: scan.at,
        scanCoveredFiles: scan.scannedFiles,
        scanMatches: scan.matches,
        scanNote: "סריקת דפוסים על קבצים מעוקבים (שמות + תוכן טקסטואלי, תוצאות שמות בלבד) — מטמון 5 דקות; הנוהל המלא: docs/secret-hygiene.md"
      },
      knownOpenItems: [
        ...(adminKeyFileInTree ? ["SH-7: קובץ מפתח-אדמין מקומי בתוך עץ הפרויקט (upload/saos-admin-key.txt) — נדרשת העברה מחוץ לעץ (החלטת בעלים; קיום בלבד נבדק, התוכן לא נקרא)"] : []),
        "SH-3: קובץ היסטורי לא-מסווג בהיסטוריית git — דורש החלטת בעלים (docs/secret-hygiene.md)",
        "GitHub Actions CI לא קיים — הרצת בדיקות ידנית (bun run check)",
        "SQLite single-writer — לא לפריסה אופקית"
      ],
      mode: mode.mode,
      generatedAt: new Date().toISOString(),
      note: "קריאה-בלבד: git/fs/OpLog — אפס ערכי-סוד, אפס תוכן קבצים, אפס כתיבה"
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "repo-status failed" }, { status: 200 });
  }
}
