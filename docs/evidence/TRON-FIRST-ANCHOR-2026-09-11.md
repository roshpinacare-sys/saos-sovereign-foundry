# TRON-FIRST-ANCHOR — 2026-09-11 — העיגון-הישיר-הראשון של TRON מהמפתחות-הריבוניים

**מעמד:** עיגון-חי מאומת-כפול (מנוע-חוץ + קליטת-שרת עצמאית) · **הרשאה:** הבעלים "אין בעיה אני מאשר להשתמש ולהתייעל ככל הניתן עם מה שיש במלאי תמשיך ודחוף" (trace 1a08ed7bde6e0aed) · **אפס-סודות · אפס-force-push · אפס-מגע-WATTOIN**

## §1 תשובה-קצרה

**TRON נעוגן חי בפעם-הראשונה מהמפתחות-הריבוניים שלנו — ו-h16 הושלם ל-6/6 רשתות** (ETHEREUM + SOLANA + STEEM + BLURT + HIVE + TRON). העיגון בוצע עם המלאי-הקיים בלבד (0.50 TRX), בעלות-אפסית של 0.060138 TRX, בלי שריפת-bandwidth כלל (מיכסת-ה-600 היומית כיסתה את-העסקה).

## §2 מדידת-מלאי-חי (לפני-הפעולה)

12 כתובות-TRON מהרישום-הריבוני (wallets-registry.json, נמדד חי מול trongrid/tronstack/tronstack-ציבורי):

| חשבון | כתובת | יתרה TRX | מופעל |
|---|---|---|---|
| **headcorner** | TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn | **0.500000** | כן |
| cashmachine | TT7whWFon5EdDVFUBUUP9EY6y3VCtL7Bre | 0 | לא |
| haran | TMaxNtRVdBmXyQUdsHFRaAm1jPpFAG9d7K | 0 | לא |
| israelnews | TQErSnQCdTTtL3Tf8KiX2FxFhbhYQCDx3F | 0 | לא |
| lsa | TJ57aAHB44NiwT8up5y7P3Fcfko6vbcbYK | 0 | לא |
| macrame | TJg2YiPuczmz72nJq5tmT2vrod5BDgZDmS | 0 | לא |
| siq | TNgaDWYknRz46deiLkXdUXhn3gjcobnxhE | 0 | לא |
| tov | TL7EvaXWtYQwuQdEDpkgGJCryY8t5PRzwH | 0 | לא |
| wic | TBR2ffp74mp9oUinrA4BbjKKTttFr5Ng2u | 0 | לא |
| wog | TLDEWjWWyTCWrtaEk9CmJG68NgPMjKLuZp | 0 | לא |
| woq | TDCXLokdY1PGjKEMtWG7we9Dt8279hF46m | 0 | לא |
| ynet | TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e | 0 | לא |

**סה"כ: 0.50 TRX** — "ראשי חי עם 0.50 TRX" אומת. (הערכת 27.25 TRX מ-Task 26-c הייתה על-כתובות-חוץ-לכספת, לא-על-הכספת.)

## §3 מפת-הערוצים — ארבעה-שערים נפלו-חי (כל-אחד הוכח בדחיית-שרשרת ממשית)

במקום לנחש, נבחנו כל-הערוצים-הזולים אחד-לאחד — כל-הכישלונות חינם (שום-דבר לא נשמר עד-השידור-המוצלח):

1. **self-transfer — אסור**: `ContractValidateException: Cannot transfer TRX to yourself` — TRON חוסם העברה-לעצמי ברמת-החוזה (בניגוד ל-ETH שם self-tx הוא הערוץ-הקנוני שלנו).
2. **העברה-לכתובת-צי-טרייה — יקרה מדי**: הפעלת-חשבון-חדש = שריפת 1 TRX נוספת → 0.5 אינו מספיק.
3. **FreezeBalanceV2 — מינימום 1 TRX**: `frozenBalance must be greater than or equal to 1 TRX` (+ גילוי-API: השדה נקרא `frozen_balance` — `balance` נקשר-כ-0).
4. **SetAccountId — מלכודת-לגאטים**: נקודת-הקצה `/wallet/setaccountid` בונה עסקה-תקינה (account_id 8–32 תווים עם ה-root!), אבל `SetAccountIdContract` **אינו קיים ב-ContractType של java-tron המודרני** → כל-שידור מת `CONTRACT_VALIDATE_ERROR: No contract!` עם txid-שונה (השרת שומט-את-החוזה בעיגול-ה-JSON↔protobuf). נבדקו 3 וריאנטי-שידור — הכל אותו-דבר.

