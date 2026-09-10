/**
 * instrumentation-node.ts — מפקח-שירותים בפועל (Task 62: הופרד מ-instrumentation.ts)
 *
 * הבעיה שנתגלתה חיה (Task 62, 2026-09-10): המפקח הזה מעולם לא רץ — 13 שעות
 * זמינות-שרת ואפס רשומות [SUPERVISOR] בלוגים. Turbopack מהדר את instrumentation.ts
 * גם ל-Edge Runtime, ושם ה-APIs של node (fs/path/child_process/process.kill/process.cwd)
 * נכשלים-קומפילציה ("Ecmascript file had an error") — והמודול כולו מת, גם ל-nodejs.
 * התוצאה בפועל: כל שירותי-הרקע מתים עם ה-reaper, ואין מי שמחזיר אותם —
 * בדיוק כפי ש-roast 61 גילה עם keepalive.sh (שגם הוא נשחט — הוא עצמו תהליך-רקע).
 *
 * הפתרון: instrumentation.ts = קליפה נקייה-Edge (אפס importי-node סטטיים) שמפעילה
 * את הקובץ הזה ב-dynamic-import רק תחת NEXT_RUNTIME === "nodejs". הקובץ הזה רץ
 * בתוך תהליך-ה-dev שהפלטפורמה מחזיקה בחיים — היחיד ששורד את ה-reaper — ולכן
 * ה-watchdog כאן הוא בן-המשפחה היחיד שבאמת מחייה.
 *
 * Task 62: fleet-cure (:3034) נוסף לרשימת-הפיקוח — roast 61 בנה אותו ושכח לרשום אותו
 * אצל המפקח הפנימי; spawn דרך `bun run dev` של כל-שירות (package.json — כבוד
 * לבחירת --hot/לא---hot של כל-שירות, למשל chief ללא --hot).
 *
 * sovereign-takeover (roast 73, 2026-09-10): key-broker (:3040) — שער-החתימה של
 * מישור-הריבונות — נבנה ונרשם במפקח (probe /ping פומבי-מינימלי, כמו signer/fleet-cure).
 *
 * כיבוי-ידני פר-שירות: SAOS_NO_GUARDIAN=1 · SAOS_NO_CHIEF=1 · SAOS_NO_SIGNER=1 · SAOS_NO_FLEET_CURE=1 · SAOS_NO_KEY_BROKER=1
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";

interface Watched {
  name: string;
  dir: string;
  port: number;
  statusUrl: string;
  logFile: string;
  disabled: boolean;
  startDelayMs: number;
  child: ReturnType<typeof spawn> | null;
  attempts: number;
  starting: boolean;
}

const mk = (name: string, port: number, logFile: string, disableEnv: string, startDelayMs: number, probePath = "/status"): Watched => ({
  name,
  dir: path.join(process.cwd(), "mini-services", name),
  port,
  statusUrl: `http://127.0.0.1:${port}${probePath}`,
  logFile,
  disabled: isDisabled(disableEnv),
  startDelayMs,
  child: null,
  attempts: 0,
  starting: false,
});

/**
 * isDisabled — Task 62: הפקדי-הכיבוי SAOS_NO_* נקראים מה-.env הנוכחי ולא מה-env
 * של עת-העלייה. נמדד חי: התהליך עלה ב-02:13 עם SAOS_NO_GUARDIAN=1/SAOS_NO_CHIEF=1
 * (הצמדה-זמנית לחקירת-מוות של chief), ה-.env טוהר ב-03:03 — אבל התהליך המשיך
 * לשאת את הערכים-הרעילים 14 שעות, והמפקח "כיבד" הנחיה שכבר לא הייתה קיימת.
 * ה-.env בדיסק הוא מקור-האמת לקונפיגורציה; env-עת-עלייה עבור הדגלים האלה הוא
 * תמונת-מצב שעלולה להיות מיושנת. (הקריאה מטוהרת: רק שורות SAOS_NO_* — אף-סוד לא נטען.)
 */
function isDisabled(disableEnv: string): boolean {
  const fromProcess = process.env[disableEnv] === "1";
  try {
    const envPath = path.join(process.cwd(), ".env");
    const raw = fs.readFileSync(envPath, "utf8");
    const line = raw.split("\n").find((l) => l.trim().startsWith(`${disableEnv}=`));
    const fromFile = line !== undefined && line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") === "1";
    if (fromProcess && !fromFile) return false; // drift: התהליך נושא דגל ישן שנמחק מה-.env — ה-.env מנצח
    return fromProcess || fromFile;
  } catch {
    return fromProcess; // אין .env קריא — ה-env של התהליך הוא כל-מה שיש
  }
}

const SERVICES: Watched[] = [
  mk("vault-guardian", 3031, "guardian-dev.log", "SAOS_NO_GUARDIAN", 15_000),
  mk("chief-of-staff", 3032, "chief-dev.log", "SAOS_NO_CHIEF", 25_000),
  // external-signer אין /status — רק /ping (ללא-אימות) ו-/health (Bearer) — ה-ping הוא ה-probe
  mk("external-signer", 3033, "signer-dev.log", "SAOS_NO_SIGNER", 35_000, "/ping"),
  // Task 62: fleet-cure — /ping ללא-אימות (ה-/status דורש admin-token)
  mk("fleet-cure", 3034, "fleet-cure-dev.log", "SAOS_NO_FLEET_CURE", 45_000, "/ping"),
  // roast 73: key-broker — שער-החתימה הריבוני (:3040) — /ping ללא-אימות
  mk("key-broker", 3040, "key-broker-dev.log", "SAOS_NO_KEY_BROKER", 55_000, "/ping"),
];

