# החלטות בעלים — Owner Decisions (Task 10, סגירה — Task 11 + סבב סגירה אוטונומי)

> המקור הרשמי של רישום החלטות-הבעלים בזמן-ריצה: `GET /api/saos/decisions`
> (הרישום מורכב מהתיעוד; הסטטוסים שהוקלטו — ב-DB, עם היסטוריית ביקורת).
> מסמך זה מתעד את המבנה, הנהלים, וההחלטות שנוספו/נסגרו ב-Task 11.

## 1. מבנה החלטה (חוזה מלא מאז Task 11)

| שדה | תיאור |
|---|---|
| `id` / `key` | מזהה יציב (מפתח הרישום) |
| `title` / `name` | כותרת ההחלטה |
| `description` | הקשר מלא |
| `category` | security · resources · governance · release |
| `severity` | critical · high · medium |
| `status` | open · decided-default · decided-custom · needs-resource · resolved-external · deferred · rejected |
| `options` | אפשרויות הבעלים |
| `defaultSafeAction` / `safeDefault` | ברירת-המחדל הבטוחה (מה שקורה בלי החלטה) |
| `requiredOwnerAction` | מה נדרש מהבעלים בפועל |
| `risk` / `cost` / `timeEstimate` | סיכון, עלות, זמן |
| `updatedAt` / `decidedAt` | מתי הוקלט לאחרונה |
| `auditTrail` | אירועי decision-update (actor בלתי-הפיך + זמן + סטטוס) |

**שלב (phase)**: `now` (חוסם עכשיו) · `before-anchor` (חוסם עוגן אמיתי) · `before-live` (חוסם מצב חי).

## 2. סגירת החלטה (Task 11 — כלי סגירה, לא רק תצוגה)

`POST /api/saos/decisions {key, status, note?}` — דורש התאמת אדמין, נרשם ב-AuditEvent, לא מכיל סוד, **לא משנה מצב ריצה, לא מבצע עוגן, לא מזיז משאבים**.

- **UI**: כפתורי פעולה מהירים בכל החלטה — "סגור החלטה" (decided-default), "דרוש משאב" (needs-resource), "דחה" (rejected) — פותחים דיאלוג עם סטטוס מוכן-מראש + שדה הערה ציבורית (≤300 תווים, אסור סודות).
- **היסטוריה**: כל החלטה מציגה את ה-auditTrail שלה (מי עדכן, מתי, למה) — בלי פרטים רגישים.
- **הגנה**: החלטה קריטית שנשארת פתוחה חייבת להופיע ב-Command Center כחסימה; החלטה סגורה מציגה מי סגר ומתי (מה-auditTrail), בלי פרטים רגישים.

## 3. החלטות שנוספו ב-Task 11

### SH-7 — `admin-key-location` (security · critical · phase: now)
- **הקשר**: קיים קובץ מפתח-אדמין מקומי `upload/saos-admin-key.txt` בתוך עץ הפרויקט (gitignored, מעולם לא בהיסטוריית הריפו; נבדק קיום-בלבד — התוכן לעולם לא נקרא).
- **אפשרויות**: (א) העברה מחוץ לעץ → `~/.secrets/saos-admin-key` + chmod 600 + עדכון `.env` בלי להדפיס; (ב) רוטציה מלאה אם יש חשש חשיפה; (ג) השארה במקום (לא מומלץ).
- **ברירת-מחדל בטוחה**: העברה מחוץ לעץ עם הרשאות 600, בלי להדפיס/להעתיק את המפתח בשום ערוץ.
- **פעולת בעלים**: ~~להעביר, להגדיר 600, למחוק את העותק המקומי~~ — **בוצע אוטונומית בסבב הסגירה** (ראה §5); רוטציה לפי docs/secret-hygiene.md §7 נותרה פעולת בעלים אופציונלית אם יש חשש חשיפה.
- **ניטור חי**: `/api/saos/repo-status` → `secrets.adminKeyFileInTree` + פריט פתוח אוטומטי ב-knownOpenItems; כרטיס "היגיינת סודות" במסך אבטחה.

## 4. הכללים הקבועים (מעוגנים בקוד/תיעוד)

1. המערכת מאחסנת **רק את ה-hash** של מפתח-האדמין — לעולם לא את המפתח הגלוי.
2. קובץ-סוד בתוך עץ הפרויקט — לא נוהל-קבע; כל קיום כזה הוא פריט SH פתוח עם החלטת בעלים.
3. החלטה קריטית פתוחה = חסימה גלויה ב-Command Center (אסור שתשכח בשקט).
4. רישום-החלטות הוא ספר-עזר: הוא לעולם לא מבצע — לא עוגן, לא שידור, לא מימון, לא מעבר-מצב.

## 5. סטטוס נוכחי (עודכן — סבב הסגירה האוטונומי, 2026-09-07)

בעקבות אישור-דחיפה דחוף והנחיית "טפל בהכל", בוצע סבב סגירה אוטונומי:
כל החלטה עודכנה דרך `POST /api/saos/decisions` (מאומת + audited, הערה ציבורית בלבד) — **רק לפי מצב המערכת בפועל, בלי לסגור שום החלטה שקרית**:

| key | קטגוריה | חומרה | phase | סטטוס מוקלט |
|---|---|---|---|---|
| admin-key-location | security | critical | now | **decided-default** — בוצע אוטונומית: הועבר ל-`~/.secrets/saos-admin-key` (600), `adminKeyFileInTree=false`; רוטציה נותרה פעולת בעלים אופציונלית |
| sh3-historical-file | security | critical | now | **decided-default** — ברירת-המחדל הבטוחה פעילה (אין שכתוב; התוכן מתייחס כסוד; ריפו פרטי); סיווג סופי נותר פעולת בעלים אופציונלית |
| push-approval | governance | medium | now | **decided-default** — הבעלים אישר במפורש ("שידחוף דחוף"); f012014 נדחף לפי הפרוטוקול ואומת מרחוק |
| github-actions-ci | release | medium | now | **decided-default** — workflow נוצר (`.github/workflows/ci.yml`); ריצת ה-CI הראשונה תאומת ב-push הקרוב |
| vault-restore | resources | critical | before-anchor | **needs-resource** — נדרש שחזור כספת מחוץ למערכת; לא ניתן לביצוע אוטונומי |
| hive-rc-floor | resources | critical | before-anchor | **needs-resource** — RC נמוך מהסף; נדרש power-up/delegate או המתנה לרגן |
| tron-stake | resources | critical | before-anchor | **needs-resource** — אנרגיה=0; נדרש מימון TRX או המשך tronbridge |
| build-verification | release | medium | before-live | **deferred** — חסום-סביבה (מדיניות dev-server בלבד); ה-build יאומת בריצות ה-CI |
| live-mode-approval | governance | critical | before-live | **open** — נותרה פתוחה בכוונה: החלטת בעלים אמיתית, לא ניתן לסגור במקומו |

מאזן: 8 מתוך 9 עודכנו (4 סגורות-ברירת-מחדל, 3 needs-resource, 1 deferred); היחידה הפתוחה היא החלטת-הבעלים האמיתית (live). כל העדכונים עם auditTrail ב-API.

> הסטטוס החי הוא תמיד `GET /api/saos/decisions` — הטבלה היא תמונת-מצב לתיעוד בלבד.
