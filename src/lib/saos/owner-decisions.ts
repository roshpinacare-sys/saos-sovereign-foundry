/**
 * Owner decisions registry (רישום החלטות-בעלים) — Task 10.
 *
 * SOURCE DISCIPLINE: every entry here is compiled from the project's own
 * documentation (docs/decisions.md, docs/next-steps.md, docs/secret-hygiene.md,
 * docs/deployment.md) as of commit bb12c62 — nothing is invented. The UI shows
 * this registry together with its source reference, and the recorded status
 * (who decided what, when) lives in the DB via /api/saos/decisions.
 *
 * phase: "now" (blocks today's ops) | "before-anchor" (blocks a real anchor) |
 *        "before-live" (blocks live mode)
 */

export type DecisionPhase = "now" | "before-anchor" | "before-live";
export type DecisionCategory = "security" | "resources" | "governance" | "release";
export type DecisionSeverity = "critical" | "high" | "medium";

export interface OwnerDecision {
  key: string;
  name: string;
  description: string;
  category: DecisionCategory;
  severity: DecisionSeverity;
  options: string[];
  safeDefault: string;
  risk: string;
  cost: string;
  time: string;
  requiredAction: string;
  phase: DecisionPhase;
  ownerRole: "בעלים" | "בעלים/משאבים" | "סוכן" | "פריסה";
  critical: boolean;
  sourceRef: string;
}

