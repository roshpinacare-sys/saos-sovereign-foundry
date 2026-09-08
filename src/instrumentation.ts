/**
 * instrumentation.ts — מפקח-שירותים (Task 19)
 *
 * הבעיה: תהליכי-רקע שמופעלים מסשן-כלים נהרגים ע"י reaper של הסנדבוקס
 * שניות לאחר סגירת הסשן (אומת פעמיים: nohup וגם setsid — שניהם מתו).
 * הפתרון: ה-guardian נולד כילד-נפרד של שרת-ה-dev הראשי (שהפלטפורמה מחזיקה
 * בחיים) — ומפקח פנימי בודק כל דקה שהוא חי ומחזיר אותו בבק-אוף אם נפל.
 *
 * כיבוי-ידני: SAOS_NO_GUARDIAN=1
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SAOS_NO_GUARDIAN === "1") return;

  const { spawn } = await import("child_process");
  const fs = await import("fs");
  const path = await import("path");

  const GUARDIAN_DIR = path.join(process.cwd(), "mini-services", "vault-guardian");
  const DEVLOG = path.join(GUARDIAN_DIR, "guardian-dev.log");
  const STATUS_URL = "http://127.0.0.1:3031/status";

  const log = (msg: string) => {
    try {
      fs.appendFileSync(DEVLOG, `${new Date().toISOString()} [SUPERVISOR] ${msg}\n`);
    } catch {}
  };

  let child: ReturnType<typeof spawn> | null = null;
  let attempts = 0;
  let starting = false;

  const alive = async (): Promise<boolean> => {
    try {
      const r = await fetch(STATUS_URL, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return false;
      // Task 20: לא מספיק שה-/status עונה — הפעימה הפנימית חייבת להיות טרייה.
      // תופס מצב-זומבי: שרת חי, טיימרים מתים (נצפה בפועל ב-reload של bun --hot).
      try {
        const j: { tick?: { alive?: boolean } } = await r.json();
        if (j && typeof j === "object" && j.tick && j.tick.alive === false) return false;
      } catch {}
      return true;
    } catch {
      return false;
    }
  };

  const start = async () => {
    if (starting) return;
    starting = true;
    try {
      if (await alive()) { attempts = 0; return; } // בריא — מאפסים בק-אוף, לא מכפילים
      attempts++;
      const delay = Math.min(30000, 2000 * attempts); // בק-אוף עד 30 שניות
      log(`spawn attempt #${attempts} (backoff ${delay}ms)`);
      // ילד-קודם שכשל (למשל פורט-תפוס ונשאר כצופה-זומבי): מפנים לפני spawn חדש
      try { if (child && child.pid) process.kill(child.pid, "SIGKILL"); } catch {}
      child = spawn("bun", ["--hot", "index.ts"], {
        cwd: GUARDIAN_DIR,
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env },
      });
      try { child.unref(); } catch {}
    } catch (e) {
      log("spawn error: " + String((e as Error)?.message || e));
    } finally {
      starting = false;
    }
  };

  // מחזור-פיקוח כל 60 שניות: /status חי? מספיק. מת? מפעילים מחדש.
  setInterval(() => {
    void (async () => {
      if (!(await alive())) await start();
    })();
  }, 60_000);

  // הפעלה ראשונית אחרי 15 שניות (נותן לשרת להתייצב)
  setTimeout(() => void start(), 15_000);

  log("supervisor registered — guardian watchdog every 60s");
}
