/**
 * chief-of-staff/index.ts — ראש-המטה הריבוני (Task 24)
 * =====================================================
 * הנחיית-בעלים 2026-09-08: "אני צריך אינטליגנציה שתנהל את הפרויקט עבורי...
 * שחרר אותי מתלות" — הבעלים מוסמך-החלטות אחרון בלבד; הניהול השוטף כאן.
 *
 * מה זה עושה:
 *   1. כל 30 דקות (וגם בדרישה POST /brief) אוסף מצב-רשת:
 *      guardian /status, HEAD + 5 קומיטים אחרונים, פתוחים מ-next-steps,
 *      בריאות שירותים, תמצית בריף קודם.
 *   2. אם המצב השתנה (fingerprint) → קריאת-LLM (z-ai-web-dev-sdk, backend)
 *      עם חוזה ראש-מטה: מצב / סיכונים / 3 פעולות-הבאות עם בעלים /
 *      החלטות שקיבלתי בעצמי / מה נשאר לבעלים בלבד.
 *   3. הבריף נכתב docs/briefings/BRIEF-<ts>.md + latest.md (ערוץ בין-סוכנים —
 *      "הסוכנים האחרים מסתכלים עליך"). לא קומיט מ-כאן — הסוכן התורן מקדם.
 *
 * כללי-ברזל: אפס סודות בקלט/פלט/לוג; אף ביצוע-פעולה אוטומטי מכאן —
 * ראש-המטה מנתח וממליץ, הסוכנים התורנים מבצעים עם ראיות.
 *
 * כיבוי-ידני: SAOS_NO_CHIEF=1  ·  פורט: 3032
 */
import fs from "fs";
import path from "path";
// roast 61: the SDK import is GONE from the long-lived process on purpose —
// the LLM call runs in an ephemeral child (brief-worker.ts). Measured live:
// an in-process SDK call killed the whole detached service silently during
// cycle #1 on every background boot (and killed the original instance at
// 01:44). The parent now survives any SDK crash and reports it honestly.

const PORT = 3032;
const TICK_MS = 30_000;
const CYCLE_MS = 30 * 60_000;
const FIRST_CYCLE_DELAY_MS = 20_000;
const FOUNDRY = "/home/z/my-project";
const BRIEF_DIR = path.join(FOUNDRY, "docs", "briefings");
const GUARDIAN_URL = "http://127.0.0.1:3031/status";
const KEEP_BRIEFS = 30;
const CHIEF_LOG = path.join(import.meta.dir, "chief.log");

let lastTickAt = Date.now();
let cycles = 0;
let llmCalls = 0;
let lastBriefAt: string | null = null;
let lastBriefFile: string | null = null;
let lastStateHash = "";
let busy = false;
let lastError: string | null = null;

const log = (level: string, msg: string) => {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  try { console.log(line); } catch {}
  try { fs.appendFileSync(CHIEF_LOG, line + "\n"); } catch {}
};

function tickAlive(): boolean {
  return Date.now() - lastTickAt < 3 * TICK_MS;
}

async function sh(cmd: string, cwd = FOUNDRY, timeoutMs = 15_000): Promise<string> {
  const { exec } = await import("child_process");
  return await new Promise<string>((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? "" : String(stdout));
    });
  });
}

async function fetchJson(url: string, timeoutMs = 4000): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTail(p: string, max = 4000): string {
  try {
    const txt = fs.readFileSync(p, "utf8");
    return txt.length > max ? "…\n" + txt.slice(-max) : txt;
  } catch {
    return "(לא זמין)";
  }
}

interface Gathered {
  hash: string;
  text: string;
}