export const OWNER_DECISIONS: OwnerDecision[] = [
  {
    key: "admin-key-location",
    name: "SH-7 — מיקום מפתח-האדמין: מחוץ לעץ הפרויקט",
    description:
      "קיים קובץ מפתח-אדמין מקומי upload/saos-admin-key.txt בתוך עץ הפרויקט (מנוטר ב-repo-status — נבדק קיום בלבד, תוכנו מעולם לא נקרא; upload/ חסום ב-gitignore והוא מעולם לא נכנס להיסטוריית הריפו). נוהל-קבע: המפתח צריך לחיות מחוץ לעץ הפרויקט — למשל ~/.secrets/saos-admin-key עם הרשאות 600 — ולא להישמר בצ׳אט, בריפו או ב-worklog. המערכת עצמה מאחסנת hash בלבד (SAOS_ADMIN_KEY_HASH) — לעולם לא את המפתח הגלוי.",
    options: [
      "העברה מחוץ לעץ: ~/.secrets/saos-admin-key, הרשאות 600, עדכון .env בלי להדפיס את המפתח",
      "רוטציה מלאה (מפתח חדש + hash חדש ב-.env) — חובה אם יש חשש שנחשף",
      "השארה במקום (לא מומלץ — סיכון כניסה בטעות לריפו/גיבוי/ארכיון)"
    ],
    safeDefault: "העברה מחוץ לעץ הפרויקט עם הרשאות 600, בלי להדפיס/להעתיק את המפתח בשום ערוץ",
    risk: "מפתח בתוך עץ פרויקט עלול להיכנס בטעות לריפו, לגיבוי או לארכיון; אם נחשף — נדרשת רוטציה מיידית",
    cost: "אפס",
    time: "דקות (העברה + עדכון נתיב ב-.env)",
    requiredAction: "להעביר את הקובץ מחוץ לעץ (למשל ~/.secrets/saos-admin-key), להגדיר 600, למחוק את העותק המקומי; לבצע רוטציה אם יש חשש חשיפה — ולתעד כפעולת בעלים",
    phase: "now",
    ownerRole: "בעלים",
    critical: true,
    category: "security",
    severity: "critical",
    sourceRef: "docs/secret-hygiene.md SH-7"
  },
  {
    key: "sh3-historical-file",
    name: "SH-3 — קובץ היסטורי לא-מוכר בהיסטוריית git",
    description:
      "בהיסטוריית הריפו (5356dab→c69e6e4) קיים קובץ upload/חח.txt (~101 בייט) שתוכנו לא אומת. לא נגעו בו: שכתוב היסטוריה אסור ללא אישור בעלים.",
    options: [
      "אישור שהתוכן לא-רגיש → סוגרים את SH-3 בלי שינוי",
      "תוכן רגיש → סיבוב-סוד + ניקוי היסטוריה מבוקר (רק באישור בעלים)"
    ],
    safeDefault: "לא לגעת בהיסטוריה עד סיווג התוכן על-ידי הבעלים",
    risk: "אם התוכן רגיש — הוא נותר נגיש לכל בעל גישה לריפו",
    cost: "אפס",
    time: "דקות (בדיקת תוכן ידנית מחוץ למערכת)",
    requiredAction: "לסווג את תוכן הקובץ ולהחליט: סגירה או ניקוי מבוקר",
    phase: "now",
    ownerRole: "בעלים",
    critical: true,
    category: "security",
    severity: "critical",
    sourceRef: "docs/secret-hygiene.md SH-3"
  },
  {
    key: "push-approval",
    name: "אישור דחיפה לריפו בכל סבב",
    description:
      "פרוטוקול הדחיפה הבטוחה דורש אישור בעלים לדחיפה: קומיט מקומי → סריקת סודות → fetch → push רגיל (ללא כוח, ללא מחיקה, ללא שכתוב היסטוריה).",
    options: ["אישור דחיפה לסבב", "קומיט מקומי בלבד עד לאישור"],
    safeDefault: "בלי אישור מפורש — קומיט מקומי בלבד; הדחיפה נחסמת ומתועדת",
    risk: "דחיפה ללא סריקה עלולה לחשוף סודות — הפרוטוקול מחייב סדר",
    cost: "אפס",
    time: "דקות",
    requiredAction: "לאשר (או לדחות) דחיפת הסבב ל-origin/main",
    phase: "now",
    ownerRole: "בעלים",
    critical: false,
    category: "governance",
    severity: "medium",
    sourceRef: "docs/deployment.md + פרוטוקול הדחיפה הבטוחה"
  },
  {
    key: "vault-restore",
    name: "שחזור כספת חתימה (STEEM/BLURT/HIVE)",
    description:
      "אין מפתחות חתימה בסביבה — כל הרשתות במצב dry-run-only. שחזור המפתחות נעשה מחוץ למערכת; המערכת מקבלת רק את התוצאה הציבורית (txid).",
    options: [
      "שחזור מהכספת ההיסטורית מחוץ לסנדבוקס והפעלת מחזור העוגן הראשון",
      "השארה ב-dry-run (מצב בטוח, אין עוגנים אמיתיים)"
    ],
    safeDefault: "לא להזין מפתחות למערכת בשום צורה (חוק-זהב)",
    risk: "מפתח שנחשף לסוכן/ריפו = סיכון קטסטרופלי; המסלול המאושר הוא חתימה חיצונית בלבד",
    cost: "לפי כספת",
    time: "שעות (תרגול מדריך external-signer.md)",
    requiredAction: "לבצע את שלב החתימה במדריך docs/external-signer.md",
    phase: "before-anchor",
    ownerRole: "בעלים",
    critical: true,
    category: "resources",
    severity: "critical",
    sourceRef: "docs/next-steps.md §חסימות לפני מצב-חי + docs/external-signer.md"
  },
  {
    key: "hive-rc-floor",
    name: "HIVE RC מתחת לסף (rc-floor)",
    description:
      "רמת ה-RC הנוכחית (env, ברירת-מחדל 0.6%) מתחת לסף-הקל (8%) — עגינת HIVE נשארת gated. נדרש power-up/delegate או המתנה לרגן (~20%/יום).",
    options: ["power-up / delegate VESTS להאצה", "המתנה לרגן טבעי", "לוותר על HIVE לשלב זה"],
    safeDefault: "המתנה לרגן — אין פעולה חיה עד לסף",
    risk: "עגינה מעל הסף בכוח תיכשל ברשת הציבורית",
    cost: "לפי סכום ה-power-up",
    time: "כ-8.9 שעות רגן לסף-הקל (מחושב ב-/energy)",
    requiredAction: "לממן power-up/delegate או לאשר המתנה",
    phase: "before-anchor",
    ownerRole: "בעלים/משאבים",
    critical: true,
    category: "resources",
    severity: "critical",
    sourceRef: "docs/next-steps.md §טבלת חסימות + docs/anchor-preflight.md"
  },
  {
    key: "tron-stake",
    name: "TRON energy = 0 — מימון הימור TRX",
    description:
      "אפס אנרגיה בכתובות הכספת — עגינת TRON במצב transit (tronbridge יומית). לעגינה ישירה נדרש הימור ≥ 25,958 TRX ל-4 יישובי USDT/יום, או שריפה ~27.26 TRX/tx.",
    options: ["הימור freezeBalanceV2 + delegateResource", "שריפה לכל עסקה", "הישארות ב-tronbridge"],
    safeDefault: "הישארות ברכבת tronbridge היומית",
    risk: "עגינה ישירה ללא אנרגיה = שריפת TRX מיותרת או כישלון שידור",
    cost: "≥ 25,958 TRX (הימור) או ~27.26 TRX/tx (שריפה)",
    time: "מיידי אחרי מימון",
    requiredAction: "לממן TRX ולבחור מסלול (הימור/שריפה) או לאשר המשך transit",
    phase: "before-anchor",
    ownerRole: "בעלים/משאבים",
    critical: true,
    category: "resources",
    severity: "critical",
    sourceRef: "docs/next-steps.md §טבלת חסימות + tron-energize.ts"
  },
  {
    key: "live-mode-approval",
    name: "אישור מעבר למצב live",
    description:
      "מעבר ל-live דורש החלטת בעלים מפורשת + שני דגלים עצמאיים (SAOS_MODE=live ו-SAOS_LIVE_CONFIRM=YES) והפעלה-מחדש. גם אז broadcastCapable יישאר false עד חיבור חותם חיצוני.",
    options: ["אישור live", "הישארות ב-dry-run", "מצב safe (חסימת כתיבה)"],
    safeDefault: "הישארות ב-dry-run עד השלמת כל החסימות",
    risk: "live ללא השלמת חסימות = חשיפה מבצעית; אין דרך מקרית בטעות (הגנה כפולה)",
    cost: "אפס",
    time: "דקות + הפעלה-מחדש",
    requiredAction: "לאשר live רק אחרי שה-live-gate ירוק ללא blockers",
    phase: "before-live",
    ownerRole: "בעלים",
    critical: true,
    category: "governance",
    severity: "critical",
    sourceRef: "docs/decisions.md D12 + docs/deployment.md §מעברי-מצב"
  },
  {
    key: "build-verification",
    name: "אימות build מחוץ לסנדבוקס",
    description:
      "bun run build מוגדר אך חסום-סביבה (מדיניות dev-server בלבד). לפני פריסה אמיתית נדרשת ריצת build מוצלחת בסביבה חופשית.",
    options: ["הרצת build בסביבת פריסה", "דחייה (נשאר חסום-סביבה)"],
    safeDefault: "דחייה — המערכת לא נחשבת מאומתת-פריסה",
    risk: "build לא-מאומת = סיכון פריסה",
    cost: "אפס",
    time: "דקות בסביבה חופשית",
    requiredAction: "להריץ bun run build מחוץ לסנדבוקס ולתעד תוצאה",
    phase: "before-live",
    ownerRole: "בעלים",
    critical: false,
    category: "release",
    severity: "medium",
    sourceRef: "docs/next-steps.md + docs/deployment.md"
  },
  {
    key: "github-actions-ci",
    name: "GitHub Actions CI",
    description:
      "אין ריצת CI אוטומטית על push — כל הבדיקות ידניות (bun run check). הוספת workflow שמריץ check ב-push סוגרת את הפער.",
    options: ["workflow שמריץ lint+typecheck+test+verify", "השארה ידנית"],
    safeDefault: "הרצה ידנית ממושמעת לפני כל קומיט (המצב הקיים)",
    risk: "בלי CI — דריפת איכות אפשרית בין סבבים",
    cost: "דקות הקמה",
    time: "סבב עתידי",
    requiredAction: "להחליט אם להוסיף workflow בסבב הבא",
    phase: "now",
    ownerRole: "סוכן",
    critical: false,
    category: "release",
    severity: "medium",
    sourceRef: "docs/next-steps.md §מועמד לסבב 7"
  }
];

export const DECISION_PHASE_LABEL: Record<DecisionPhase, string> = {
  now: "נדרש עכשיו",
  "before-anchor": "נדרש לפני עוגן",
  "before-live": "נדרש לפני מצב חי"
};

/** the statuses an owner can record for a decision (Task 11 closure tooling) */
export const DECISION_STATUSES = [
  "open",
  "decided-default",
  "decided-custom",
  "needs-resource",
  "resolved-external",
  "deferred",
  "rejected"
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_CATEGORY_LABEL: Record<DecisionCategory, string> = {
  security: "אבטחה",
  resources: "משאבים",
  governance: "ניהול",
  release: "שחרור"
};
