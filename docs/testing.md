# בדיקות — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 5)

## 1. איך מריצים

```bash
# === הפקודה האחת (חובה לפני commit) — דורשת dev server רץ ===
bun run check     # lint + typecheck + test (26 בדיקות API) + verify (8 פעימות מקבילות)

# רכיבים בנפרד:
bun run lint        # eslint . — נקי = יציאה 0
bun run typecheck   # tsc --noEmit
bun run test        # scripts/api-check.mjs — חוזה מלא על 9 ה-endpoints + fail-closed
bun run verify      # scripts/concurrency-check.mjs — 8 POST /seal מקבילים + אינבריאנטות
bun run build       # הגדרה בלבד — אסור להריץ בסנדבוקס (ר' §4 build)

# selftest הקרנל:
curl -s http://localhost:3000/api/saos/kernel | jq '.result.ok, .result.checks'

# אימות השרשרת המלא (מקבילת verify-pack, מרובה-חותמים):
curl -s http://localhost:3000/api/saos/verify-chain | jq '.ok, .receiptChain, .totals'

# פעימה + idempotency:
curl -s -X POST localhost:3000/api/saos/seal -H 'Content-Type: application/json' \
  -d '{"stamps":4,"batchId":"my-key-1"}' | jq .ok,.seal.height   # ריצה שנייה → idempotent:true
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

**אין** פריימוורק בדיקות יחידה (ויטסט/Jest לא מותקנים) — שכבת הבדיקה: selftest-כ-API + סקריפטי check (api-check 26 בדיקות + concurrency-check). פריימוורק יחידה נשאר פער מוכר ב-next-steps.

## 3. תוצאות אחרונות (סוף Task 4, 2026-09-07)

| בדיקה | תוצאה | ראיה |
|---|---|---|
| `bun run check` (הפקודה האחת) | ✅ lint נקי + tsc נקי + api-check 26/26 + concurrency 8/8 | הרצה מלאה |
| api-check — כל 9 endpoints + fail-closed | ✅ 26 passed, 0 failed | scripts/api-check.mjs |
| concurrency-check — 8 POST /seal מקבילים | ✅ 8/8 ok, heights 13..20 רציפים יחודיים, roots יחודיים, 170–213ms | scripts/concurrency-check.mjs |
| verify-chain scope=chain | ✅ ok, receiptChain ok, 0 digestErrors/linkErrors, `forks:[17]` מדווח, כל החותמים all-verified | curl |
| idempotency (אותו batchId ×2) | ✅ ריצה שנייה: `idempotent:true`, אותו height/root | api-check |
| מצב safe | ✅ /status mode=safe writes=false; POST /seal → `mode-refusal` (HTTP 200); /energy מחשב עם `persisted:false` | הרצה ידנית |
| מצב live ללא אישור | ✅ נפילה ל-dry-run + הודעת הגנה | הרצה ידנית |
| מצב live עם אישור-כפול | ✅ mode=live, writes=true, **broadcastCapable=false** | הרצה ידנית |
| backfill `at` (41 שורות היסטוריות) | ✅ 41/41 שוחזרו מוכח-דיג'סט, 0 כישלונות | scripts/backfill-receipt-at.ts |
| DB עקביות מלאה | ✅ heights 1..31 רציפים יחודיים; 229 עלים תואמי-סכום; 0 יתומים | בדיקת prisma |
| E2E דפדפן (agent-browser) | ✅ 5 לשוניות, פעימה מה-UI (height 31), תג dry-run בפוטר, mobile iPhone 14, אפס שגיאות קונסולה | agent-browser |

### תוצאות סבב Task 3 (היסטורי — 12:19–12:21 UTC)

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

### BUG-003 — מירוץ פעימות מקבילות + התנגשות שורשים באותו-מילישנייה
- **תיאור**: תחת עומס מקביל, שתי בקשות באותה מילישנייה עם אותו מספר stamps הניבו אותו לוג-פעולות (nonces מבוססי `Date.now()`) → אותו merkle root → P2002 על root; ובנוסף מירוץ height (P2002 על height) ותקלות נעילת SQLite (P2028/SQLITE_BUSY).
- **סיבה**: nonces נגזרו מ-`Date.now()` בלבד; קריאת max(height) + create לא היו אטומיים; retry לא כיסה תקלות-נעילה חולפות.
- **קבצים מושפעים**: `src/app/api/saos/seal/route.ts`, `src/lib/saos/receipt-store.ts` (חדש).
- **פתרון**: (1) `batchId` כמזרע nonces + מפתח-idempotency (default `randomUUID`); (2) כל הכתיבות בטרנזקציה אחת מאחורי `withWriteLock`; (3) `retryWrite` — backoff על P2002 + תקלות חולפות; (4) timeout טרנזקציה 20s/maxWait 10s.
- **ראיה לתיקון**: `bun run verify` — 8/8 פעימות מקבילות ok, heights רציפים יחודיים, roots יחודיים (מול 1/8 ok לפני התיקון).
- **סיכון נותר**: ריבוי-תהליכים (מעבר ל-instance אחד) דורש Postgres — מתועד (F5).

### BUG-004 — שרשרת-הקבלות לא הייתה ניתנת-לאימות (חסר זמן-החיתום `at`)
- **תיאור**: `verifyChain` נכשל על **כל** הקבלות ההיסטוריות — ה-`at` שנכנס לדיג'סט לא נשמר ב-DB (רק `createdAt` של השורה, שונה ב-1ms+).
- **סיבה**: העמודה לא הייתה קיימת בסכימה; האימות השתמש ב-createdAt כתחליף.
- **קבצים מושפעים**: `prisma/schema.prisma` (+`at DateTime?`), `receipt-store.ts` (כותב at), `scripts/backfill-receipt-at.ts` (חדש), `verify-chain/route.ts`.
- **פתרון**: עמודה + כתיבה לכל קבלה חדשה + backfill חד-פעמי **מוכח-דיג'סט** (חיפוש מילישנייה בחלון 10 שניות שה-digest שלה מתאים — 41/41 שוחזרו, 0 כישלונות). לא שכתוב נתונים — שחזור שדה ע"י הוכחת האש.
- **ראיה לתיקון**: `GET /verify-chain` → `receiptChain.digestErrors: []`.
- **סיכון נותר**: אין (השחזור מוכח מתמטית; קבלות עתידיות נשמרות עם at).

### BUG-005 — פיצול אמיתי בשרשרת ההיסטורית (אינדקס 17)
- **תיאור**: שתי קבלות energy-plan נכתבו 1ms זו אחר זו (11:46:29.976/.977) ושתיהן chain-ו על אותו prevDigest — פיצול (F2 בפעולה).
- **סיבה**: כתיבת קבלות בלי טרנזקציה מסדרת (באג היסטורי; המקבילות של ה-UI ירו שתי בקשות energy יחד).
- **קבצים מושפעים**: נתונים היסטוריים; `evidence.ts` (+`verifyChainDag`), `verify-chain/route.ts`.
- **פתרון**: מבנית — קבלת seal נכתבת בתוך טרנזקציית ה-seal (אי-אפשר להתפצל); אימות — `verifyChainDag` סובלני-פיצולים: כל prevDigest חייב להיות digest של קבלה קודמת; פיצולים **מדווחים** (`forks:[17]`), לעולם לא נשכתבים.
- **ראיה לתיקון**: `GET /verify-chain` → ok:true, `forks:[17]`, linkErrors ריקים.
- **סיכון נותר**: אין — ההיסטוריה נשמרת כפי שהייתה, דווקא זו העדות.

### BUG-006 — סטיית-קוד שנתפסה בשער (tsc), לא הגיעה לריצה
- **תיאור**: בכתיבת ה-seal האטומי הפוך סדר ארגומנטים ב-`applyTx(tx, state)` (החתימה: `(state, tx)`).
- **תפיסה**: `bunx tsc --noEmit` — TS2345. לא רץ מעולם בפרודקשן.
- **פתרון**: סדר נכון. **ראיה**: tsc נקי.
- **סיכון נותר**: אין; מאשר את ערך שער ה-typecheck ב-check.

### באגים היסטוריים מסבב הבנייה (מתועדים ב-worklog Task 2)
1. canonical JSON דחה float → קידוד integer-safe (per-mille/micro-units) ב-payloads של Hive/economy.
2. Next 16 הסיר `next lint` → eslint flat config (השלמת BUG-002 הסבב זה).
3. react-hooks `set-state-in-effect` → טעינה נדחית דרך setTimeout(0).
4. NextConfig לא מקבל מפתח `eslint` → הוסר.

## 5. מה לא מכוסה / דורש בדיקה ידנית

| נושא | מצב |
|---|---|
| בדיקות יחידה ממוסדות (vitest) | לא קיימות — selftest-כ-API + סקריפטי check במקום |
| ריבוי-תהליכים/מופעים מרובים מול SQLite | לא נבדק — mutex הוא בתהליך; דורש Postgres (F5) |
| עומסים ממושכים/זמן-ריצה ארוך | לא נבדק (concurrency-check הוא רץ קצר) |
| רינדור מובייל אמיתי | נבדק ב-agent-browser (iPhone 14 + 390×844 קודם); אין רגרסיה אוטומטית |
| קישוריות לרשתות אמיתיות (STEEM/BLURT/HIVE/TRON nodes) | **לא קיימת ב-v2** — כל המתמטיקה מקומית; דורש כספת + קריאות חיות |
| `bun run build` | **חסום-סביבה**: הסקריפט מוגדר אך ריצת build אסורה בסנדבוקז (מדיניות — dev-server בלבד); נדרש אישור/סביבה חוץ |
| Lighthouse/a11y | לא נבדק (RTL מלא, תמיכת מקלדת בסיסית בכפתורים) |

## 6. מה עבר אוטומציה

- **`bun run check` — הפקודה האחת**: lint + typecheck + 26 בדיקות חוזה + 8 פעימות מקבילות עם בדיקות אינבריאנטה.
- selftest קרנל — כל קריאת `/api/saos/kernel` (כולל כניסה למגדל-פיקוח ב-UI).
- verify-pack + verify-chain — כל כניסה ללשונית הוכחות / קריאת סקריפט.
- חסר: ריצת check אוטומטית על push (אין GitHub Actions בסנדבוקז — ר' next-steps).

## 7. מה נכשל וטופל (היסטוריה מרוכזת)

- BUG-001 height unique (Task 3) → תוקן ונבדק.
- BUG-002 lint script (Task 3) → תוקן ונבדק.
- BUG-003 מירוץ מקביל + התנגשות שורשים (Task 4) → תוקן (batchId+mutex+retry) והוכח 8/8.
- BUG-004 שרשרת לא-ניתנת-לאימות, חסר at (Task 4) → תוקן (עמודה + backfill מוכח-דיג'סט 41/41).
- BUG-005 פיצול היסטורי באינדקס 17 (Task 4) → תוקן מבנית + דיווח forks.
- BUG-006 סטיית applyTx נתפסה ב-tsc (Task 4, לא רץ) → תוקן.
- דחיית float בקנוניה → תכונה: קלט רע נדחה fail-closed.
- התנגשות digest בריצה חוזרת זהה → מטופל בכוונה (השרשרת שומרת על הקיים).


---

## Task 5 — בדיקות שכבת-האבטחה וה-hardening (2026-09-07)

### api-check הורחב: 26 → 45 בדיקות

קטגוריות חדשות (כולן ירוקות, הרצה חיה בסבב זה):

| קטגוריה | מה נבדק | תוצאה |
|---|---|---|
| live-gate | חוזה מלא (ok/readyForLive/blockers/warnings/checks≥8), ids קיימים, POST ללא-הרשאה→401 | ✅ |
| auth | מצב מדווח; פעולה-רגישה בלי-הרשאה→401; מפתח שגוי→401; מפתח נכון→cookie; סשן מאמת | ✅ |
| keyless signer | יצירה מאושרת→SignRequest; אפס שדות-מפתח; כפילות→idempotent; רישום txid→ready; שכתוב→נדחה; txid פגום→נדחה | ✅ |
| audit | 401 לאנונימיים; אירועי allowed+denied נרשמים; **אפס חומר-מפתח ביומן** (assert אוטומטי) | ✅ |
| rate-limit | burst ×14 על POST /auth (מגבלה 8/דק') → 429 מרובים + Retry-After | ✅ (נבדק אחרון — מרוקן את החלון) |
| never-500 | כל הנתיבים עדיין ללא 500 (כולל שכבת האבטחה) | ✅ |

### גיבוי/שחזור/ניקוי — תרגילים מלאים

| תרגיל | פקודה | תוצאה |
|---|---|---|
| גיבוי מאומת | `bun run backup` | ✅ VACUUM INTO + integrity=ok + counts-match + OpLog(verified=true) |
| שחזור dry-run | `bun run restore <dir>` | ✅ אימות מלא, לא נגע בכלום |
| תרגיל שחזור | `--target db/test-restore.db` | ✅ עותק ליעד-בדיקה, live untouched |
| **ביקורת-תיחום** | בת-בייט שנוסף ל-snapshot → restore | ✅ **נדחה**: "verification failed — nothing was touched" |
| ניקוי dry-run | `bun run cleanup` | ✅ 0 שורות-ניתנות-למחיקה (DB צעיר); protected list מוצהר |

### תוצאה מלאה של `bun run check` בסוף הסבב

lint ✅ · typecheck ✅ · api-check **45/45** ✅ · concurrency **8/8** (heights 48..55 רציפים, roots ייחודיים, שרשרת תקינה) ✅

### מה עדיין לא מכוסה

1. GitHub Actions — כל הבדיקות ידניות (`bun run check`).
2. אין unit-tests למודולים (auth/rate-limit) בנפרד — נבדקים שחה דרך ה-API בלבד.
3. next 16.3.4 לא נבדק ב-`next build` (חסום בסנדבוקס) — ר' deployment.md.
4. דפדפן: טאב "שער-חיים" נבדק ידנית (desktop+iPhone 14, 0 שגיאות קונסולה) — אין בדיקת-e2e אוטומטית.

---

## Task 6 — תוצאות הרצה (2026-09-07)

### api-check: 65/65 (היה 45 ב-Task 5; 20 טענות חדשות)

**חדש — anchor-preflight (10 טענות)**:
| טענה | תוצאה |
|---|---|
| GET /anchor-preflight ok | ✅ |
| כל שדות-החוזה קיימים (14 שדות) | ✅ |
| 10 בדיקות רצות | ✅ (checks=10, blockers=2, warnings=1 — כנה) |
| מזהי-בדיקה מרכזיים קיימים | ✅ |
| `externalSignerConnected=false` — לעולם לא מצהיר על יכולת שידור | ✅ |
| recommendedNextAction לא-ריק | ✅ |
| fail-closed: `?network=BOGUS` → ok:false | ✅ |
| scope `?network=TRON` עובד | ✅ |
| ספירות תור+שרשרת קיימות | ✅ |

**חדש — מחזור-חיים חתימה (11 טענות)**:
| טענה | תוצאה |
|---|---|
| create manual → `awaiting-approval` | ✅ |
| רישום txid+proofRef+anchorRef → `signed-externally`, `verified=null` | ✅ |
| ביטול אחרי תוצאה נדחה (אל-הפיך) | ✅ |
| cancel לפני תוצאה → `cancelled` + סיבה | ✅ |
| cancel על מצב סופי נדחה | ✅ |
| action:fail → `failed` | ✅ |
| **unverified כנה**: txid מזויף + verify:true → `signed-externally` + `verified:false` + סיבה ("שירות הרשת לא נגיש מהסנדבוקס") | ✅ |
| unverified לא מסומן recorded | ✅ |
| GET חושף סטטוסים (signed-externally, cancelled, failed, pending) | ✅ |
| byStatus counts | ✅ |

**נשמרו מ-Task 5** (auth 401/200, rate-limit 429, audit ללא חומר-מפתח, idempotency, fail-closed, never-500): ✅ כולן.

### בדיקות אחרות בסבב

| בדיקה | תוצאה |
|---|---|
| lint + typecheck | ✅ נקי |
| concurrency (8 פעימות מקבילות) | ✅ 8/8 — heights רציפים, roots יחודיים, שרשרת שלמה |
| דפדפן (agent-browser): login → create → awaiting-approval badge → txid+verify → unverified כנה בממשק → cancel | ✅ 0 שגיאות-קונסולה/עמוד |
| מובייל (iPhone 14) | ✅ אין גלילה-אופקית |
| גיבוי מאומת לפני העבודה | ✅ backup-2026-09-07T14-36-56 (integrity=ok, counts-match) |

### מה עדיין לא נבדק (כנה)

1. אימות-txid אמיתי מוצלח (recorded) — לא ניתן בסנדבוקס: outbound RPC חסום; הנתיב מאומת עד `verified:false` + סיבה, והענף `verified:true` סקור בקוד ומסומן כדורש סביבה עם egress.
2. פקיעת-זמן חיה (expired) לא נבדקה ב-API — דורשת המתנה של TTL; מיושמת כחישוב עצל (`effectiveStatus`) ונבדקה בהיגיון בלבד.
3. אין GitHub Actions (ידני בלבד); אין e2e אוטומטי לדפדפן.

---

## Task 10 — בדיקות בניית ה-UI (2026-09-07)

### סוויטה מלאה (`bun run check`) — ירוק

| שלב | תוצאה |
|---|---|
| `bun run lint` | ✅ נקי (0 שגיאות/אזהרות) |
| `bun run typecheck` | ✅ נקי (tsc --noEmit) |
| `bun run test` (api-check) | ✅ **80/80** (היה 65; +2 research משוחזר, +6 repo-status, +7 decisions) |
| `bun run verify` (concurrency) | ✅ **8/8** — heights 4..11 רציפות ויחודיות, roots יחודיים, chain intact, 11 seals / 79 leaves all-verified, אפס 500 |

### api-check — 15 הטענות החדשות (Task 10)

- research משוחזר: חוזה מלא (findings=10 + synthesis) — 2
- repo-status: חוזה git/backups, בוליאנים-והרשאות-בלבד, איסור דליפת טוקן ב-payload, סריקה חיה (63 קבצים, 0 התאמות) — 6
- decisions: registry+מקורות+phases, POST ללא-auth→401, fail-closed key/status בוגוס, רישום מאומת, שיקוף ב-GET — 7

### בדיקות דפדפן (agent-browser) — עבר

- **Desktop 1440**: כל 7 הטאבים נסרקו (a11y tree מלא); זרימות זהב: פעולה-מומלצת→ניווט→שרשרת; פעימה מדיאלוג אישור (toast "חותמה נוצרה: height 1", חסימות 3→2, מדדים חיים); הרץ אימות (8/8 עלים, "אימות עבר"); login (cookie) → צור בקשת → רישום txid מזויף+verify → **unverified כנה מוצג** (סיבת אי-egress) → בקשה שנייה → ביטול עם סיבה; עדכן החלטה (recorded + audit); יומן ביקורת חי (אירועי 401/decision-update/auth-login נראים).
- **נייד 360/390/414/768**: אפס גלילה אופקית בכל 7 הטאבים (נמדד `scrollWidth−clientWidth=0`); ניווט עליון מתגלגל; כרטיסים מלאים.
- **תיקון באג בזמן אימות (BUG-009)**: גרידים עם `grid` ללא `grid-cols-1` יצרו עמודה implicit בגודל max-content → פאנלים ב-644px על 360px. תוקן בכל 8 המופעים; נמדד שוב = 0. גילוי: מדידת DOM אוטומטית (לא עין).
- **מקלדת**: טאבים עם חיצים (RTL נכון — ArrowLeft מתקדם), focus-visible, Esc סוגר דיאלוגים, skip-link.
- **קונסולה**: אפס שגיאות/אזהרות (רק לוגי HMR); dev.log נקי לאורך כל הסבב (למעט 429-ים מכוונים של burst הבדיקות).
- **footer**: מוצמד מבנית (`mt-auto` + safe-area); נמדד נדחף-טבעי בעמוד ארוך (footerBottom===docH).

### מה עדיין לא נבדק (כנה)

- `bun run build` — חסום-סביבה (מדיניות dev-server בלבד).
- אימות txid אמיתי מול רשת — דורש egress (בסנדבוקס תמיד unverified כנה).
- בדיקת 429 מקצה-הדפדפן — מכוסה ב-API בלבד (burst); ב-UI מוצג ErrorState מותאם (לא נוצר תרחיש חי).
- screen-reader מלא (NVDA/VoiceOver) — בוצע רק סריקת a11y-tree + תוויות.

---

## Task 11 (2026-09-07) — היגיינת מפתח, ביטול-סשנים, סגירת החלטות, מוכנות עוגן ראשון

### סוויטה מלאה — עבר

- `bun run lint` ✅ · `bun run typecheck` ✅
- **`bun run test` (api-check): 104/104** (עלה מ-80) — תוספות Task 11:
  - decisions v2: שדות-חוזה מלאים (id/title/category/severity/status/defaultSafeAction/requiredOwnerAction/timeEstimate/auditTrail) — 4
  - decisions v2: SH-7 `admin-key-location` ברישום + counts.needsResource — 2
  - decisions v2: POST needs-resource / resolved-external (authed) + reset + audit trail גדל ומאוכסן — 4
  - repo-status: `adminKeyFileInTree` (בוליאני, קיום-בלבד) + כלל hash-בלבד ללא חומר-מפתח — 2
  - preflight: `firstAnchorReadiness` חוזה מלא + כנות 3-ערכית (אין "ready") — 2
  - signer v2: purpose/verificationStatus/auditTrail בכל שורה + trail מאוכסן — 2
  - signer ttlSeconds: יצירה dry-run עם 60s (וגם fail-closed מתחת למינימום) → **פקיעה עצלה נצפית (≤75s)** → מוטציה ורישום אחרי פקיעה נדחים — 4
  - **revoke-all**: ללא-auth → 401; עם-auth → ok+revokedAt; **הסשן הקורא עצמו מת**; התחברות-מחדש עובדת; סשן חדש מאומת; אירוע `auth-revoke-all` ביומן — 6
- **`bun run verify` (concurrency): 8/8** — heights 24..31 רצופים, roots ייחודיים, verify-chain תקין (25 seals/177 עלים all-verified).
- גיבוי מאומת לפני העבודה הקריטית: backup-2026-09-07T19-42-23.

### בדיקות דפדפן (agent-browser) — עבר

- **Desktop 1440**: סקירה — כרטיס "עוגן ראשון — מוכנות" (לא מוכן; STEEM מומלצת; קישורי בחירת-רשת/סגירת-החלטות) + פאנל "החלטות קריטיות פתוחות — חוסמות התקדמות" (6 שורות); אבטחה — כרטיס היגיינת סודות (SH-7 פתוח; כלל hash-בלבד) + כרטיס ביטול-סשנים; **זרימת זהב מלאה**: התחברות → "נתק את כל הסשנים" → דיאלוג אישור → toast הצלחה → **מצב מחובר התאפס (כולל הקורא)** → כפתור נדרש-התחברות שוב; החלטות — "סגור החלטה" עם preset decided-default → שמירה → toast + badge; 7 סטטוסים בדיאלוג; היסטוריית החלטה (9 אירועים, actor+זמן); רשתות — אפשרויות בעלים ל-HIVE/TRON, זמן/עלות, "לא נבדק חי" ×4; חתימות — purpose, מצב אימות, היסטוריית ביקורת לכל בקשה; יומן — אירועי `auth-revoke-all`/`decision-update` חיים נראים.
- **נייד 360/390/414**: אפס גלילה אופקית בטאבים המרכזיים (סקירה/חתימות/החלטות/אבטחה) — נמדד `scrollWidth`.
- **מקלדת RTL**: חיצים מתקדמים בין טאבים; focus נראה.
- **קונסולה**: 0 שגיאות; dev.log נקי (רק 429-ים מכוונים מ-burst הבדיקות).

### מה עדיין לא נבדק (כנה)

- `bun run build` — חסום-סביבה.
- `verified=true` באימות txid — דורש egress אמיתי; בסנדבוקס רק המסלול הכנה unverified (נבדק).
- רוטציית מפתח-אדמין מלאה — פעולת בעלים (נוהל מתועד, לא מבוצע על-ידי סוכן).

---

## סבב הסגירה האוטונומי (2026-09-07) — תוצאות בדיקות

- `bun run lint` ✅ · `bun run typecheck` ✅ (אחרי שינויי repo-status/security-tab)
- **`bun run test` (api-check): 104/104** — כולל הדרילים החיים של revoke-all (6), פקיעת-ttl (4), decisions v2 (10)
- **`bun run verify` (concurrency): 8/8** — heights 34..41 רצופים, 25 seals/177 עלים all-verified
- **ביטול-סשנים בוצע בפועל פעמיים מבוקר** (דריל api-check + סגירה סופית) — caller-session מת (401 אומת), התחברות-מחדש עובדת
- **8/9 החלטות הוקלטו דרך POST מאומת** — כל אחת עם אירוע decision-update; אימות GET לאחר מכן (counts: open=1, needsResource=3, decided=8 כולל deferred)
- `adminKeyFileInTree=false` אומת ב-API לאחר ההעברה — המערכת עצמה מאשרת סגירת SH-7
- מצב preflight לאחר הסגירה: `firstAnchorReadiness=not-ready`, חוסמים: network-resources + mode-allows-broadcast — כנה, ללא שינוי מלאכותי

### מה עדיין לא נבדק (כנה — עדכון)

- `bun run build` — נאסר בסנדבוקס (מדיניות dev-server); **ה-CI החדש מריץ אותו על כל push** — הריצה המרוחקת הראשונה היא האימות
- ריצת ה-CI עצמה ב-GitHub — תתאפשר רק לאחר ה-push; לא ניתן לאמת מקומית
- `verified=true` באימות txid — דורש egress אמיתי (ללא שינוי)
- רוטציית מפתח-אדמין מלאה — פעולת בעלים (נוהל מתועד §7, לא מבוצע)

## Task 12 — תוצאות הסוויטה (אתריום/סולנה)

| בדיקה | תוצאה |
|---|---|
| `bun run lint` | ✅ נקי |
| `bun run typecheck` | ✅ נקי |
| `bun run test` (api-check) | ✅ **135/135** (104 → 135; סעיפים 24–27 חדשים ל-Task 12) |
| `bun run verify` (concurrency) | ✅ 8/8 — גבהים רצופים, שרשרת תקינה |

**הצהרות חדשות (בחירה):** ETHEREUM/SOLANA ב-status ×6 וב-matrix; dry-run כברירת-מחדל; `not-configured` ללא RPC ללא שגיאה; chainType נכון; אין המצאת chainId/עלות/זמן; אין מחרוזות בצורת-סוד ואין URLs בתשובות; probe opt-in כנה (לא מנסה כש-not-configured); preflight מקבל ETH/SOL ומדווח warn (לא fail); SignRequest יבש לשתי הרשתות + ביטול-ניקוי.

**דפדפן (agent-browser):** מסך רשתות — 6 כרטיסים כולל זהות-שרשרת; dropdown חתימות ×6; אפס גלילה אופקית ב-360/390/1440px; אפס שגיאות קונסולה.

### מה עדיין לא נבדק (כנה)
- probe מול RPC חי אמיתי — דורש `ETH_RPC_URL`/`SOL_RPC_URL` מוגדרים (לא קיימים בסנדבוקס; הנתיב נבדק לעומק ה-not-configured)
- `bun run build` — נאסר בסנדבוקס; נאמת ב-CI

## BUG-009 — תיעוד וסגירה (Task 12)

**תופעה:** שתי ריצות CI ראשונות נכשלו ב-`api-check crashed: JSON Parse error: Unrecognized token '<'` — תמיד מיד אחרי `GET /plans`, בקריאה ל-`GET /research`.

**חקירה:** ב-CI (checkout נקי) קובץ ה-route `src/app/api/saos/research/route.ts` לא היה קיים → Next dev החזיר דף-404 HTML → `res.json()` קרס. בסנדבוקס הקובץ היה קיים ולכן הכול עבד.

**שורש:** `.gitignore` הכיל `research/` (לא-עוגן) — התבנית שנועדה לתיקיית ארכיוני-המחקר בשורש תאמה גם את `src/app/api/saos/research/`, וה-route שוחזר-Task-10 מעולם לא נכנס ל-git (status נקי — שקט מסוכן).

**תיקון:**
1. התבנית עוגנה ל-`/research/`; ה-route נוסף ל-repo (`ec28086`).
2. `j()` ב-api-check מקשיח: תשובה לא-JSON נכשלת עם אבחון (status + content-type + snippet מפושט) במקום קריסה אלמונית.
3. הצהרת repo-status secrets נעשתה מודעת-סביבה: `.env` קיים → חייב הרשאות לא-world-readable; לא קיים (CI) → `null` כנה; `envValuesExposed=false` נאכף בשני העולמות (`4e853a9`).

**תוצאה:** ריצת CI על `4e853a9` — **SUCCESS** מלא (install → prisma → lint → typecheck → **next build** → dev → api-check → concurrency). זהו גם האימות הראשון של `next build` (פעולה שנאסרה בסנדבוקס) — פריט build-verification נסגר.

**לקח:** קובץ קיים-מקומית-ולא-מנוטר הוא סיכון שקט; audit של `find` vs `git ls-files` על src/scripts/docs הוא בדיקת-תקינות שיש להריץ אחרי כל "שחזור" קובץ.

---

## Task 13 — live-proof suite (2026-09-08)

### תוצאות מלאות במצב live (safe-live, ללא שידור)

| בדיקה | תוצאה |
|---|---|
| `bun run lint` / `bun run typecheck` | ✅ נקי |
| `bun run test` (api-check) | ✅ **147 passed, 0 failed** (135 → 147: §1b מודע-מצב + §28 live-proof ×11) |
| `bun run verify 8` (concurrency) | ✅ 8/8 — heights רצופים (82→90 בסבבים), שרשרת תקינה, 0 עלים פגומים |
| `GET /api/saos/live-proof` חי | ✅ service=ok · safeLive=true · 5/6 רשתות מאומתות-קריאה (STEEM/HIVE/TRON/ETH chainId=0x1/SOL slots) · BLURT כנה לא-מאומתת (egress) · CI success @382d30e · errors=[] |
| דפדפן (desktop 1280 / mobile 390 / 360) | ✅ כרטיס "הוכחת חיים" מוצג · אפס overflow · אפס שגיאות קונסול · RTL תקין |
| `bun run backup` | ✅ טרי ומאומת (integrity ok, counts-match) |

### §28 live-proof — 11 הבדיקות חוזה חדשות

structure(18-field contract) · service∈{ok,degraded,down} · **אפס דפוסי-סוד ב-payload כולו** · 6 רשתות עם probe objects · not-configured = מצב (probe source≠env) · לכל probe reason כנה (בטוח ללא-אינטרנט) · רשתות חסומות מציגות blocker · **safety בדיק-מכונה: אין שידור/עסקה/חתימה/ארנק** · proofRoot/proofHeight תואמי חותמה · rate-limit rule פעיל · decisions view ללא סגירות-פיקטיביות.

### לקחי Task 13 (bugs/fixes in-flight)

1. **api-check מודע-מצב (BUG-010)**: ב-live, `POST /seal` (בעיצוב מ-Task 5) דורש הפעלה מאומתת — הסוויטה היבשה נכשלה 7 בדיקות. תיקון: §1b מקים session מפעיל כשמצב=live ו-key זמין; ה-cookie בלבד עובר בין בדיקות, המפתח לעולם לא נדפס.
2. **concurrency-check מודע-מצב**: אותו עקרון + Retry-After לחלון-auth שנוצל ע"י ה-burst של api-check (המתנה מבוקרת ≤70s, ניסיון-חוזה אחד).
3. **node לא טוען `.env`** (בשונה מ-bun): `verify` הוסב ל-`bun scripts/concurrency-check.mjs` — אחרת `SAOS_ADMIN_KEY` לא היה קיים לסקריפט.
4. **הסוויטה לא תיצור חוסם-פיקטיבי**: דריל §18/§19 (decisions) מסיים עם שחזור `github-actions-ci` למצבו האמתי (`decided-custom`) במקום "open" — alignment בין בדיקות למצב.
5. **preflight פריטי-אבטחה דינמיים**: הטענה השקרית "GitHub Actions CI לא קיים" (מ-Task 11!) הוסרה; SH-7 מוצג רק כשהקובץ באמת בעץ — ה-docs וה-קוד מסונכרני-אמת.

### מה עדיין לא מכוסה (כנות)

- probe-קריאה חי ל-BLURT לא עובר מהסנדבוקס (egress) — העמדת ה-fail-honest נבדקה, החיבור עצמו לא.
- לא נבדק שידור/חתימה אמתית — **במכוון ובאיסור**; המסלול היבש בלבד (SignRequest → payload/digest → רישום/ביטול).
- CI רץ על dry-run; מצב live לא מדומה ב-CI (נבדק מקומית בלבד — מתועד כאן).
