# אבטחה — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 11 — Key Hygiene, Session Revocation & Decision Closure)

## 1. מודל איומים בתמצית

| נכס | איום | מצב הגנה | פער |
|---|---|---|---|
| שלמות השרשרת (seals/leaves/roots) | שינוי שקט של עלה/שורש ב-DB | עץ מרקל נבנה מחדש ומאומת כולו (`rootMatches`, `allVerified`); שינוי כלשהו יחשוף | תיקון DB ידני יכול לשכתב גם את השורש — האמת הסופית רק בעגינה ציבורית |
| שרשרת קבלות | פגיעה/הסרת קבלה | hash chain (prevDigest) + `verifyChainDag` כ-API + בדיקת `chain-integrity` ב-live-gate | — |
| פעולות רגישות | משתמש אנונימי מפעיל יצירת בקשת-חתימה / רישום תוצאה / ניסיון go-live | **שכבת הרשאות (Task 5)**: session cookie חתום או Bearer key עם השוואת-hash בזמן-קבוע; 401/403; כל ניסיון נרשם ב-AuditEvent | — (ביטול-סשנים גלובלי נוסף ב-Task 11 — ר' §4.1) |
| מפתח מנהל | ניחוש/brute-force | בשרת יש **רק sha256** של המפתח; התחברות מוגבלת 8/דקה (429) | מפתח חלש ניתן לניחוש — חובה מפתח ארוך (ר' §3) |
| API זמינות | הצפת בקשות (DoS זול) | **rate-limit (Task 5)**: חלון דקה per-IP per-route, 429 + Retry-After; ברירות-מחדל בקוד, אחלפי `SAOS_RL_*` | in-memory — איפוס בהפעלה-מחדש; single-process בלבד |
| מעבר ל-live בטעות | הפעלת live/שידור במקרה | **אישור-כפול**: `SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES`; וכעת גם **live-gate**: רשימת חסימות אוטומטית לפני כל מעבר | — |
| מפתחות חתימה | דליפה דרך המערכת | **בלתי-אפשרי מבנית (Task 5)**: אין שדה/פרמטר/עמודה שבהם מפתח פרטי יכול להיכנס; המערכת מייצרת payload+digestToSign בלבד ומקבלת חזרה רק txid ציבורי | — |
| תלויות | חולשות ידועות ב-supply-chain | **audit (Task 5)**: bun audit — 0 פגיעויות לאחר תיקונים (ר' §6) | נדרש audit תקופתי (אין CI אוטומטי) |
| כסף/ערך | אובדן ערך ב-wallet | בדיקת יתרה fail-closed; שמירת-ערך נבדקת ב-selftest; **אין פעולה כספית בקוד בכלל** | — |
| סודות | דליפת טוקנים/מפתחות לריפו | .gitignore על `.env*`, `upload/`, `research/`, `backups/`; remotes מטוקנים; אין מפתחות חתימה בסביבה | ר' §3 |
| זמינות (500) | 500-ים עוצרים צרכן | כלל ברזל: שגיאה כנתון; **תיקון Task 5**: 401/403/429 מותרים אך ורק לשכבת האבטחה — body תמיד JSON | — |

## 2. עקרונות אבטחה שנאכפים בקוד

1. **Fail-closed**: `canonicalize` זורק על float/NaN/מחזור/symbol/function; `applyTx` זורק על replay, יתרה חסרה, op לא מוכר.
2. **Fail-closed בהרשאות**: אם `SAOS_ADMIN_KEY_HASH` לא מוגדר — **כל** פעולה רגישה נדחית (403 auth-unconfigured). מערכת לא-מוגדרת לעולם לא מתנהגת כפתוחה.
3. **גבול אמת מוצהר**: כל קבלה נושאת `truth: {externalEffectsExecuted: 0, productionAuthority: "NONE"}` עד עגינה ציבורית אמיתית.
4. **אין txid מבוים**: `AnchorTx.txid=null` עד חתימה אמיתית; בתור החתימה — `txid` נכנס רק מחוץ-למערכת והוא **בלתי-הפיך** (רישום כפול נדחה).
5. **קנוניה**: מיון מפתחות + שלמים בלבד → digests יציבים בין ריצות ומכונות.
6. **מינימליות הרשאות בקוד עצמו**: אין eval, אין רג'קס דינמי, אין קריאת מערכת-קבצים מקלט משתמש.
7. **אפס מפתחות בזיכרון היישום**: השרת מחזיק hash בלבד; השוואה timing-safe (`timingSafeEqual`); יומן-הביקורת מחזיק תוויות בלתי-הפיכות בלבד (`cookie:<8hex>`, `bearer:<8hex>`, `ipHash` מקוצר).
8. **כלל hash-בלבד (Task 11, קבוע)**: המערכת מאחסנת רק את hash של מפתח-האדמין — לעולם לא את המפתח הגלוי; קובץ-סוד בתוך עץ הפרויקט הוא פריט SH פתוח שדורש סגירת בעלים, לא נוהל קבע (docs/secret-hygiene.md SH-7).
9. **ביטול-סשנים גלובלי זמין תמיד (Task 11)**: רוטציית epoch מיידית ומאומתת — ר' §4.1.

## 3. סודות — מצב אמיתי

| סוד | מיקום | חשיפה בריפו | נוהל |
|---|---|---|---|
| טוקן GitHub (`roshpinacare-sys`) | `upload/Roshcaregt.txt` | **לא** — gitignored | שימוש חולף דרך env var; אסור להדפיס; remotes נרמטו |
| מפתח מנהל (`SAOS_ADMIN_KEY`) | `.env` + `upload/saos-admin-key.txt` | **לא** — שניהם gitignored | בשרת נשמר רק `SAOS_ADMIN_KEY_HASH` (sha256-hex); ההתחברות משווה hash-ל-hash בזמן-קבוע; `SAOS_ADMIN_KEY` ב-.env נועד לסקריפט הבדיקות בלבד (לעולם לא נכנס לקוד/ללוג/לריפו). **SH-7 (Task 11)**: עותק ה-key בתוך עץ הפרויקט אינו נוהל-קבע — נדרשת העברה ל-`~/.secrets/` עם 600 + רוטציה במקרה חשש (docs/secret-hygiene.md §6); נבדק קיום-בלבד ב-repo-status |
| `DATABASE_URL` | `.env` | **לא** | `file:./custom.db` — לא רגיש |
| `SAOS_SESSION_SECRET` | אופציונלי ב-.env | **לא** | ברירת-מחדל: נגזר מ-hash המפתח **+ session epoch (Task 11)** — לא נשמר ולא מודפס; רוטציית epoch (revoke-all) מבטלת את כל הסשנים מיידית |
| מפתחות חתימה (STEEM/BLURT/HIVE/TRON) | **לא קיימים בסנדבוקס** | — | מכוון; כשישוחזרו — מחוץ למערכת בלבד (ר' §5) |

## 4. שכבת ההרשאות (Task 5, מיסיון 1)

- **איך מתחברים**: `POST /api/saos/auth {"key": "..."}` → השוואת sha256 ל-`SAOS_ADMIN_KEY_HASH` → cookie `saos_session` (HttpOnly, SameSite=Strict, תוקף 12h ברירת-מחדל) עם `"<expMs>.<HMAC>"`. חלופה לסקריפטים: `Authorization: Bearer <key>`.
- **מה נחשב פעולה רגישה** (401/403 בלי הרשאה + רישום ב-AuditEvent):
  - `POST /api/saos/signer` (יצירת בקשת-עגינה/שידור-לחתימה)
  - `PATCH /api/saos/signer` (רישום תוצאה ציבורית)
  - `POST /api/saos/live-gate` (ניסיון מעבר ל-live)
  - `GET /api/saos/audit` (קריאת יומן-הביקורת)
  - `POST /api/saos/seal` **במצב live** (הופך לבעל-פוטנציאל שידור; ב-dry-run נשאר סימולציה פתוחה)
  - גיבוי/שחזור/ניקוי — בכוונה **אינם** endpoints; הם סקריפטים מקומיים עם דרישת `--yes` (קובץ docs/runbook.md)
- **AuditEvent**: כל ניסיון (מאושר או נדחה) — kind, actor (תווית בלתי-הפיכה), action, allowed, ipHash מקוצר, detail **בלי חומר-מפתח**.

### 4.1 ביטול-סשנים גלובלי (Task 11)

- **המנגנון**: הסשנים חסרי-מצב (`"<expMs>.<HMAC>"`). סוד-ה-HMAC נגזר כולל **session epoch** — מחרוזת אקראית (24 בייטים, hex) שנשמרת בטבלת `SessionControl` (שורה יחידה). ה-epoch אינו חומר-סוד; הוא רק גורם-נגזרת.
- **`POST /api/saos/auth/revoke-all`** (דורש התאמת אדמין, rate-limit 4/דק'): מייצר epoch חדש ורושם אותו — כל cookie שנחתם לפני הרוטציה **מת בטל באותו רגע**, ללא רשימת-סשנים וללא אחסון סוד. הקורא עצמו מתנתק גם הוא (עיצוב מכוון — התגובה מוחקת את ה-cookie). מאומת: `kind=auth-revoke-all`.
- **זמינות**: קריאת ה-epoch מתמוטטת 3 שניות per-process ומבוטלת ברוטציה; כשל קריאה חוזר לערך האחרון הידוע (לעולם לא נועל את כל המשתמשים בגלל תקלת-DB חולפת).
- **Bearer key אינו מושפע**: הרשאת Bearer נגזרת מהמפתח עצמו — ביטול-סשנים הורג סשנים, לא מפתח (תיעוד מפורש ב-`/revoke-all` וב-UI).
- **UI**: מסך אבטחה ומאגר → כרטיס "ביטול סשנים גלובלי" → כפתור "נתק את כל הסשנים" עם דיאלוג אישור, הודעת הצלחה/כשל, ורענון מצב-ההתחברות. אפס סודות בתהליך.
- **בדיקות**: api-check §23 — 401 ללא-הרשאה; עם הרשאה → epoch מסובב, הסשן הקורא עצמו מת, התחברות-מחדש עובדת, אירוע מבוקר נרשם.

## 5. ממשק החתימה החיצוני — חוק-זהב

> אם פעולה דורשת מפתח פרטי/סוד/אישור כספי — המערכת לא מבצעת, לא שומר ולא מדפיסה. היא מתעדת "דורש אישור חיצוני".

המערכת מייצרת: payload קנוני + payloadHash + digestToSign + metadata (רשת, תוקף, הוראות-חתימה).
האדם/הארנק/המכשיר חותמים **מחוץ למערכת**. המערכת מקבלת חזרה **רק את ה-txid הציבורי**.
מבנה DB (`PendingSignature`) בנוי כך שאין עמודה שבה מפתח פרטי יכול אפילו להישמר.

## 6. ביקורת תלויות (Task 5, מיסיון 7 — 2026-09-07)

כלים: `bun audit` + `npm audit` (עם package-lock חד-פעמי לצורך ההשוואה).

| לפני | אחרי |
|---|---|
| next 16.1.1 — 15 ייעוצים (8 high: DoS, middleware bypass, SSRF, XSS) | **next 16.3.4 — 0** |
| postcss ≤8.5.22 — 4 ייעוצים (high: קריאת-קבצים/Path Traversal) | **0** (נמשך מ-next המתוקן) |
| deepmerge-ts <8.0.0 — high (stack exhaustion, דרך prisma) | **0** (override ל-^8.0.0; prisma db:push נבדק אחרי) |
| dead deps: tailwind-merge, class-variance-authority | **הוסרו** (0 ייבוא; הקטנת שטח supply-chain) |

תוצאה: `bun audit` → **No vulnerabilities found**. התוכנית כולה נבדקה מחדש אחרי השדרוג (lint+typecheck+api 45/45+concurrency 8/8).

**סיכונים שנותרו (מתועדים בכנות)**:
1. אין הרצת audit אוטומטית (GitHub Actions לא קיים) — נדרש `bun audit` ידני בכל סבב.
2. השדרוג ל-next 16.3.4 טרם נבדק ב-`next build` מחוץ לסנדבוקס (ה-build חסום בסנדבוקס) — סיכון פריסה, לא אבטחה.

## 7. מה עוד לא מוגן (כנות מלאה)

1. **HTTPS** — פנימית HTTP בלבד; cookie `secure:false` בסנדבוקס. בפריסה אמיתית: TLS + `secure:true` (docs/deployment.md).
2. **DB ניתן לעריכה ישירה** (sqlite) — merkle מגלה אך לא מונע; ההגנה האמיתית = עגינה ציבורית.
3. **revocation גלובלי קיים מאז Task 11** (`POST /api/saos/auth/revoke-all` — רוטציית session epoch, מיידי ומבוקר; בוצע בפועל בסבב הסגירה); פעולה תלולה יותר — שינוי `SAOS_SESSION_SECRET` + הפעלה-מחדש — נשארת כגיבוי.
4. **rate-limit in-memory** — איפוס בהפעלה-מחדש; single-process; פריסה אופקית דורשת limiter משותף.
5. **CI אוטומטי קיים מאז סבב הסגירה (2026-09-07)** — `.github/workflows/ci.yml` מריץ lint+typecheck+build+api-check+concurrency על כל push/pull-request (ללא סודות; auth חד-פעמי מיוצר בזמן-ריצה); עד הריצה המרוחקת הראשונה, `bun run check` נשאר חובה מקומית.
6. **live-gate יכול לדווח ready בלי בדיקות-טריות** — `tests-green` היא אזהרה (תהליכית), לא חוסם; חובה על המפעיל להריץ `bun run check` לפני מעבר.

## 8. נוהל תגובה לאירוע (מקוצר)

1. **חשד לשבירת שרשרת**: `GET /api/saos/kernel` (7/7) + `GET /api/saos/verify-chain` + live-gate `chain-integrity`. נכשל → עצור כתיבה, גבה, תעד.
2. **הדלפת מפתח מנהל**: סובב — החלף `SAOS_ADMIN_KEY_HASH` (ואופציונלית `SAOS_SESSION_SECRET`) + הפעלה-מחדש; כל הסשנים מתבטלים; תעד ב-AuditEvent/worklog.
3. **הצפת בקשות**: ה-429 כבר עובד; לחסימה קשיחה יותר — הקטן `SAOS_RL_*_PER_MIN` + הפעלה-מחדש.
4. **DB פגום**: שחזור מגיבוי מאומת (database.md §retention + runbook) — האימות מסרב לקובץ פגום (הוכח בבדיקת-התיחום).
5. **בכל אירוע**: רשומה ב-worklog.md — מה, מתי, איך אותר, איך תוקן, איך נמנע.

---

## היגיינת סודות (Task 6) — סריקה מלאה + מצאים

סריקה מלאה בוצעה בסבב זה (שמות-קבצים ומטא-דאטה בלבד — תוכן קבצים רגישים לא נקרא, לא הודפס ולא הועתק מעולם):
- דפוסי-סודות על כל הקבצים העקובים (`ghp_`/`sk-`/`AKIA…`/`BEGIN … PRIVATE KEY`/`xox…`): **0 התאמות — נקי**.
- `.env` בהיסטוריה הכיל **רק `DATABASE_URL`** (לא-רגיש) — אומת לפי שמות-משתנים בלבד.
- `upload/Roshcaregt.txt` (טוקן GitHub) ו-`upload/saos-admin-key.txt` (גיבוי מפתח-מנהל): **מעולם לא נכנסו להיסטוריה**.
- ממצא פתוח: `upload/חח.txt` (101 בייטים) היה בהיסטוריה (5356dab→c69e6e4) — תוכנו לא נבדק מעולם; **נדרשת החלטת בעלים** (סיבוב-סוד אם רלוונטי; אין שכתוב-היסטוריה ללא אישור מפורש).
- תיקון שבוצע: `.env` הרשאות 600 (היו 664). `upload/*.txt` בבעלות uid אחר — chmod לא אפשרי בסנדבוקס; נדרש `chmod 600` מחוץ לסנדבוקס.

## סבב הסגירה האוטונומי (2026-09-07) — מה בוצע בפועל

באישור דחיפה דחוף מהבעלים ("שידחוף דחוף") בוצעו, בלי לחשוף או לקרוא תוכן-סוד אחד:

- **SH-7 נסגר**: `upload/saos-admin-key.txt` הועבר ל-`~/.secrets/saos-admin-key` (600, תיקיה 700) — `mv` בלבד; `adminKeyFileInTree=false` אומת ב-API; ההחלטה הוקלטה `decided-default` (audited).
- **SH-1 (מיקום) נסגר**: קובץ הטוקן הועבר ל-`~/.secrets/github-token` (600); שימש לדחיפות דרך credential-helper חד-פעמי מסביבה (לא מודפס, לא מוטמע); רוטציית-טוקן תקופתית נותרה פעולת בעלים.
- **ביטול-סשנים גלובלי בוצע בפועל** (`auth-revoke-all` audited) — כל הסשנים כולל הקורא מתו; התחברות-מחדש אומתה.
- **8/9 החלטות עודכנו** ב-API המבוקר (ראה docs/owner-decisions.md §5); `live-mode-approval` נשארה פתוחה בכוונה.
- **CI נוסף**: `.github/workflows/ci.yml` — בלי סודות, בלי פעולות חיות; ה-build מאומת שם (בסנדבוקס `next build` נאסר מדיניות).
- **דחיפה בוצעה לפי הפרוטוקול**: סריקה (0 התאמות) → fetch (ללא שינוי מרוחק) → push רגיל → אימות מרוחק. אין כוח/מחיקה/שכתוב.

פירוט מלא + מרשם סיכונים (SH-1..SH-6) ונוהלי סגירה: **docs/secret-hygiene.md**.

## עדכון מסלול החתימה (Task 6)

- מסלול החתימה כעת מחזור-חיים מלא (`pending → awaiting-approval → signed-externally → recorded | failed | expired | cancelled`) — כל מעבר רגיש דורש הרשאה + מוגבל-קצב + נרשם ב-AuditEvent (כולל הסוגים החדשים `signer-cancel`, `signer-fail`).
- רישום תוצאת עוגן מקבל **נתונים ציבוריים בלבד** (txid / proofRef / anchorRef) — מבנית אין שדה שאליו ניתן להזריק חומר-מפתח.
- אימות txid מול רשת ציבורית הוא **קריאה בלבד** ל-endpoints ציבוריים (STEEM/HIVE/BLURT condenser, TronGrid), opt-in, פסק-זמן 5s — אינו שידור, אינו עסקה, אינו פעולה פיננסית.
- תוצאה שלא ניתן לאמת מוצגת תמיד כ-unverified עם הסיבה — לעולם לא כעוגן סופי (הוכח ב-api-check ובדפדפן).

## Task 12 — מודולי אתריום/סולנה: בטיחות RPC וסודות

- **keyless by design**: שני המודולים (`src/lib/saos/networks/ethereum.ts`, `solana.ts`) מחזירים מצב ללא סודות; `not-configured` הוא מצב כנה ולא שגיאה.
- **safeRpcUrl דוחה**: URL עם credentials מוטמעים (`user:pass@`) או פרמטר-שאילתה שנראה כמפתח (`key|token|secret|auth`); URL לא-תקני → not-configured. לעולם לא נזרקת חריגה.
- **אין אחסון/הצגה של RPC URL**: ה-URL חי רק בזיכרון-תהליך מ-env; בתשובות API חוזר `rpcStatus` (מצב) וב-probe `sourceHost` (hostname בלבד).
- **probe opt-in וקריאה-בלבד**: `GET /status?probe=1` בלבד; פסק-זמן 2.5s; אין עסקה/שידור/חתימה; כישלון = `unverified`/לא-מאומת-חי — לעולם לא עוגן סופי.
- **אימות-txid לרשתות החדשות**: `eth_getTransactionByHash` / `getTransaction(finalized)` על RPC קריאה keyless (env תקין או endpoint ציבורי ידוע); כל כישלון = unverified כנה.
- **`.env.example`**: שמות משתנים בלבד (`ETH_RPC_URL`, `ETH_CHAIN_ID`, `SOL_RPC_URL`, `SOL_CLUSTER`) — אין ערכים אמיתיים; RPC עם מפתח אסור בריפו על-פי כלל הברזל.

---

## Task 13 (2026-09-08) — עמדת האבטחה במצב חי

- **safe-live**: המערכת מוכיחה חיים בקריאה-בלבד; `broadcastCapable=false` מבנית (אין כספת) — הוכחת-חיים לעולם אינה הרשאת-שידור. machine-checkable: `live-proof.safety` + assertion קבוע ב-api-check §28.
- **משטח-סוד חדש (מבוקר)**: `live-proof` קורא את `~/.secrets/github-token` (0600 נאכף בקוד) לזיכרון-בלבד עבור קריאת-API אחת לסטטוס CI של הריפו הפרטי. לא מוצג, לא נשמר, לא נרשם, לא נשלח לשום מקום אחר. תקלה → `available:false` (לא קריסה, לא חשיפה).
- **seal ב-live = auth-required**: בעיצוב Task 5 פעימה ב-live נחשבת broadcast-adjacent; אומת חי בסבב זה (7 כשלי-סוויטה יבשה אובחנו ותוקנו — הסוויטה מזדהה אוטומטית).
- **probes keyless בלבד**: כל probe רשת עובר דרך endpoints ציבוריים ללא מפתח (או env-RPC שאומת חסר-credentials ע"י safeRpcUrl); URL לעולם לא חוזר — hostname בלבד; מטמון 60s להגנה על ה-endpoints הציבוריים.
- **התאמת מצבים למציאות**: פריטי-האבטחה ב-preflight דינמיים (CI קיים — הטענה הישנה הוסרה; SH-7 מוצג רק כשהקובץ בעץ). רישום-סודות הסבב: docs/secret-hygiene.md §8.