const logFor = (s: Watched, msg: string) => {
  try {
    fs.appendFileSync(path.join(s.dir, s.logFile), `${new Date().toISOString()} [SUPERVISOR] ${msg}\n`);
  } catch {}
};

// Task 62: TCP-connect probe — Next.js מציג (patch) את global fetch (לצרכי-caching),
// ובתהליך-ה-dev fetch-חיישן ל-פורט-מת עלול להיתקע לנצח (נמדד חי: startOf נתקע
// בלי-לוג ובלי-סיום). socket TCP לא עובר דרך ה-fetch המוצג ומקבל ECONNREFUSED מיידי.
const tcpAlive = (port: number, timeoutMs = 2500): Promise<boolean> =>
  new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch {}
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    try { sock.connect(port, "127.0.0.1"); } catch { done(false); }
  });

const aliveOf = async (s: Watched): Promise<boolean> => {
  if (!(await tcpAlive(s.port))) return false;
  // בדיקת-זומבי (Task 20): tick.alive — best-effort עם hard-cap: אף-hang של ה-fetch
  // המוצג של Next לא רשאי לתקוע את startOf (השער של Task 62)
  try {
    const res = await Promise.race([
      fetch(s.statusUrl, { signal: AbortSignal.timeout(3000) }),
      new Promise<null>((r) => setTimeout(() => r(null), 3500)),
    ]);
    if (res === null) return true; // פורט-חי, HTTP תלוי — סומכים על הפורט
    if (!res.ok) return false;
    const j: { tick?: { alive?: boolean } } | null = await Promise.race([
      res.json(),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ]);
    if (j && typeof j === "object" && j.tick && j.tick.alive === false) return false;
    return true;
  } catch {
    return true; // פורט-חי, HTTP תקול — חי-לכל-דבר (ה-tick בדיקה-היטב)
  }
};

const startOf = async (s: Watched) => {
  if (s.starting || s.disabled) return;
  s.starting = true;
  try {
    if (await aliveOf(s)) { s.attempts = 0; return; } // בריא — מאפסים בק-אוף, לא מכפילים
    s.attempts++;
    const delay = Math.min(30000, 2000 * s.attempts); // בק-אוף עד 30 שניות
    logFor(s, `spawn attempt #${s.attempts} (backoff ${delay}ms)`);
    // ילד-קודם שכשל (למשל פורט-תפוס ונשאר כצופה-זומבי): מפנים לפני spawn חדש
    try { if (s.child && s.child.pid) process.kill(s.child.pid, "SIGKILL"); } catch {}
    s.child = spawn("bun", ["run", "dev"], {
      cwd: s.dir,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env },
    });
    try { s.child.unref(); } catch {}
  } catch (e) {
    logFor(s, "spawn error: " + String((e as Error)?.message || e));
  } finally {
    s.starting = false;
  }
};

export function startSupervisor() {
  // מחזור-פיקוח כל 60 שניות: /status חי? מספיק. מת? מפעילים מחדש.
  setInterval(() => {
    void healNow();
  }, 60_000);

  // הפעלה ראשונית מדורגת (נותן לשרת להתייצב)
  for (const s of SERVICES) {
    if (!s.disabled) setTimeout(() => void startOf(s), s.startDelayMs);
  }

  // Task 62: canary — ראיה ראשונה שהמפקח באמת רץ (עד היום: אפס רשומות ב-13 שעות)
  for (const s of SERVICES) {
    logFor(s, `supervisor registered (TCP-probe + race-hardened aliveOf) — watchdog every 60s`);
  }
}

/**
 * supervisorStatus — אמת-המפקח לדיווח כנה ב-/status (Task 62): פר-שירות — חי
 * (TCP), מנוטרל-קונפיגורציה, ניסיונות-החייאה. זו הטענה היחידה שמותר למסך להציג.
 */
export async function supervisorStatus(): Promise<Array<{ name: string; port: number; alive: boolean; disabled: boolean; attempts: number }>> {
  const out: Array<{ name: string; port: number; alive: boolean; disabled: boolean; attempts: number }> = [];
  for (const s of SERVICES) {
    const alive = s.disabled ? false : await tcpAlive(s.port, 1500);
    out.push({ name: s.name, port: s.port, alive, disabled: s.disabled, attempts: s.attempts });
  }
  return out;
}

/**
 * healNow — בדיקה-אחת של כל-השירותים והחייאת-מתים (Task 62).
 * נקרא מ-supervisor-bridge על כל-בקשה חיה (מוגבל-תדירות שם ל-30ש) — ריפוי
 * מונע-בקשות שאינו תלוי כלל בטיימרים של תהליך-ה-dev (נמדד חי: טיימרי-רקע
 * בתוך Next-dev עם Turbopack אינם-אמינים; spawn-ילדים מתהליך-חי — כן:
 * signer/fleet-cure שנולדו-כאן ב-16:08 שרדו את ה-reaper, כי הוריהם חיים).
 */
export async function healNow(): Promise<void> {
  for (const s of SERVICES) {
    if (s.disabled) continue;
    try {
      if (!(await aliveOf(s))) await startOf(s);
    } catch {}
  }
}