async function gather(): Promise<Gathered> {
  const guardian = await fetchJson(GUARDIAN_URL);
  const head = (await sh("git rev-parse --short HEAD")).trim();
  const commits = (await sh(`git log --format="- %h %s" -5`)).trim();
  const briefings = fs.existsSync(BRIEF_DIR)
    ? fs.readdirSync(BRIEF_DIR).filter((f) => f.startsWith("BRIEF-")).sort().slice(-5).join(", ") || "(אין)"
    : "(אין)";

  // Task 59 (owner asked "which headcorner key is missing?" after a brief
  // claimed headcorner/tov were unprotected): the chief NEVER asked the signer
  // what the vault actually holds — the LLM composed key-state claims from
  // historical commit messages and stale docs. The vault section below is the
  // LIVE measured state (keyless counts only — no secret/public key material
  // ever enters the LLM input). It is also part of the fingerprint so a vault
  // change triggers a fresh brief.
  let vault = "כספת: לא זמינה (חותם :3033 לא נגיש)";
  let vaultFingerprint = "unreachable";
  try {
    const token = fs.readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "external-signer-token"), "utf8").trim();
    if (token) {
      const r = await fetch("http://127.0.0.1:3033/keys/status", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      });
      if (r.ok) {
        const s = (await r.json()) as {
          main?: { account?: string; networks?: Record<string, Record<string, { loaded?: boolean; match?: boolean }>> };
          fleet?: Array<{ username?: string }>;
          drift?: { summary?: Record<string, number>; lastCheck?: string | null };
          sealedAt?: string;
        };
        const parts: string[] = [];
        for (const [net, roles] of Object.entries(s.main?.networks ?? {})) {
          const loaded = Object.values(roles ?? {}).filter((x) => x?.loaded).length;
          const matched = Object.values(roles ?? {}).filter((x) => x?.loaded && x?.match).length;
          parts.push(`${net} ${matched}/${loaded}`);
        }
        const fleetNames = (s.fleet ?? []).map((f) => f.username).filter(Boolean);
        const ds = s.drift?.summary ?? {};
        vault = `כספת-חי (מקור-אמת מהחותם :3033 — ספירות-בלבד): main=${s.main?.account ?? "?"} slots ${parts.join(" · ")} | fleet-with-keys=[${fleetNames.join(",") || "אין"}] | drift ok=${ds.ok ?? "?"} drift=${ds.drift ?? "?"} unmatched=${ds.unmatched ?? "?"} | sealedAt=${s.sealedAt ?? "?"}`;
        vaultFingerprint = `${parts.join(",")}|${fleetNames.join(",")}|ok=${ds.ok}`;
      } else {
        vault = `כספת: החותם החזיר ${r.status}`;
      }
    }
  } catch (e) {
    vault = `כספת: שגיאה ${String((e as Error)?.message ?? e).slice(0, 80)}`;
  }

  const g = guardian
    ? `guardian: ok=${(guardian as { ok?: boolean }).ok} runs=${(guardian as { runCount?: number }).runCount} devMode=${(guardian as { devMode?: boolean }).devMode} tickAlive=${(guardian as { tick?: { alive?: boolean } }).tick?.alive} token=${((guardian as { token?: { present?: boolean } }).token ?? {}).present}`
    : "guardian: לא זמין";
  const text = [
    `HEAD: ${head}`,
    // Task 59: vault BEFORE the (huge) commit messages — the brief file embeds
    // only the first 5000 chars of the input, and the roast commit messages
    // alone exceed that; the live vault evidence must survive the preview.
    vault,
    g,
    commits,
    `briefings אחרונים: ${briefings}`,
    "── זנב next-steps.md ──",
    readTail(`${FOUNDRY}/docs/next-steps.md`, 3500),
    "── זנב owner-decisions.md ──",
    readTail(`${FOUNDRY}/docs/owner-decisions.md`, 2000),
  ].join("\n");
  // טביעת-אצבע: שינוי HEAD או פעילות-guardian או מצב-כספת או מספר-בריפים → מצב חדש
  const hashSource = `${head}|${(guardian as { runCount?: number })?.runCount ?? 0}|${briefings}|${vaultFingerprint}`;
  const hash = Buffer.from(hashSource).toString("base64").slice(0, 32);
  return { hash, text };
}

const SYSTEM_PROMPT = `אתה ראש-המטה של פרויקט SAOS — רשת סוכנים ריבונית על בלוקצ'יין Steem/SOL/EVM (repos פרטיים תחת roshpinacare-sys, סביבת פיתוח, הנחיית-בעלים 2026-09-08: סוכנים מורשים לגישת-מפתחות וביצוע בסביבה הפרטית; הבעלים משוחרר מתלות ומקבל רק החלטות-על).

תפקידך: נתח את מצב-הרשת שניתן לך והפק בריף ניהולי בעברית, תמציתי ומבוסס-ראיות בלבד. אסור להמציא עובדות שאינן בקלט. אסור לכלול סודות/מפתחות/טוקנים (גם אם מופיעים — החלף ב-<REDACTED>).

כלל-השתרשות-מפתחות (Task 59): בכל מה שנוגע למפתחות/כספת/חשבונות — המקור-המחייב הוא **סעיף כספת-חי בקלט** (מהחותם :3033, נמדד רגע-כתיבת-הבריף). אסור להסיק מצב-מפתחות מהודעות-קומיט או מסמכים היסטוריים — הם מתארים את העבר. אם סעיף-הכספת אומר שסלוטים מאומתים — אסור לטעון שחשבון "אינו מוגן"/"ממתין למפתח" בלי שהקלט אומר זאת.

פורמט-חובה (Markdown):
## מצב רשת (2-4 שורות)
## סיכונים / דברים מדממים (או "אין")
## 3 פעולות הבאות — כל אחת: [סוכן-בעלים] פעולה מדויקת + קריטריון-אימות
## החלטות שאני (ראש-המטה) מקבל עכשיו בעצמי
## נשאר לבעלים בלבד (או "כלום")

כללים: פעולות חייבות להיות ניתנות-לביצוע ע"י סוכן תורן בתוך הסביבה (קוד/דוק/בדיקה), ללא כסף-אמיתי מחוץ להיקף-הפיתוח שאושר, ללא force-push. אם הקלט דל — אמור זאת ותן את הפעולות הבטוחות ביותר.`;

