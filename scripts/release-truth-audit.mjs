#!/usr/bin/env node
// ============================================================================
// release-truth-audit — ביקורת אמת-שחרור עבור saos-sovereign-foundry
//
// התאמה חדשה (rewrite) שתבנית ה-self-audit CLI מ-tfa-evolution-studio
// (מקור: Project-files ZIP "tfa-evolution-studio-validated (2).zip" →
//  tasks/scripts/self-audit.mjs — נקרא סטטית בלבד, מעולם לא הורץ — כלל-החבלן).
// כמו המקור: zero-dependency (builtins בלבד), יוצא 1 על ממצא חוסם-שחרור.
//
// בדיקות אמת-שחרור (AGENTS.md — "הוכחה או שקט"):
//   1. bun run lint עובר
//   2. bunx tsc --noEmit עובר
//   3. git status --porcelain — אין קבצים לא-מחויבים בצורת-סוד
//      (.env*, *.enc, *.key, *token*) — נתיבים בלבד, אף ערך לא מודפס
//   4. docs/briefings/latest.md קיים וצעיר מ-24 שעות
//   5. worklog.md — הרשומה האחרונה פותחת בכותרת Task ID
//   6. AGENTS.md קיים (החוזה הקנוני במקום)
//
// רץ עם bun או node: `bun run release-truth-audit` / `bun scripts/release-truth-audit.mjs`
// קוד-יציאה: 0 = כל השערים עברו, 1 = יש נכשל אחד לפחות.
// ============================================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- helpers ---

/** מריץ פקודה ב-repoRoot ומחזיר {code, out, err, failed}. לא זורק — נכשל בכנות. */
function runCmd(cmd, args, timeoutMs) {
  const res = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.error) {
    return { code: null, out: "", err: String(res.error.message), failed: true };
  }
  return {
    code: res.status,
    out: res.stdout || "",
    err: res.stderr || "",
    failed: Boolean(res.killed),
  };
}

/** מצמצם פלט-פקודה לראיה קצרה: שורות אחרונות + hints מסוג file:line. */
function trimCmdOutput(out, err, maxLines = 8) {
  const lines = (out + (err ? "\n" + err : "")).split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const hints = [];
  for (const l of lines) {
    const m = l.match(/\S+\.(?:ts|tsx|mjs|js|cjs|json|md):\d+(?::\d+)?/);
    if (m && !hints.includes(m[0])) hints.push(m[0]);
    if (hints.length >= 3) break;
  }
  const tail = lines.slice(-maxLines).join("\n");
  return { tail, hints };
}

/** האם נתיב בצורת-סוד — .env*, *.enc, *.key, *token* (נתיב בלבד, לא תוכן). */
function isSecretShaped(p) {
  const base = path.posix.basename(p);
  return /^\.env/i.test(base) || /\.enc$/i.test(base) || /\.key$/i.test(base) || /token/i.test(p);
}

// ----------------------------------------------------------------- checks ---

