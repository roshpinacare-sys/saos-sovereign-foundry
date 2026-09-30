# Live Runbook — הפעלה חיה בטוחה (Task 13)

> מטרה: להפעיל את המערכת למצב החי המרבי **שאינו מסוכן**, ולדעת בכל רגע מה מותר, מה נבדק ומה חסום.
> סדר-עדיפויות אם יש סתירה: **בטיחות ← ואז חיים במרבי האפשרי בלי סיכון בלתי-הפיך.**

---

## 1. סולם המצבים (מהיר לאט)

| מצב | דגלים | כתיבה | שידור | מתי משתמשים |
|---|---|---|---|---|
| `dry-run` | ברירת-מחדל | ✅ | ❌ | CI, פיתוח, סביבות בדיקה |
| `safe` | SAOS_MODE=safe | ❌ | ❌ | קריאה/קריאה-בלבד, תחקיר תקלה |
| `maintenance` | SAOS_MODE=maintenance | ❌ | ❌ | גיבוי/שחזור/שדרוג |
| `live` | SAOS_MODE=live **וגם** SAOS_LIVE_CONFIRM=YES | ✅ (seal דורש הפעלה מאומתת) | ✅ **אם** SAOS_BROADCAST_ENABLE=YES והחותם-החיצוני מחובר | **המצב הנוכחי בסנדבוקס** — live עם חותם-חיצוני (:3033) ועגינות-חיות מאומתות (ר' עדכון roast 63) |

הגנת-להבה-כפולה: חסר אחד מהדגלים → המערכת נופלת חזרה ל-dry-run אוטומטית (`modes.ts`).
`broadcastCapable` מחושב רק מ-**בדיקת-חיות טרייה** של החותם החיצוני (`saosModeFresh`, roast 61) — לעולם לא מ-cache. העגינה עצמה: intent-row לפני שידור + requestId דטרמיניסטי לפנ-כפל + cooldown BLURT 30 דק' (roast 56/61).

> **עדכון roast 63:** הסעיפים ההיסטוריים למטה (§2, §4) נכתבו בימי "אין חותם בסנדבוקס". מאז Tasks 26/47/56 החותם-החיצוני מחובר, מעטפת-המפתחות נפתחה ואומתה חי (11 סלוטים), ובוצעו עגינות custom_json חיות מאומתות על STEEM/BLURT/HIVE. הגבול הקבוע: **custom_json בלבד, ללא העברות-נכסים; כל שידור דרך החותם; מפתחות לעולם לא בתוך האפליקציה.**

## 2. הפעלת safe-live (הליך שאושר ובוצע, Task 13)

1. `.env` (מחוץ לגיט, לעולם לא נשלח): `SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES`.
2. אימות שהמשתנים הדרושים קיימים: `DATABASE_URL`, `SAOS_ADMIN_KEY_HASH`, `SAOS_ADMIN_KEY` (מקומי), `SAOS_SESSION_TTL_H`, `HIVE_RC_PCT`, `TRON_ENERGY` · אופציונליים: `ETH_RPC_URL`, `SOL_RPC_URL`, `ETH_CHAIN_ID`, `SOL_CLUSTER`.
3. הרצה-מחדש של השרת (`bun run dev`).
4. בדיקה: `curl -s :3100/api/saos/status | jq '.mode, .broadcastCapable'` → צפי: `live`, `false`.
5. הוכחת חיים: `curl -s :3100/api/saos/live-proof` → `service=ok`, `safeLive=true`.
6. חזרה ל-dry-run: קביעת `SAOS_MODE=dry-run` + הרצה-מחדש (אין צורך לגעת ב-LIVE_CONFIRM).

## 3. אימות-חי שוטף (כל הקריאות קריאה-בלבד)

| בדיקה | פקודה | תוצאה תקינה |
|---|---|---|
| הוכחת חיים מלאה | `GET /api/saos/live-proof` | `service=ok`, `safeLive=true`, `errors=[]` |
| probes ל-6 רשתות | אותו endpoint → `networks[].probe` | 5/6 ok צפוי (BLURT חסומת-רשת בסנדבוקס — מדווח כנה) |
| preflight | `GET /api/saos/anchor-preflight` | `readyForAnchor` כנה + blockers מפורשים |
| UI | סקירה כללית → כרטיס "הוכחת חיים" | 6 תאי רשת + CI + גיבוי + ריפו + החלטות |
| בדיקות מלאות | `bun run check` | 147/147 + 8/8 (ב-live הסוויטה מתחברת כמפעיל מאומת) |

## 4. מה מותר ומה אסור במצב חי (קנון)

**מותר (ואף רצוי):** קריאת-רשת ציבורית keyless · כתיבה מקומית ל-DB (seal/receipts/decisions) · גיבוי ואימותו · הוכחות-חיים · סגירת החלטות בביקורת.

**אסור בלי אישור-בעלים מפורש ומשאב מתאים:** שידור עסקה · חתימה · שימוש בארנק · gas/מימון/הקפאה/האצלה/שכירות · כל פעולה כספית. **המצב מאז Task 47:** שידור custom_json אפשרי מבנית דרך החותם-החיצוני (בהרשאת הדגלים), והוא מוגבל בקוד ל-custom_json בלבד — העברות-נכסים נשארות מחוץ ליכולת המערכת ללא פעולת-בעלים.

## 5. תקלות מוכרות במצב חי

| תופעה | סיבה | פתרון |
|---|---|---|
| `POST /seal` מחזיר 401 | ב-live, seal נחשב broadcast-adjacent → נדרשת הפעלה מאומתת | התחברות (cookie) או Bearer key — הסוויטה עושה זאת אוטומטית (§1b ב-api-check) |
| api-check/concurrency נתקעים ~60s על "auth window" | חלון ה-rate-limit של auth (8/min) מתרוקן ע"י ה-burst בסוף api-check | מתוכנן: Retry-After מכובד + ניסיון חוזה אחד (חכו — זה עצמו-מתרפא) |
| הרצת `verify` עם node לא מוצאת SAOS_ADMIN_KEY | node לא טוען `.env` בניגוד ל-bun | הוחלף ל-`bun scripts/concurrency-check.mjs` (package.json) |
| BLURT probe `ok:false` | ה-endpoints הציבוריים לא נגישים מהסנדבוקס | לא חסימת-מערכת; ה-egress של הסביבה. נבדק שוב בהמשך |

## 6. נקודת-החיבור לעוגן אמיתי (כשיהיה אישור + משאב)

הליך מלא: **docs/first-anchor-runbook.md** · חתימה חיצונית: **docs/external-signer.md** · שערי-מוכנות: **docs/anchor-preflight.md**.
כלל: `live` + preflight ירוק + משאב רשת + חתימה חיצונית ידנית + אישור בעלים מפורש **לכל עוגן ועוגן**. אין מסלול-קיצור.
