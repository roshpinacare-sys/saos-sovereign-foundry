# Live Proof — הוכחת חיים (Task 13)

> מסמך-ראייה: מה נבדק חי, מתי, מה התגלה, ומה נשאר בלי-אימות.
> המקור החי: `GET /api/saos/live-proof` · הכרטיס ב-UI: "הוכחת חיים — Live Proof" (סקירה כללית).
> כלל-על: ההוכחה כולה **קריאה-בלבד** — אפס עסקאות, אפס שידור, אפס חתימה, אפס שימוש בארנק.

---

## 1. מה זה "חי" — שלוש רמות (הגדרת Task 13)

| רמה | הגדרה | הוכחה |
|---|---|---|
| 1 — מערכת חיה | שרת, DB, auth, rate-limit, ביקורת, גיבוי, סשנים, UI, בדיקות | `service` + מדדי-מערכת ב-live-proof |
| 2 — רשתות חיות לקריאה | probe קריאה-בלבד מול endpoint ציבורי לכל אחת מ-6 הרשתות | `networks[].probe` |
| 3 — מוכנות עוגן | preflight, בקשת-חתימה (dry), תור חתימות, חסימות | `preflight` + `signatureQueue` |

---

## 2. ריצת-הוכחה מתועדת (2026-09-08, 00:54–00:57 UTC+3, מצב live)

### רמה 1 — המערכת חיה (evidence)

| מדד | ערך בריצה |
|---|---|
| service | `ok` |
| liveMode | `live` (SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES) · writesEnabled=true |
| safeLive | `true` — broadcastCapable=false (אין חותם חיצוני; השידור בלתי-אפשרי מבנית) |
| database | ok · seals=104→107, leaves=~560, anchors=~370, receipts=170+, auditEvents=479→513 |
| auth | configured (hash בלבד) · sessionEpoch=rotated (revoke-all פעיל) · revocationReady=true |
| rateLimit | active · live-proof 6/min · status 120/min · seal 30/min · auth 8/min |
| audit | 479 אירועים (כולם ב-24h האחרונות בסביבה זו); אירועים נרשמים בכל פעולה רגישה |
| backups | טרי ומאומת — `bun run backup` הורץ במסגרת המשימה (integrity ok, counts-match) |
| repo | main · מסונכרן עם origin/main לפני ה-push · 0 unpushed בזמן הבדיקה |
| CI | available · **conclusion=success** @ 382d30ec549c (נשלף חי מ-GitHub API; הטוקן נקרא מ-`~/.secrets/github-token` לזיכרון-בלבד) |
| UI | נטען ללא שגיאות קונסול (desktop 1280 + mobile 390/360, אפס overflow) |
| tests | lint ✅ · typecheck ✅ · api-check **147/147** ✅ · concurrency **8/8** ✅ (כולם ירוקים במצב live) |

### רמה 2 — רשתות חיות לקריאה (evidence, probe קריאה-בלבד)

| רשת | probe | מקור | ראש/זיהוי ציבורי | הערה כנה |
|---|---|---|---|---|
| STEEM | ✅ ok | api.steemit.com (ציבורי keyless) | head block **109,386,006→109,386,338** | condenser_api.get_dynamic_global_properties |
| HIVE | ✅ ok | api.hive.blog (ציבורי keyless) | head block **109,720,481→109,720,811** | כ"ז |
| TRON | ✅ ok | api.trongrid.io (ציבורי keyless) | solidity head **86,052,057→86,052,390** | walletsolidity/getnowblock |
| ETHEREUM | ✅ ok | ethereum-rpc.publicnode.com (ציבורי keyless) | chainId **0x1** (mainnet), block **25,929,119→25,929,203** | eth_chainId + eth_blockNumber |
| SOLANA | ✅ ok | api.mainnet-beta.solana.com (ציבורי keyless) | slot **445,204,012→445,207,162** | getSlot |
| BLURT | ❌ לא מאומתת | 3 endpoints ציבוריים נוסו בתורם | — | כולם בלתי-נגישים מהסנדבוקס כרגע; **המצב מדווח כנה — לא הומצאו נתונים**; העוגן ההיסטורי המאומת נותר הראייה |

כללי-probe: timeout 2.5s · ללא מפתחות · ללא credentials (URL עם מפתח מסורב בקוד) · חשיפת hostname בלבד · מטמון 60s · כישלון = `ok:false` עם סיבה, לעולם לא throw ולא המצאה.

### רמה 3 — מוכנות עוגן (evidence)

- preflight: `readyForAnchor=false` — **כנה**: 1 חוסם-קשה (משאבי רשת: HIVE RC 0.6%<8% · TRON energy=0) + אזהרות (חתימה חיצונית לא מחוברת, אין בקשת-חתימה פתוחה, פריטי אבטחה ידועים, מצב live בלי יכולת שידור).
- תרגול-יבש של מסלול החתימה אומת ב-api-check §15/§27: יצירת SignRequest → payload/digest → רישום תוצאה ציבורית → fake-txid נשאר `unverified` → ביטול/פקיעה — **ללא שידור**.
- proofRoot/proofHeight: החותמה האחרונה בריצה — height **107**, root `ffe85ba860e5af…`.
- תור חתימות: פתוחות 0 · נרשמו 30 · נדחו 30 (ניקוי-דרילים).

---

## 3. עמדת הבטיחות בזמן "חי" (safe-live)

| פעולה | אפשרית במצב הנוכחי? | הגנה |
|---|---|---|
| קריאת רשתות (read-only probe) | ✅ — זו בדיוק ההוכחה | keyless, timeout, hostname-only |
| כתיבה ל-DB מקומי (seal/receipts) | ✅ | מוגן-auth ב-live (seal דורש הפעלה מאומתת) |
| שידור עסקה לרשת | ❌ **בלתי-אפשרי מבנית** | broadcastCapable=false (אין כספת חתימה) |
| חתימה בשם הבעלים | ❌ אסור + בלתי-אפשר | אין מפתחות במערכת; SignRequest keyless בלבד |
| שימוש בארנק מחובר | ❌ לא קיים חיבור | אין אינטגרציית ארנק בקוד |

`safety` בפלט ה-API מחזיק את זה בצורה בדיקה-מכונה: `broadcastCapable=false, transactionAttempted=false, signingAttempted=false, walletUsed=false` — ויש עליו assertion קבוע ב-api-check §28.

---

## 4. מה לא נעשה (גבול הכנות)

- **לא בוצע** עוגן אמיתי, שידור, חתימה, עסקה, gas, מימון, delegation או rent — באף רשת.
- **לא נקראו** תכני סודות להצגה/הדפסה: מפתח-האדמין והטוקן טופלו בזיכרון-בלבד (hash-compare + Authorization header).
- BLURT לא אומתה חי (network egress חסום מהסנדבוקס) — מדווח כך בכנות.
- CI נשלף חי מה-API — אבל "build חי מחוץ ל-CI" נשאר באחריות הריצה המרוחקת (CI עצמו ירוק).

## 5. איך מאמתים שוב (נוהל 60 שניות)

```bash
curl -s http://localhost:3100/api/saos/live-proof | python3 -m json.tool | head -60
# או ב-UI: סקירה כללית → הכרטיס "הוכחת חיים — Live Proof" → בדיקה מחדש
# אימות מלא:
bun run check   # lint + typecheck + api-check + concurrency
```

המסמך הזה הוא תיעוד של ריצה אמתית. הריצה החיה הבאה מתועדת ב-`worklog.md` ובהיסטוריית ה-commit-ים — לא בזיכרון.
