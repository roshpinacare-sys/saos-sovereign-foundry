# בדיקות — SAOS Sovereign Foundry v2

עודכן: 2026-09-07

## 1. איך מריצים

```bash
# איכות קוד (eslint flat config, Next 16):
bun run lint                # = eslint . — נקי = יציאה 0

# בדיקת טיפוסים:
bunx tsc --noEmit           # נקי = יציאה 0

# selftest הקרנל (7 בדיקות תכונה) דרך ה-API החי:
curl -s http://localhost:3000/api/saos/kernel | jq '.result.ok, .result.checks'

# אימות כלול-מלא של החותם האחרון:
curl -s http://localhost:3000/api/saos/verify-pack | jq '.rootMatches, .allVerified'

# פעימה + תשובה:
curl -s -X POST http://localhost:3000/api/saos/seal \
  -H "Content-Type: application/json" -d '{"stamps":5,"memo":"test pulse"}' | jq .ok,.seal.height
```

## 2. מה קיים

| סוג | כלי | מיקום | מה בודק |
|---|---|---|---|
| selftest תכונה | קרנל פנימי | `kernel.ts → kernelSelftest()` | 7 בדיקות: דטרמיניזם, טבלת-GAS, dedupe קשיח, שמירת-ערך, fail-closed, רגישות-סדר, שער אפס-גז |
| אימות מרקל | verify-pack | `api/saos/verify-pack` | בניית עץ מחדש + הוכחה/אימות לכל עלה + rootMatches |
| fail-closed של API | ידני/curl | כל הנתיבים | קלט שגוי → `ok:false` ב-HTTP 200 (לעולם לא 500) |
| lint | eslint 9 flat | `eslint.config.mjs` | core-web-vitals + typescript + no-unused-vars(warn) |
| types | tsc | — | strict |
| E2E דפדפן | agent-browser | ידני | 5 לשוניות, desktop+mobile, פעימה, אפס שגיאות קונסולה |

**אין** פריימוורק בדיקות יחידה (ויטסט/Jest לא מותקנים) — ה-selftest-כ-API הוא פרימיטיב הבדיקה הנוכחי. זו פער מוכר ומוחלט ב-next-steps.

## 3. תוצאות אחרונות (הרצה חיה 2026-09-07, 12:19–12:21 UTC)

| בדיקה | תוצאה | ראיה |
|---|---|---|
| `GET /api/saos/status` | ✅ HTTP 200, מטריצה STEEM anchored / BLURT anchored / HIVE gated(0.6%<8%) / TRON transit | curl |
| `GET /api/saos/kernel` | ✅ 7/7 checks pass; gasUsed 160==160; root `4d714729…` יציב | curl |
| `POST /api/saos/seal {stamps:5}` | ✅ height 3, root `7e3b3fc8…`, 8 עלים, גז 180, 4 עוגנים כנים | curl |
| `POST /api/saos/seal {"stamps":"abc"}` | ✅ `{ok:false,"error":"seal requires stamps in batch"}` HTTP 200 | curl |
| `GET /api/saos/verify-pack` | ✅ rootMatches:true, allVerified:true (8 עלים) | curl |
| `GET /api/saos/energy?net=tron&trx=6500&txs=4` | ✅ 65,000 אנרגיה/יום, 1/4 יישובים מכוסים, שריפה 27.26 TRX/tx, break-even 239, minStake 25,958 | curl |
| `GET /api/saos/energy?net=hive&rc=0.6` | ✅ gated, 8.9 שעות לסף-קל, 13.7 לכבד | curl |
| `GET /api/saos/energy?net=hive&rc=abc` | ✅ `{ok:false,"error":"float/inf rejected — integers only"}` HTTP 200 | curl |
| `GET /api/saos/economy?fly=40` | ✅ 4 זרמים, totalPerDay 152.5, מיחזור 61 | curl |
| `GET /api/saos/research` | ✅ 10 findings + synthesis; ResearchFinding=10 ב-DB | curl |
| `bunx tsc --noEmit` | ✅ נקי (יציאה 0) | הרצה מקומית |
| `bun run lint` | ✅ נקי (יציאה 0) — לאחר BUG-002 | הרצה מקומית |
| E2E דפדפן (agent-browser) | ✅ בוצע בסבב הקודם (worklog Task 2): desktop+390×844, 5 לשוניות, פעימה height 1→2, אפס שגיאות קונסולה/דף; וגם render של `/` נבדק חי הסבב הזה (HTML RTL תקין) | worklog + dev.log |

