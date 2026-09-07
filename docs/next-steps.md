# צעדים הבאים — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 4) · סטטוסים: ⬜ פתוח · 🔶 חלקי · ✅ סגור · 🚫 חסום

## מסלול מסונתז (מתוך `SYNTHESIS.roadmap` — נשמר כמסמך-אם)

| שלב | מה | סטטוס | תלות |
|---|---|---|---|
| 1 | מגדל-פיקוח חי: selftest, verify-pack, מטריצת עגינה, מחשבוני אנרגיה | ✅ סגור (נבדק דפדפן+API) | — |
| 2 | כספת חוזרת → פעימת עגינה אמיתית → HIVE נוחת | ⬜ פתוח | מפתחות חתימה מחוץ לסנדבוקס |
| 3 | TRON ישיר: הימור TRX ממומן → יישובי USDT נושאי-stateRoot | ⬜ פתוח | מימון TRX (המשתמש בירך) |
| 4 | גלגל-החור: grid pools + inbound rail מממנים את האנרגיה עצמם | ⬜ פתוח | 2–3 |
| 5 | רשתות נוספות (משפחת Graphene; TRC10; מסמך-עדות polyglot) | ⬜ פתוח | 2–4 |

## עדיפויות מיידיות (סבב הבא)

1. ✅ **תיקון מירוץ height (F1)** — סגור Task 4: טרנזקציה+mutex+retry+idempotency; הוכח 8/8 מקבילות.
2. ✅ **כותבים ל-EnergyPlan/EconomySnapshot** — סגור Task 4 (planId/snapshotId + `/plans` לקריאה).
3. ✅ **חשיפת אימות שרשרת** — סגור Task 4: `/api/saos/verify-chain` (chain/seal/leaf).
4. ✅ **CI מינימלי** — סגור Task 4: `bun run check` (26 בדיקות + 8 מקבילות); build מוגדר-וחסום-סביבה.
5. ✅ **הפרדת מצבים** — סגור Task 4: modes.ts + אישור-כפול ל-live; נבדק אנד-טו-אנד.
6. ✅ **תצוגת רשתות חוץ** — סגור Task 4: network-status.ts + שדה networks ב-/status.
7. 🔶 **וולידציית קלט מפורשת** — הודעות קנוניה טכניות עדיין על חלק מהקלטים (`float/inf rejected`).
8. ⬜ **auth + rate-limit** — חובה לפני live; לא התחיל.
9. ⬜ **GitHub Actions** — ריצת `check` על push; לא קיים בסנדבוקס.
10. ⬜ **audit תלויות** — `npm audit`; לא רץ מעולם.
11. ⬜ **retention לקבלות/תוכניות GET** — ניקוי/ארכוב לטבלאות הצומחות.
12. ⬜ **`bun run build` מחוץ לסנדבוקס** — לאמת build פרודקשן (חסום-סביבה).

## עוגן ציבורי — הסטטוס המדויק

| רשת | סטטוס | מה דרוש לנחיתה |
|---|---|---|
| STEEM | ✅ עוגן (היסטוריה, רפרנס חלקי) | המשך פעימות בכל סבב live; רפרנס מלא יישמר ב-AnchorTx |
| BLURT | ✅ עוגן (היסטוריה, רפרנס חלקי) | כנ"ל; שמירת cooldown 30 דק' |
| HIVE | ⏳ gated rc-floor(0.6%<8%) | שחזור RC (8.9 שעות לסף-קל) או power-up/delegate; אחרת — הפעימה הבאה ב-live |
| TRON | 🚧 transit (tronbridge יומית) | מימון הימור TRX (מינימום מחושב: 25,958 TRX ל-4 יישובים/יום) → energize → עגינה ישירה |

## מה מוכן ומה חסר ל-live

**מוכן**: קרנל דטרמיניסטי מאומת; שורשים ומרקל; קבלות משורשרות; מטריצה כנה; מתמטיקת TRON/HIVE מלאה; UI מבוקר.

**חסר (בסדר גודל)**:
- כספת חתימה (מפתחות STEEM/BLURT/HIVE) — קיימת בארכיון ההיסטורי, לא בסביבה זו (🚫 חסום סביבה).
- TRX מוהמר (🚫 חסום מימון — בהמתנה להנחיית משתמש).
- auth+rate-limit (⬜ באחריותנו — סעיף 6 לעיל).
- קריאות RC/אנרגיה חיות מהרשתות במקום env (⬜ — סביבת live).

## סיכונים פתוחים לזכור

- F1 מירוץ height · F2 פיצול hash-chain · W1 SQLite יחיד · רפרנסים היסטוריים חלקיים (ממוסכים) — פירוט ב-architecture.md §5 ו-database.md §7.

## סדר-הסיום הקבוע של כל סבב (חוזר לזכרון)

1. `bun run lint` + `bunx tsc --noEmit`
2. commit עם הודעה ברורה
3. `git push origin main`
4. עדכון `worklog.md` (append)
5. סיכום למשתמש — מה בוצע/נבדק/נשאר/נדחף

---

## טבלת סטטוס רכיבים (סוף Task 4)

| רכיב | סטטוס | הערה |
|---|---|---|
| kernel.ts (מכונת מדינה + selftest 7) | ✅ עובד | נבדק חי כל סבב |
| canonical-json / merkle / evidence | ✅ עובד | כולל verifyChainDag |
| receipt-store (אטומיות) | ✅ עובד | mutex+retry+idempotency; הוכח 8/8 |
| modes.ts (dry-run/safe/live/maintenance) | ✅ עובד | נבדק אנד-טו-אנד; live דורש אישור-כפול |
| network-status.ts (תצוגת רשתות חוץ) | ✅ עובד | חישוב בלבד — לא קורא לרשתות |
| POST /seal | ✅ עובד | אטומי + idempotent |
| GET /status /kernel /verify-pack /research | ✅ עובד | |
| GET /verify-chain (chain/seal/leaf) | ✅ עובד | 41 קבלות + כל העלים מאומתים; fork[17] מדווח |
| GET /energy /economy + כותבי יישויות | ✅ עובד | planId/snapshotId |
| GET /plans | ✅ עובד | קריאה-בלבד |
| UI (5 לשוניות + תג מצב) | ✅ עובד | נבדק דפדפן desktop+mobile, אפס שגיאות |
| scripts: api-check / concurrency-check / backfill | ✅ עובד | חלק מ-check |
| `bun run check` (פקודה אחת) | ✅ עובד | יציאה 0 |
| `bun run build` | 🚫 חסום-סביבה | מוגדר; ריצה אסורה בסנדבוקס — דורש אישור/סביבה חוץ |
| auth / rate-limit | ⬜ לא התחיל | חוסם לפני live |
| GitHub Actions CI | ⬜ לא התחיל | אין runner בסנדבוקס |
| חיבור רשתות אמיתי (STEEM/BLURT/HIVE/TRON) | 🚫 חסום | דורש כספת (שלב 2) + מימון TRX (שלב 3) — אישור משתמש |
| retention לטבלאות GET | ⬜ לא התחיל | צמיחה איטית, לא דחוף |