## §4 הערוץ-המנצח: העברה-ל-blackhole-הקנוני עם קידוד-root בשבר

- **יעד:** `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb` = כתובת-ה-null הקנונית (`41 ‖ 00…00`) — מאומת-חי: קיימת מ-2018, יתרה 773,503.6 TRX (כל-השרופים). **אף-צד-שלישי לא מרוויח** — הרס-פרוטוקולי, אנלוג-TRON ל-self-tx שלנו על-ETH.
- **קידוד קנוני ("6 תווי-hash בשבר-ה-TRX"):** `frac = parseInt(root[0:4],16)` → sun. ל-h16: `root[0:4]="eaea"` → **60138 sun = 0.060138 TRX**.
- **באג-שידור שנתפס ותוקן-חי:** עסקאות נבנו עם `visible:true` (כתובות-base58) אך שודרו בלי `visible:true` → השרת ניתח את-הכתובות כ-hex → החוזה נשר → `No contract!`. הוספת `visible:true` לגוף-השידור = הצלחה מיידית.
- **עלות בפועל:** 0.060138 TRX בלבד — **אפס-שריפת-bandwidth** (198 בייטים כוסו ממיכסת-ה-600 החינמית-היומית). יתרת-headcorner אחרי: 0.439862 TRX (= 0.50 − 0.060138 בדיוק).

## §5 העסקה-על-השרשרת

| שדה | ערך |
|---|---|
| txid | `74e574fcb6c1f99fdaa9fc7da23f8e48ca0b06acc0a4f8f7736a65a1b8002d81` |
| רשת | TRON mainnet |
| משדר | headcorner `TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn` (מפתח-ריבוני, חתימת-secp256k1 גולמית מחוץ-לריפו) |
| אל | `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb` (blackhole קנוני) |
| סכום | 60138 sun = 0.060138 TRX ← root[0:4] של-h16 |
| תוצאה | `ret[0].contractRet = SUCCESS` |
| אימות-עצמאי | gettransactionbyid ישיר (בלתי-תלוי בפלטפורמה) + קליטת-שרת `verifiedBy=trongrid` |

## §6 תיקון-באג-פלטפורמה שנתפס-חי

`verifyTron` (src/lib/saos/signer.ts) בדק `ret[0].result === true` — אבל trongrid מדווח `ret[0].contractRet === "SUCCESS"` (השדה `result` שייך לנקודות-קצה-אחרות). הנתיב-מעולם-לא-נבדק-חי כי-TRON מעולם-לא-נעוגן. תוקן לקבל-שני-הצורות (fail-closed — רק-SUCCESS מאמת). tsc נקי · lint נקי.

## §7 h16 = 6/6 — המטריצה-המלאה

| רשת | txid | חותם |
|---|---|---|
| ETHEREUM | `0x1a7e2d11…` +7 בבלוק 25951350 | הצי (8 כתובות) |
| SOLANA | `5NCzMv7N…` slot 446047519 | cashmachine |
| STEEM | `7438441d…` בלוק 109475336 | headcorner |
| BLURT | `72c094f3…` בלוק 63538064 | headcorner |
| HIVE | `2ee771d6…` בלוק 109811500 | lsa (ממשק-צי) |
| **TRON** | **`74e574fc…2d81`** | **headcorner (מפתח-ריבוני)** |

## §8 יכולת-TRON-עתידית (מתועד-בכנות)

- **מיכסת-bandwidth חינמית יומית (600 נק')** = עסקת-עיגון-אחת/יום בעלות-אפס-עמלה-שידור; עלות-המחויבות-עצמה = הסכום-המקודד (0.06 TRX/עיגון).
- **יתרה 0.439862 TRX** ≈ 7 עיגוני-שבר-נוספים (h17+).
- הפעלת-כתובות-צי-נוספות-על-TRON דורשת 1 TRX/כתובת (החלטת-מימון-בעלים) — כרגע headcorner בלבד משדר.
- המסלול-המלא-ל-USDT-יישוב (25,958 TRX stake או 27.25 TRX שריפה) נשאר-פתוח-לבעלים — לא-הופעל ביום-זה.

## §9 היגיינה

מנוע-החתימה מחוץ-לריפו (`~/task81/tron-anchor.mjs`, ethers SigningKey בלבד, אפס-הדפסת-מפתחות) · אפס-סודות בלוגים/גיט/צ'אט · WATTOIN nonce-ללא-שינוי (אפס-מגע) · דחיפות בפרוטוקול-askpass-זמני-ונמחק · אפס-force-push.