## 4. באגים שנמצאו ותוקנו (רשומות כנדרש)

### BUG-001 — התנגשות unique על height ב-seal
- **תיאור**: פעימה שנייה נכשלה ב-`Unique constraint failed on the fields: (height)` (נראה ב-dev.log).
- **סיבה**: הקרנל ההיסטורי לא קידם height לפי פעולה, והנתיב גזר את ה-height מה-replay — תמיד אותו ערך.
- **קבצים מושפעים**: `src/app/api/saos/seal/route.ts`, `src/lib/saos/kernel.ts`.
- **פתרון**: `applyTx` מקדם height לכל פעולה; הנתיב גוזר height מונוטוני מ-max(DB).
- **ראיה לתיקון**: פעימה חיה 2026-09-07 יצרה height 3 אחרי שניים קודמים — ללא התנגשות.
- **סיכון נותר**: מירוץ בין שתי פעימות מקבילות עדיין יכול להתנגש (F1) — מוחזר כ-ok:false, דורש retry; תיקון אטומי בתוכנית.

### BUG-002 — סקריפט lint שבור (נמצא בסבב זה)
- **תיאור**: `bun run lint` → `Invalid project directory provided, no such directory: .../lint` וכישלון.
- **סיבה**: `"lint": "next lint"` ב-package.json — Next 16 הסיר את `next lint` ופירש "lint" כתיקיית-יעד. ה-worklog של הסבב הקודם דיווח "fixed" — לא היה נכון (תוקן רק eslint.config.mjs, לא הסקריפט).
- **קבצים מושפעים**: `package.json`.
- **פתרון**: `"lint": "eslint ."`.
- **ראיה לתיקון**: `bun run lint` → יציאה 0, אפס אזהרות.
- **סיכון נותר**: אין.

### באגים היסטוריים מסבב הבנייה (מתועדים ב-worklog Task 2)
1. canonical JSON דחה float → קידוד integer-safe (per-mille/micro-units) ב-payloads של Hive/economy.
2. Next 16 הסיר `next lint` → eslint flat config (השלמת BUG-002 הסבב זה).
3. react-hooks `set-state-in-effect` → טעינה נדחית דרך setTimeout(0).
4. NextConfig לא מקבל מפתח `eslint` → הוסר.

## 5. מה לא מכוסה / דורש בדיקה ידנית

| נושא | מצב |
|---|---|
| בדיקות יחידה ממוסדות (vitest) | לא קיימות — selftest-כ-API במקום; מומלץ להוסיף ולקשור ל-CI |
| מירוץ seal מקביל (F1) | לא נבדק אוטומטית; סימולציה ידנית בלבד |
| hash-chain על ריצות ארוכות (`verifyChain`) | פונקציה קיימת ולא נקראת באף נתיב API — לא נבדקה חיה |
| רינדור מובייל אמיתי | נבדק פעם אחת ב-agent-browser (390×844); אין רגרסיה אוטומטית |
| קישוריות לרשתות אמיתיות (STEEM/BLURT/HIVE/TRON nodes) | **לא קיימת ב-v2** — כל המתמטיקה מקומית; דורש כספת + קריאות חיות |
| עומסים/זמן ארוך | לא נבדק |
| Lighthouse/a11y | לא נבדק (RTL מלא, תמיכת מקלדת בסיסית בכפתורים) |

## 6. מה עבר אוטומציה

- selftest קרנל — כל קריאת `/api/saos/kernel` (כולל כניסה למגדל-פיקוח ב-UI).
- verify-pack — כל כניסה ללשונית הוכחות.
- lint + tsc — ידני לפני commit (חסר CI).

## 7. מה נכשל וטופל (היסטוריה מרוכזת)

- height unique (BUG-001) → תוקן ונבדק.
- `next lint` (BUG-002) → תוקן ונבדק הסבב הזה.
- דחיית float בקנוניה → הופכת באג לתכונה: קלט רע נדחה fail-closed; הנתיבים מקודדים integer-safe.
- התנגשות digest בקבלות בריצה חוזרת → מטופל בכוונה (try/catch נסבל).
