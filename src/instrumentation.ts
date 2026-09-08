/**
 * instrumentation.ts — מפקח-שירותים (Task 19, Task 24: ריבוי-שירותים)
 *
 * הבעיה: תהליכי-רקע שמופעלים מסשן-כלים נהרגים ע"י reaper של הסנדבוקס
 * שניות לאחר סגירת הסשן (אומת פעמיים: nohup וגם setsid — שניהם מתו).
 * הפתרון: שירותי-הרקע נולדים כילדים-נפרדים של שרת-ה-dev הראשי (שהפלטפורמה
 * מחזיקה בחיים) — ומפקח פנימי בודק כל דקה שהם חיים ומחזיר אותם בבק-אוף.
 *
 * Task 20: לא מספיק שה-/status עונה — נבדקת גם טריות-הפעימה הפנימית
 * (tick.alive) כדי לתפוס מצב-זומבי (שרת חי, טיימרים מתים).
 *
 * Task 24: הכללה לרשימת-שירותים — vault-guardian (3031) + chief-of-staff (3032).
 *
 * כיבוי-ידני: SAOS_NO_GUARDIAN=1 (guardian) · SAOS_NO_CHIEF=1 (ראש-המטה)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SAOS_NO_GUARDIAN === "1" && process.env.SAOS_NO_CHIEF === "1") return;

  const { spawn } = await import("child_process");
  const fs = await import("fs");
  const path = await import("path");

  interface Watched {
    name: string;
    dir: string;
    statusUrl: string;
    logFile: string;
    disabled: boolean;
    startDelayMs: number;
    child: ReturnType<typeof spawn> | null;
    attempts: number;
    starting: boolean;
  }

  const mk = (name: string, port: number, logFile: string, disableEnv: string, startDelayMs: number): Watched => ({
    name,
    dir: path.join(process.cwd(), "mini-services", name),
    statusUrl: `http://127.0.0.1:${port}/status`,
    logFile,
    disabled: process.env[disableEnv] === "1",
    startDelayMs,
    child: null,
    attempts: 0,
    starting: false,
  });

  const SERVICES: Watched[] = [
    mk("vault-guardian", 3031, "guardian-dev.log", "SAOS_NO_GUARDIAN", 15_000),
    mk("chief-of-staff", 3032, "chief-dev.log", "SAOS_NO_CHIEF", 25_000),
    mk("external-signer", 3033, "signer-dev.log", "SAOS_NO_SIGNER", 35_000),
  ];

  const logFor = (s: Watched, msg: string) => {
    try {
      fs.appendFileSync(path.join(s.dir, s.logFile), `${new Date().toISOString()} [SUPERVISOR] ${msg}\n`);
    } catch {}
  };

  const aliveOf = async (s: Watched): Promise<boolean> => {
    try {
      const r = await fetch(s.statusUrl, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return false;
      // Task 20: בדיקת טריות-פעימה פנימית — תופס מצב-זומבי (שרת חי, טיימרים מתים)
      try {
        const j: { tick?: { alive?: boolean } } = await r.json();
        if (j && typeof j === "object" && j.tick && j.tick.alive === false) return false;
      } catch {}
      return true;
    } catch {
      return false;
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
      s.child = spawn("bun", ["--hot", "index.ts"], {
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

  // מחזור-פיקוח כל 60 שניות: /status חי? מספיק. מת? מפעילים מחדש.
  setInterval(() => {
    void (async () => {
      for (const s of SERVICES) {
        if (s.disabled) continue;
        if (!(await aliveOf(s))) await startOf(s);
      }
    })();
  }, 60_000);

  // הפעלה ראשונית מדורגת (נותן לשרת להתייצב)
  for (const s of SERVICES) {
    if (!s.disabled) setTimeout(() => void startOf(s), s.startDelayMs);
  }

  logFor(SERVICES[0], "supervisor registered — watchdog every 60s (guardian + chief-of-staff)");
}
