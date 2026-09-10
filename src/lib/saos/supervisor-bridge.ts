/**
 * supervisor-bridge.ts — גשר-הפעלה של מפקח-השירותים בתוך תהליך-ה-Next (Task 62)
 *
 * למה זה קיים: המפקח הקנוני הוא src/instrumentation.ts (register) — אבל הוא רץ
 * פעם-אחת בעת-עליית-השרת. אם השרת עלה עם גרסה פגומה (בעיה שנמדדה חי: ה-Edge
 * קומפילציה של Turbopack הרגה את המודול 13 שעות), המפקח לא ירוץ עד ההפעלה
 * הבאה. הגשר הזה מבטיח שכל-בקשה חיה על נתיב-מרכזי מריצה healNow() — ריפוי
 * מונע-בקשות שאינו תלוי בטיימרים (נמדד חי: טיימרי-רקע בתוך Next-dev/Turbopack
 * אינם-אמינים; spawn מתהליך-חי שורד את ה-reaper כי הורה-חי = אין-יתום).
 *
 * בטיחות-כפילות: throttle של 30ש על globalThis (שורד HMR-regenerations) +
 * aliveOf probe לפני כל spawn בתוך instrumentation-node עצמו.
 *
 * כלל-השתמשות: import ברמת-מודול בנתיבי-API מרכזיים בלבד (status / live-proof /
 * keys-map) — לא ב-client, לא ב-Edge.
 */

const GUARD = "__saosSupervisorLastHealMs";

const HEAL_THROTTLE_MS = 30_000;

export function ensureSupervisor(): void {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const now = Date.now();
    const last = typeof g[GUARD] === "number" ? (g[GUARD] as number) : 0;
    if (now - last < HEAL_THROTTLE_MS) return;
    g[GUARD] = now;
    void import("@/instrumentation-node")
      .then((m) => m.healNow())
      .catch((e) => {
        try { (globalThis as unknown as Record<string, unknown>).__saosSupervisorErr = String((e as Error)?.message || e); } catch {}
      });
  } catch {
    // המפקח הוא שיפור-זמינות — אף-פעם לא מפיל בקשה
  }
}
