/**
 * instrumentation.ts — קליפה נקייה-Edge (Task 62)
 *
 * היסטוריה: Task 19/24 בנו כאן מפקח-שירותים מלא (spawn + fs + path).
 * Task 62 גילה חי: המפקח מעולם לא רץ — Turbopack מהדר את הקובץ הזה גם ל-Edge,
 * שם כל APIי-ה-node שבו נכשלים-קומפילציה ("Ecmascript file had an error" ×5),
 * והמודול כולו מת — גם ל-runtime של nodejs. 13 שעות זמינות-שרת, אפס רשומות
 * [SUPERVISOR], וכל שירותי-הרקע מתים בלי מחליף (roast 61 תיקן עם keepalive.sh —
 * שגם הוא נשחט, כי גם הוא תהליך-רקע).
 *
 * הפתרון: הקובץ הזה מכיל אפס importי-node סטטיים — ה-Edge-קומפילציה שלו נקייה —
 * והלוגיקה כולה עברה ל-`./instrumentation-node.ts` שנטען ב-dynamic-import רק
 * תחת NEXT_RUNTIME === "nodejs" (התבנית הרשמית של Next.js לפיצול node/edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./instrumentation-node").then((m) => m.startSupervisor());
}
