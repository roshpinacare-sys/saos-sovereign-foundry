# החלטות בעלים — Owner Decisions (Task 10, סגירה — Task 11)

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
- **פעולת בעלים**: להעביר, להגדיר 600, למחוק את העותק המקומי; רוטציה לפי docs/secret-hygiene.md §6 אם יש חשש; לתעד כפעולת בעלים.
- **ניטור חי**: `/api/saos/repo-status` → `secrets.adminKeyFileInTree` + פריט פתוח אוטומטי ב-knownOpenItems; כרטיס "היגיינת סודות" במסך אבטחה.

## 4. הכללים הקבועים (מעוגנים בקוד/תיעוד)

1. המערכת מאחסנת **רק את ה-hash** של מפתח-האדמין — לעולם לא את המפתח הגלוי.
2. קובץ-סוד בתוך עץ הפרויקט — לא נוהל-קבע; כל קיום כזה הוא פריט SH פתוח עם החלטת בעלים.
3. החלטה קריטית פתוחה = חסימה גלויה ב-Command Center (אסור שתשכח בשקט).
4. רישום-החלטות הוא ספר-עזר: הוא לעולם לא מבצע — לא עוגן, לא שידור, לא מימון, לא מעבר-מצב.

## 5. סטטוס נוכחי (תמונה בזמן Task 11)

| key | קטגוריה | חומרה | phase | סטטוס |
|---|---|---|---|---|
| admin-key-location | security | critical | now | open — פעולת בעלים נדרשת |
| sh3-historical-file | security | critical | now | open |
| push-approval | governance | medium | now | open (כל סבב) |
| github-actions-ci | release | medium | now | open |
| vault-restore | resources | critical | before-anchor | open |
| hive-rc-floor | resources | critical | before-anchor | open |
| tron-stake | resources | critical | before-anchor | open |
| live-mode-approval | governance | critical | before-live | open |
| build-verification | release | medium | before-live | open |

> הסטטוס החי הוא תמיד `GET /api/saos/decisions` — הטבלה היא תמונת-מצב לתיעוד בלבד.