async function writeBriefing(content: string, stateText: string): Promise<string> {
  fs.mkdirSync(BRIEF_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = `${BRIEF_DIR}/BRIEF-${ts}.md`;
  const header = [
    `# בריף ראש-המטה — ${new Date().toISOString()}`,
    ``,
    `> מופק אוטומטית ע"י mini-services/chief-of-staff (LLM). ניתוח-בלבד; ביצוע ע"י סוכן תורן עם ראיות.`,
    ``,
    `<details><summary>קלט-מצב (מקוצר)</summary>`,
    ``,
    "```",
    stateText.slice(0, 5000),
    "```",
    `</details>`,
    ``,
  ].join("\n");
  fs.writeFileSync(file, header + content + "\n");
  fs.writeFileSync(`${BRIEF_DIR}/latest.md`, header + content + "\n");
  // גיזום: שמור אחרונים בלבד
  const all = fs.readdirSync(BRIEF_DIR).filter((f: string) => f.startsWith("BRIEF-")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BRIEFS))) {
    try { fs.unlinkSync(`${BRIEF_DIR}/${old}`); } catch {}
  }
  return file;
}

/** roast 61: run the LLM in an ephemeral child — returns the content or throws */
async function callLlmWorker(system: string, user: string): Promise<string> {
  const proc = Bun.spawn(["bun", path.join(import.meta.dir, "brief-worker.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });
  proc.stdin.write(JSON.stringify({ system, user }));
  await proc.stdin.end();
  const killer = setTimeout(() => {
    try { proc.kill(); } catch {}
  }, 120_000);
  let code = 1;
  try {
    const [out, err, exited] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ]);
    code = exited;
    if (code !== 0) throw new Error(`brief-worker exit=${code}: ${err.trim().slice(0, 160) || "(no stderr)"}`);
    if (!out.trim()) throw new Error("brief-worker produced empty content");
    return out;
  } finally {
    clearTimeout(killer);
  }
}

async function cycle(force = false): Promise<{ skipped?: boolean; file?: string; error?: string }> {
  if (busy) return { skipped: true, error: "busy" };
  busy = true;
  try {
    cycles++;
    const { hash, text } = await gather();
    if (!force && hash === lastStateHash) {
      log("INFO", `cycle #${cycles}: state unchanged — LLM skipped`);
      return { skipped: true };
    }
    lastStateHash = hash;
    // roast 61: SDK isolated into an ephemeral worker child — the parent can
    // never be killed by the SDK again; a worker crash = logged lastError and
    // a retry next cycle. 120s timeout: a hung worker can never wedge `busy`.
    const content = await callLlmWorker(SYSTEM_PROMPT, `מצב-רשת נוכחי:\n\n${text}`);
    llmCalls++;
    const file = await writeBriefing(content, text);
    lastBriefAt = new Date().toISOString();
    lastBriefFile = file;
    lastError = null;
    log("INFO", `cycle #${cycles}: briefing written → ${file}`);
    return { file };
  } catch (e) {
    lastError = String((e as Error)?.message ?? e);
    log("ERROR", `cycle #${cycles} failed: ${lastError}`);
    return { error: lastError };
  } finally {
    busy = false;
  }
}

Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const u = new URL(req.url);
    if (u.pathname === "/status") {
      return Response.json({
        ok: true,
        service: "chief-of-staff",
        tick: { lastTickAt: new Date(lastTickAt).toISOString(), alive: tickAlive() },
        cycles, llmCalls, busy,
        lastBriefAt, lastBriefFile, lastError,
        cadence: { cycleMinutes: CYCLE_MS / 60000 },
      });
    }
    if (u.pathname === "/brief" && req.method === "POST") {
      const r = await cycle(true);
      return Response.json({ ok: !r.error, ...r });
    }
    if (u.pathname === "/briefing") {
      try {
        const txt = fs.readFileSync(path.join(BRIEF_DIR, "latest.md"), "utf8");
        return new Response(txt, { headers: { "content-type": "text/plain; charset=utf-8" } });
      } catch {
        return new Response("(no briefing yet)", { status: 404 });
      }
    }
    return new Response("chief-of-staff: see /status, POST /brief, GET /briefing\n", { status: 404 });
  },
});

setInterval(() => {
  lastTickAt = Date.now();
}, TICK_MS);

setInterval(() => {
  void cycle(false);
}, CYCLE_MS);

setTimeout(() => {
  void cycle(true); // בריף ראשוני מיידי
}, FIRST_CYCLE_DELAY_MS);

log("INFO", `chief-of-staff up on :${PORT} — first briefing in ${FIRST_CYCLE_DELAY_MS / 1000}s, cycle every ${CYCLE_MS / 60000}min`);
