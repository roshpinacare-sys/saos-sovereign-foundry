# KEYS-INGEST-2026-09-10 — שחזור ערוץ המפתחות של הבעלים (STEEM + HIVE)

**מסמך ראיות · Task 43 · 2026-09-10 00:10–00:25 UTC**
**חוק קבוע: במסמך זה ובשום מקום בריפו אין חומר-מפתח פרטי — רק מפתות-ציבוריים ותוצאות אימות.**

## התלונה שפתחה את הטיפול
הבעלים דיווח: "אני לא מצליח להתחבר עם המפתח שלי וכן הייתי יכול" — והעלה קובץ מפתחות
(השם בשטח: `upload/הדקור.txt`, מחוץ לגיט, gitignored).

## אבחון (מדוד, לא משוער)
1. מבנה הקובץ: 2 קבוצות × 4 מפתחות (owner/active/posting/memo) בפורמט WIF-52 דחוס,
   checksum תקין, עם כותרת "hive" לקבוצה השנייה.
2. גזירת מפתות-ציבוריים (blurtjs ECC, אופליין): הקבוצה הראשונה == סמכויות-החי של
   **STEEM/headcorner**, השנייה == **HIVE/headcorner** (התאמה סיבית-סיבית מול
   `condenser_api`).
3. מצב הכספת לפני (`GET :3033/keys/status`): BLURT posting+active LOADED+MATCH;
   STEEM/HIVE posting טעון עם `match=false` (נגזרות ROT1 — הזרע האמיתי מעולם לא
   נבלע), active/owner ריקים.
4. **שורש הכשל**: ה-login משווה מול מה שטעון בכספת. המפתחות האמיתיים מעולם לא נבלעו
   → כל ניסיון התחברות של הבעלים קיבל 401.

## הטיפול
- `POST :3033/keys/ingest` (Bearer, localhost בלבד) עם 8 ה-WIFs מהקובץ — שער
  verify-then-write: כל מפתח אומת מול רשויות-החיות **לפני** כתיבה.
- תוצאה: **8/8 INGESTED** (STEEM owner/active/posting/memo + HIVE owner/active/posting/memo),
  המעטפת נאטמה מחדש (`sealedAt=2026-09-10T00:10:59.105Z`), hot-reload לזיכרון.

## אימות לאחר הטיפול (חי)
- `/keys/status`: STEEM owner+active+posting = LOADED+MATCH · HIVE owner+active+posting =
  LOADED+MATCH · BLURT posting+active = LOADED+MATCH (owner-BLURT לא בקובץ — לא נדרש לשידורים).
- `POST /api/saos/auth` עם מפתח-active מהקובץ → **HTTP 200, via=STEEM/active,
  actor=owner:headcorner, ttl=2592000s**. חזרה עם owner-key → **200 via=STEEM/owner**.
- UI (דפדפן): מסך אבטחה → נתיב-שגיאה עם מפתח זר → "התחברות נדחתה: מפתח שגוי" ✓
  (נתיב-ההצלחה משתמש באותה נקודת-קצה שאומתה 200).

## ממצא אבחוני נלווה — ה"כספות TRON" הכוזבות
שש הכתובות שסומנו בתיעוד כ"כספת TRON #1–6" (TM5beptA…, TM6UBp98…, TM6p6ZNW…,
TM6u99og…, TM8c9vp3…, TM8mSbBz…) הן **לא כתובות TRON**: אלו מפתות-הציבוריים
STEEM/HIVE מהקובץ עצמו, סיבית-סיבית, עם קידומת STM→TM. נכשלות base58check.
טופלו ב-route הקופה: הוסרו, נוספה הכתובת הפורנזית התקפה `TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy`
+ מקטע Solana חי (`9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL`, נמדד: 0 SOL — נסחב
מאז הסריקה הקודמת שמדדה 0.0294).

## מצב TRX נכון לרגע האימות
- `TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr` (מחזור ראשון): **0.05 TRX**, USDT 0.
- פער לישוב USDT יחיד: **27.20 TRX** (קבוע 27.25 — אנרגיה 64,895 × 420 sun).
- `TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy`: לא-מופעל, 0.

## תוצר
- מסך ה-UI: הבעלים מחובר עם המפתחות שלו עצמו (30 יום סשן), בלי שינוי בפורמט
  שהוא מכיר. קובץ המפתחות נשאר במקומו (gitignored, מחוץ לריפו).