const checks = [
  {
    id: 1,
    title: "lint — bun run lint",
    run() {
      const r = runCmd("bun", ["run", "lint"], 300_000);
      if (r.failed) return { ok: false, evidence: `הפקודה נכשלה לרוץ: ${r.err.trim().slice(0, 200)}` };
      if (r.code === 0) return { ok: true, evidence: "exit=0 (eslint .)" };
      const { tail, hints } = trimCmdOutput(r.out, r.err);
      const hint = hints.length ? `hints: ${hints.join(", ")}` : tail.split("\n")[0];
      return { ok: false, evidence: `exit=${r.code}; ${hint}`, detail: tail };
    },
  },
  {
    id: 2,
    title: "typecheck — bunx tsc --noEmit",
    run() {
      const r = runCmd("bunx", ["tsc", "--noEmit"], 300_000);
      if (r.failed) return { ok: false, evidence: `הפקודה נכשלה לרוץ: ${r.err.trim().slice(0, 200)}` };
      if (r.code === 0) return { ok: true, evidence: "exit=0 (אין שגיאות-טיפוסים)" };
      const { tail, hints } = trimCmdOutput(r.out, r.err);
      const hint = hints.length ? `hints: ${hints.join(", ")}` : tail.split("\n")[0];
      return { ok: false, evidence: `exit=${r.code}; ${hint}`, detail: tail };
    },
  },
  {
    id: 3,
    title: "git — אין קבצים לא-מחויבים בצורת-סוד (.env*, *.enc, *.key, *token*)",
    run() {
      const r = runCmd("git", ["status", "--porcelain"], 60_000);
      if (r.failed || r.code !== 0) {
        return { ok: false, evidence: `git status נכשל (exit=${r.code ?? "?"})` };
      }
      const entries = r.out
        .split("\n")
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .map((l) => {
          const body = l.length > 3 ? l.slice(3) : l.trim();
          return body.includes(" -> ") ? body.split(" -> ").pop() : body;
        })
        .map((p) => p.replace(/^"|"$/g, ""));
      const secretShaped = entries.filter(isSecretShaped);
      if (secretShaped.length > 0) {
        // דיווח נתיב+מחלקה בלבד — אף ערך-סוד לא מודפס (כללי-אבטחה AGENTS.md)
        return {
          ok: false,
          evidence: `נמצאו ${secretShaped.length} נתיבים בצורת-סוד לא-מחויבים: ${secretShaped
            .slice(0, 5)
            .join(", ")}`,
          detail: "דרוש: גיבוי ל-vault/החזרה מ-gitignore-מדיני, ואז החרגה או מחיקה — החלטה מתועדת בלבד",
        };
      }
      const note =
        entries.length > 0
          ? `0 בצורת-סוד; ${entries.length} שינויים רגילים לא-מחויבים (מידע בלבד)`
          : "0 בצורת-סוד; עץ-עבודה נקי";
      return { ok: true, evidence: note };
    },
  },
  {
    id: 4,
    title: "בריף — docs/briefings/latest.md קיים וצעיר מ-24h",
    run() {
      const p = path.join(repoRoot, "docs", "briefings", "latest.md");
      if (!fs.existsSync(p)) return { ok: false, evidence: "docs/briefings/latest.md לא נמצא" };
      const st = fs.statSync(p);
      const ageH = (Date.now() - st.mtimeMs) / 3_600_000;
      const iso = st.mtime.toISOString();
      if (ageH >= 24) {
        return {
          ok: false,
          evidence: `גיל ${ageH.toFixed(1)}h >= 24h (mtime ${iso}) — ראש-המטה (:3032) לא הפיק בריף טרי`,
        };
      }
      return { ok: true, evidence: `גיל ${ageH.toFixed(1)}h < 24h (mtime ${iso})` };
    },
  },
  {
    id: 5,
    title: "worklog — הרשומה האחרונה פותחת בכותרת Task ID",
    run() {
      const p = path.join(repoRoot, "worklog.md");
      if (!fs.existsSync(p)) return { ok: false, evidence: "worklog.md לא נמצא" };
      const lines = fs.readFileSync(p, "utf-8").split("\n");
      let last = -1;
      let lastVal = "";
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^Task ID:\s*(\S+)\s*$/);
        if (m) {
          last = i;
          lastVal = m[1];
        }
      }
      if (last === -1) {
        return {
          ok: false,
          evidence: `לא נמצאה אף כותרת "Task ID:" ב-${lines.length} שורות — משמעת-תיעוד מופרת`,
        };
      }
      return { ok: true, evidence: `worklog.md:${last + 1} — "Task ID: ${lastVal}"` };
    },
  },
  {
    id: 6,
    title: "AGENTS.md — החוזה הקנוני קיים בשורש הריפו",
    run() {
      const p = path.join(repoRoot, "AGENTS.md");
      if (!fs.existsSync(p)) return { ok: false, evidence: "AGENTS.md לא נמצא בשורש" };
      const st = fs.statSync(p);
      const head = fs.readFileSync(p, "utf-8").split("\n")[0] || "";
      const ver = head.match(/גרסה\*?\*?:?\s*([0-9.]+)/);
      return {
        ok: true,
        evidence: `AGENTS.md (${(st.size / 1024).toFixed(1)}KB${ver ? `, גרסה ${ver[1]}` : ""})`,
      };
    },
  },
];

// ------------------------------------------------------------------ output ---

const results = checks.map((c) => ({ id: c.id, title: c.title, ...c.run() }));
const passed = results.filter((r) => r.ok).length;
const allOk = passed === results.length;

console.log("════════ ביקורת אמת-שחרור (release-truth-audit) — saos-sovereign-foundry ════════");
console.log("עקרון: הוכחה או שקט — כל שורה עם ראיה (AGENTS.md כלל-הברזל)\n");

for (const r of results) {
  const tag = r.ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${r.id}. ${r.title}`);
  console.log(`          ראיה: ${r.evidence}`);
  if (r.detail) {
    for (const l of r.detail.split("\n").slice(0, 8)) console.log(`            │ ${l}`);
  }
}

console.log("\n────────────────────────────────────────────────────────────────");
if (allOk) {
  console.log(`תוצאה: ${passed}/${results.length} עברו — אמת-שחרור תקינה (exit 0)`);
  process.exit(0);
} else {
  console.log(`תוצאה: ${passed}/${results.length} עברו — ${results.length - passed} נכשלו: אמת-השחרור מופרת (exit 1)`);
  console.log("כלל-הברזל: לא לכסות ממצאים אמיתיים — מתקנים את המקור ומתעדים ב-worklog.");
  process.exit(1);
}
