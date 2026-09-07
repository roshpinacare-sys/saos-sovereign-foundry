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

---

## עדכון Task 5 (2026-09-07) — Live Gate & Production Hardening

### טבלת סטטוס רכיבים (סוף Task 5)

| רכיב | סטטוס | הערה |
|---|---|---|
| גרעין דטרמיניסטי + selftest 7/7 | עובד | — |
| איטום אטומי (8 מקבילות) | עובד | heights רציפים 1..55 |
| verify-chain / verify-pack | עובד | fork[17] מדווח-לנצח, לא מוסתר |
| מצבי פעולה + דגל-כפול | עובד | — |
| **auth (hash+cookie+audit)** | **עובד** | חדש Task 5; fail-closed |
| **rate-limit** | **עובד** | חדש; in-memory תהליך-יחיד |
| **live-gate (10 בדיקות)** | **עובד** | חדש; מדווח חסימות אמיתיות |
| **signer keyless (manual ready)** | **עובד** | חדש; external/hardware מוגדרים-מנותקים |
| **backup/restore/cleanup** | **עובד** | חדש; restore מאומת (תיחום הוכח) |
| תלויות | עובד | bun audit = 0 (next 16.3.4) |
| GitHub Actions CI | **לא נבדק/לא קיים** | כל הבדיקות ידניות |
| build מחוץ לסנדבוקס | **חסום (סביבה)** | מתועד ב-deployment.md |
| עגינה אמיתית (STEEM/BLURT/HIVE/TRON) | **דורש אישור+משאב** | כספת/טראקס — ר' מטריצה ב-status |

### חסימות לפני מצב-חי (הטבלה הרשמית — עודכן)

| חסימה | מה נדרש לשחרור | בעל-התפקיד |
|---|---|---|
| אין כספת חתימה מחוברת | שחזור מפתחות **מחוץ למערכת** (מדריך: security.md §5) | הבעלים |
| HIVE rc-floor | regen (~שעות) או power-up/delegate | הבעלים/משאבים |
| TRON energy-0 | stake ≥25,958 TRX (4 יישובים/יום) או שריפה | הבעלים/משאבים |
| GitHub Actions | יצירת workflow שמריץ `bun run check` | סבב הבא |
| build-verification | הרצת `bun run build` מחוץ לסנדבוקס | הבעלים |

### הסדר הנכון להמשך (כפי שהוחלט עם המשתמש)

1. ~~אימות גישה + הגבלת קצב~~ ✅ Task 5
2. ~~ממשק חתימה חיצוני~~ ✅ Task 5
3. ~~גיבוי ושחזור~~ ✅ Task 5
4. ~~live gate checklist~~ ✅ Task 5
5. ~~אבטחת תלויות~~ ✅ Task 5 (audit=0)
6. רק אז — חיבור אמיתי ל-HIVE/TRON (דורש כספת מחוץ למערכת + משאבים + אישור בעלים)

### מועמד לסבב 6 (הצעת המשתמש)

"כספת חיצונית ועוגן אמיתי ראשון — בלי שהמפתח ייגע בסוכן או בריפו": הפעלת ה-SignRequest הראשון מקצה-לקצה — המערכת מכינה, הבעלים חותם בכלי חיצוני, המערכת רושמת txid ומעדכנת AnchorTx ל-anchored.

---

## עדכון Task 6 — מה נסגר, מה הלאה

### טבלת סטטוס רכיבים (לאחר Task 6)

| רכיב | סטטוס | הערה |
|---|---|---|
| שרשרת + חותמות + קבלות | עובד | 57 seals, 211 receipts, פיצול היסטורי [17] מדווח |
| הרשאות + rate-limit + audit | עובד | 65/65 api-check |
| live-gate | עובד | 10 בדיקות |
| **anchor-preflight** | **עובד (חדש Task 6)** | 10 בדיקות, קריאה-בלבד, כנה: 2 חוסמים |
| **מסלול חתימה חיצוני (מחזור-חיים)** | **עובד (חדש Task 6)** | 7 מצבים, אל-הפיך, audit מלא |
| **רישום תוצאת עוגן + אימות ציבורי** | **עובד (חדש Task 6)** | verified/unverified כנה; unverified לעולם לא סופי |
| סטטוס רשתות מורחב | עובד | isReadyForAnchor=false · isDryRunOnly=true לכולן (כנה) |
| גיבוי/שחזור/ניקוי | עובד | גיבוי מאומת לפני כל שלב קריטי |
| UI — שער-חיים | עובד | כרטיס preflight + status badges + cancel + verify-checkbox |
| GitHub Actions CI | לא נבדק | עדיין פתוח |

### טבלת חסימות (עוגן אמיתי ראשון)

| חסימה | מי פותר | איך |
|---|---|---|
| HIVE RC 0.6% < 8% | בעלים | power-up/delegate או המתנה לרגן (~8.9h) |
| TRON energy = 0 | בעלים | stake ≥ 25,958 TRX או שריפה ~27.26 TRX/tx |
| mode dry-run (אין שידור) | בעלים | אישור מפורש + SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES + הפעלה-מחדש |
| אין egress לאימות-txid בסנדבוקס | פריסה | סביבה עם רשת פתוחה ⇒ אותו קוד יאמת אמיתי |
| SH-3 (קובץ היסטורי חסר-אישור) | בעלים | אישור סיווג תוכן; סיבוב-סוד אם רלוונטי |

### מועמד לסבב 7

1. **העוגן הראשון בפועל** (בעלים): preflight → SignRequest → חתימה מחוץ למערכת → רישום txid + verify → `recorded` → עדכון AnchorTx ל-anchored מאומת.
2. GitHub Actions CI (bun run check ב-push).
3. חיבור חותם חיצוני אוטומטי (external/hardware) — עדיין ללא מפתח במערכת.

---

## עדכון Task 10 — Product-Grade UI Rebuild

### טבלת סטטוס רכיבים (סוף Task 10)

| רכיב | סטטוס | הערה |
|---|---|---|
| UI — 7 מסכים (RTL, mobile-first) | עובד | docs/ui.md; נבדק דפדפן desktop+mobile, אפס שגיאות קונסולה |
| `GET /repo-status` | עובד (חדש) | git+גיבויים+סודות — קריאה-בלבד, אפס ערכי סוד |
| `/decisions` GET/POST + DecisionRecord | עובד (חדש) | registry מה-docs; רישום סטטוס בעלים (auth+audit) |
| `GET /research` | שוחזר | היה מתועד ולא-נכלל ב-git — api-check נכשל על שיבוט טרי; תוקן |
| api-check | 80/80 | היה 65 |
| מקור-אמת להחלטות | 🔶 חלקי | registry סטטי מה-docs; עדכון תוכן דורש commit (מכוון — תיעוד הוא המקור) |

### מועמד לסבב 8

1. **העוגן הראשון בפועל** (בעלים) — ללא שינוי: preflight → SignRequest → חתימה חוץ-מערכתית → רישום+verify → recorded.
2. GitHub Actions CI (עדיין פתוח; ההחלטה מוקלטת ב-/decisions).
3. אוטומציית refresh עדינה ב-UI (אופציונלי; כרגע רענון ידני מכוון).
4. קישורי docs נלחצים (route להצגת markdown) — כרגע רק רשימת נתיבים.
