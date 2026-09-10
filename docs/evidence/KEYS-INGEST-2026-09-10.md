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

---

## Task 65 — קליטת-ייצוא-הצ'אט 2018 (2026-09-10 20:13–20:19 UTC)

- **קלט**: `upload/הד.txt` (העלאה-שנייה) — ייצוא-צ'אט 2018, 13 סיסמאות-אב P-פורמט עם תוויות-חשבון. **אפס-תוכן-סוד הוצג בשום-פלט** — תוויות-מבנה-בלבד ואחר-כך פסקי-דין.
- **תיקון-חותם v2.4.3**: `ingestCandidates()` — שלושת-מסלולי-הקליטה כוללים-עתה את כל-שמות-הכספת (כולל-שלדים-ריקים); קודם, מפתח-צי נדחה כי שמו-לא-היה מועמד. `/keys/status` משרת `vaultAccountNames` (שמות-ציבוריים) + version 2.4.3.
- **תוצאה**: `ok:true` — **84 התאמות-חי על 12 חשבונות** (headcorner-BLURT 4 ריענון · tov-BLURT 4 · ynet-BLURT 4 · 9 חשבונות-צי HIVE+BLURT × 4 = 72); 1 סירוב-כן (סיסמת-עבר-שסובבה); STEEM-צי 0-התאמות (אמת-שרשרת). נאטם 20:14:15.
- **אימות-כספת**: `/keys/verify-live` = **92 סלוטים · 0 drift · 0 unmatched · 0 errors** (20:15).
- **גיבוי-קנוני**: `backups/key-backup-headcorner-20260910-b.enc` (0600, 11,330 בייטים) — round-trip פענוח-אומת; 93 ערכי-חומר (ראשי 13 · צי-HIVE 36 · צי-BLURT 44). סיסמה — לצ'אט-בלבד.
- **השמדה**: `upload/הד.txt` shred ×3 + unlink (20:17) — לפי-הנחיית-הבעלים "תאטום מה שצריך".
- **המסך**: `/keys-map` v5 — openGaps נגזרים-חי (fleetAllConnected/vaultAccountCount/vaultAccountNames); הפער-צי נעלם-מעצמו; overview-tab מציג "כל 12 חשבונות-הכספת חיים (92 סלוטים)" נגזר-ולא-קפוא (הסרת-ה-check `===16`).
