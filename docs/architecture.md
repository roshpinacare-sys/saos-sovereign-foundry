# ארכיטקטורה — SAOS Sovereign Foundry v2

עודכן: 2026-09-07

## 1. מטרת המערכת

SAOS היא רשת-גשר לכל מטבעות הקריפטו: העברה חופשית בין-רשתות, ואילוץ עבודה אמיתית ברשתות מרוחקות (STEEM/BLURT/HIVE/TRON) מתוך חוזים חכמים ברשת החופשית שלנו. העיקרון הריבוני: כל מגבלה של רשת חיצונית נפתרת ברשת שלנו, לא בתלות בה.

הפלטפורמה הזו (v2) היא המגדל המבצעי של הרעיון:

1. **קרנל דטרמיניסטי** — מכונת מדינה שקובעת stateRoot ניתן-לשחזור מלא מתוך לוג פעולות.
2. **עגינה ציבורית** — שורשי מרקל של באצ'ים נכרכים לרשתות ציבוריות, שם כל אחד יכול לאמת.
3. **ריבונות אנרגיה** — מתמטיקת TRX (stake/delegate/burn) למימון עגינת TRON ישירה, ומתמטיקת Hive RC להתאוששות מסומנת.
4. **כלכלת גלגל-חור** — רווח (עמלות בריכות, מיקרו-טיק, מסילה נכנסת, THE-DOOR) ממוחזר לאנרגיה שקונה יכולת עגינה נוספת.
5. **שכבת ראיות** — כל פעולה מחוללת קבלה משורשרת-האש (hash chain) עם גבול-אמת מוצהר.

## 2. רכיבים מרכזיים

### 2.1 ספריית הליבה `src/lib/saos/`

| מודול | מה הוא עושה | פורט מ- |
|---|---|---|
| `canonical-json.ts` | סריאליזציה קנונית: מיון מפתחות, שלמים בלבד, דחייה fail-closed של float/inf/NaN, מחזוריות, symbol/function. `sha256Hex` דרך WebCrypto. | unified-platform `src/contracts/crypto.ts` + דיסציפלינת steem-main |
| `kernel.ts` | מכונת מדינה דטרמיניסטית: `GAS_TABLE` מוקפאת (stamp 20 / seal 60 / harvest 20 / relay 0 / relay_ack 0 / wallet 40), dedupe קשיח על `issuer:nonce`, שמירת ערך בכל wallet, `stateRootOf` = sha256(canonical(state)), `replay`, selftest של 7 וקטורי-תכונה. | steem-main `sovereign/core/kernel.cjs` |
| `merkle.ts` | עץ מרקל (עלה אי-זוגי → שכפול), `merkleProof`, `verifyMerkleProof` — אימות כלול-בלי-אמון. | zip2pdf `src/merkle.ts`, workspace-TFA transparency-log |
| `evidence.ts` | קבלות משורשרות-האש: `forgeReceipt`, `verifyChain` (לינארי קפדני) + `verifyChainDag` (סובלני-פיצולים: כל prevDigest חייב להיות digest של קבלה קודמת; פיצולים מדווחים, לעולם לא נכתבים מחדש). | qodo `services/receipt.ts`, V33.30 |
| `receipt-store.ts` | **כתיבה אטומית**: `appendReceipt`/`appendReceiptTx` (קבלה בתוך טרנזקציה מסודרת — בלי פיצולי-שרשרת), `withWriteLock` (mutex בתהליך — סידור כותבים על SQLite), `retryWrite` (backoff מעריכי על P2002 + תקלות-נעילה חולפות P2024/P2028/SQLITE_BUSY), `persistenceAllowed` (מודע-מצב). | חדש Task 4 |
| `modes.ts` | מצבי פעולה dry-run/safe/live/maintenance; live דורש אישור-כפול (`SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES`); `assertWritesEnabled` fail-closed. | חדש Task 4 |
| `network-status.ts` | תצוגת-מצב לכל רשת חוץ: status/mode/lastVerifiedAnchor/nextAction/blocker/requiredResource/unblockPlan + מ-Task 12: chainType/chainId/anchorTypes/rpcStatus — חישוב בלבד, אפס קריאות חיות. | חדש Task 4 |
| `networks/` (Task 12) | מודולי-רשת יבשים keyless: `ethereum.ts` + `solana.ts` (סטטוס + probe קריאה-בלבד opt-in + מועמד-RPC לאימות-txid; safeRpcUrl דוחה credentials/מפתח-בשאילתה) + `types.ts`. `not-configured` = מצב, לא שגיאה. | חדש Task 12 |
| `anchor-gates.ts` | שערי עגינה כנים: מטריצת STEEM/BLURT/HIVE/TRON לפי `rcPct` ו-`tronEnergy`; מתמטיקת התאוששות Hive (רגן 20%/יום, ספי 8%/12%); חוק עמלת BLURT `0.05 + 0.2 × KB`, cooldown 30 דק'. | steem-main `agent/hive_rc.cjs`, `blurt_health.json` |
| `tron-energize.ts` | **החתיכה שחסרה בכל 10 הארכיונים**: תוכנית `freezeBalanceV2` + `delegateResource` + יישוב; פרמטרים: 420 sun/energy שריפה, ~64,895 אנרגיה להעברת USDT, 10 אנרגיה/יום ל-TRX מוהמר, נעילת 14 יום; break-even; `minStakeForSettlements`. | חדש (חוסר מתועד ב-worklog של הארכיון, Task 113/114) |
| `economy.ts` | סימולטור גלגל-החור: 4 זרמי הכנסה, אחוז מיחזור, תקציב TRX (60% מהמיחזור) → יישובים נתמכים. | steem-main `harvest.cjs`, `grid98.cjs` |
| `findings.ts` | פסק-הדין על 10 הארכיונים (דירוג 1–10, ציון 51–97) + `SYNTHESIS`. | מפגש מחקר מעמיק (worklog Task 1) |
| `historic.ts` | הרפרנסים הציבוריים ההיסטוריים — חלקיים במכוון (ממוסכים), עם מקור מפורש. | דוח הרשת הקודמת |

### 2.2 שכבת API `src/app/api/saos/`

9 routes — כולם `dynamic = "force-dynamic"`, כולם מחזירים HTTP 200 גם בשגיאה (שגיאה היא נתון). פירוט מלא ב-[api.md](./api.md).

### 2.3 סקריפטים תפעוליים `scripts/`

| סקריפט | תפקיד |
|---|---|
| `api-check.mjs` | `bun run test` — 26 בדיקות חוזה על כל ה-endpoints (כולל fail-closed) |
| `concurrency-check.mjs` | `bun run verify` — 8 פעימות מקבילות + בדיקות אינבריאנטות שלמות |
| `backfill-receipt-at.ts` | שחזור חד-פעמי, מוכח-דיג'סט, של זמן-החיתום לקבלות היסטוריות |

### 2.4 שכבת נתונים

- `src/lib/db.ts` — Prisma singleton (לוג warn/error, מופע גלובלי ב-dev).
- `prisma/schema.prisma` — 8 מודלים על SQLite. פירוט ב-[database.md](./database.md).

### 2.5 ממשק `src/app/page.tsx` + `src/components/ui/kit.tsx`

- מגדל-פיקוח RTL בעברית, 5 לשוניות: מגדל-פיקוח (tower) / אנרגיה (energy) / כלכלה (economy) / הוכחות (proofs) / פורץ דרך (verdict).
- ערכת רכיבים פנימית: Card, Badge, Button, Progress, Slider, Stat.
- ערכת נושא ריבונית כהה (zinc-950), amber/emerald/rose — אין כחול/אינדיגו.
- Footer דביק: `mt-auto` + `env(safe-area-inset-bottom)`.

## 3. תרשים זרימה — פעימת עגינה (`POST /api/saos/seal`)

```
UI (לשונית מגדל-פיקוח, כפתור פעימה)
        │  POST {stamps:3..24, memo?}
        ▼
/api/saos/seal ── 1. בניית באצ' קרנל
        │            stamps × N + harvest(42) + relay(steem:headcorner) + seal
        ▼
   2. replay דטרמיניסטי (applyTx × N) ──► stateRoot = sha256(canonical(state))
        ▼
   3. buildMerkleTree(digest(tx) לכל פעולה) ──► root
        ▼
   4. persist: SealRecord (height = max(DB)+1, יחודי)
        │         + SealLeaf × N   + AnchorTx × 4 (סטטוסים כנים)
        ▼
   5. forgeReceipt("seal", ..., prevDigest=אחרונה) ──► EvidenceReceipt
        ▼
   6. OpLog("seal", detail)
        ▼
   תשובה: {ok, seal{height,root,stateRoot,leaves,gasUsed}, anchors[], receipt}
```

סטטוסי AnchorTx בסנדבוקס (advisory, ללא מפתחות):

| רשת | סטטוס | סיבה בקוד |
|---|---|---|
| STEEM | pending | הפעימה מתועדת, מוכנה לשידור כשהכספת חוזרת |
| BLURT | pending | כנ"ל |
| HIVE | gated | rc-floor (מ-env `HIVE_RC_PCT`, ברירת-מחדל 0.6%) |
| TRON | transit | energy-0 (מ-env `TRON_ENERGY`, ברירת-מחדל 0) |

זרימת אימות ציבורי (`GET /api/saos/verify-pack`): שליפת החותם האחרון → בניית העץ מחדש מהעלים ב-DB → השוואת root (`rootMatches`) → הוכחת כלילות + אימות עצמאי לכל עלה (`allVerified`) → `sampleProof` + הוראות אימות ידני.

## 4. תלויות

### זמן-ריצה

| חבילה | גרסה | שימוש |
|---|---|---|
| next | 16.1.1 | פריימוורק (App Router, Turbopack) |
| react / react-dom | ^19.2.0 | UI |
| @prisma/client + prisma | ^6.16.2 | ORM מול SQLite |
| lucide-react | ^0.545.0 | אייקונים |
| clsx + tailwind-merge + class-variance-authority | — | רכיבי kit |
| tailwindcss ^4 + @tailwindcss/postcss | — | עיצוב |
| typescript ^5.9.2, eslint ^9 + eslint-config-next 16.1.1 | — | איכות קוד |

### זמן-ריצה חיצוני

- **Node ≥ 20 / Bun** להרצה; **crypto.subtle** (WebCrypto) ל-sha256 — זמין ב-runtime של Next.
- **SQLite** קובץ יחיד: `db/custom.db` (נתיב מ-`DATABASE_URL`).
- **אין** תלות ברשת חיצונית בזמן-ריצה כרגע: אין קריאות ל-nodes של STEEM/HIVE/TRON בקוד v2 (רק מתמטיקה ושערים פרמטריים).

## 5. נקודות כשל

| # | נקודה | אפקט | התמודדות נוכחית | סטטוס |
|---|---|---|---|---|
| F1 | **מירוץ בין שני POST /seal במקביל** | השני נכשל ב-unique constraint | **סגור Task 4**: טרנזקציה אחת (max(height) + כל הכתיבות) מאחורי `withWriteLock` + `retryWrite` + idempotency (batchId). מוכח: 8/8 פעימות מקבילות, heights רציפים ללא כפילויות | ✅ סגור |
| F2 | **hash-chain של קבלות** — `prevDigest` = הקבלה האחרונה | כתיבה כמעט-מקבילה יוצרת ענפים | **סגור Task 4**: קבלה נכתבת בתוך טרנזקציית ה-seal המסודרת; פיצול היסטורי אמיתי (אינדקס 17) נמצא ומדווח ע"י `verifyChainDag` במקום לשכתבו | ✅ סגור |
| F3 | **unique(digest) על EvidenceReceipt** — ריצה חוזרת זהה לחלוטין | הכנסה נכשלת | מתוכנן: try/catch שמקבל התנגשות וממשיך (השרשרת נשארת) | מטופל |
| F4 | **קלט float/NaN** — למשל `?rc=abc` | `canonicalize` זורק → `ok:false` עם הודעת קנוניה (טכנית נכונה, לא ידידותית) | fail-closed מכוון | מוכר; הודעת-משתמש נקייה דורשת ולידציה מפורשת |
| F5 | **SQLite קובץ-יחיד** | אין בטיחות ריבוי-מופעים; תלות בדיסק | מוגבל לסנדבוקס; גיבוי = העתקת קובץ | מוכר |
| F6 | **HIVE_RC_PCT / TRON_ENERGY מ-env** — לא שאילתה חיה מהרשתות | מצב המטריצה יכול להיות מיושן | ברירות-מחדל 0.6/0 משקפות את המצב המדוד האחרון | מוכר — שלב 2/3 יחליף בקריאה חיה |
| F7 | **רפרנסים היסטוריים חלקיים** (txid ממוסך) | לא ניתן לאמת מלא מקוד v2 בלבד | `historic.ts` מצהיר על provenance חלקי | מודע ומתועד |
| F8 | **אין מפתחות חתימה בסנדבוקס** | שידור אמיתי בלתי-אפשרי מכאן | `advisory-mode` מוצהר בכל תשובת seal | מכוון |
| F9 | תהליך מת בזמן כתיבה | — | טרנזקציה מתגלגלת — אין מצב-ביניים; החותם והקבלה נכתבים יחד או לא נכתבים | מטופל מבנית |
| F10 | rate-limit אינו משותף בין תהליכים | in-memory לתהליך יחיד; איפוס ב-restart | מקובל בשלב זה; פריסה אופקית דורשת limiter משותף |

## 6. מנגנוני אימות (verification)

1. **Selftest של הקרנל** — 7 בדיקות תכונה (`GET /api/saos/kernel`): דטרמיניזם, טבלת-GAS, dedupe קשיח, שמירת-ערך, fail-closed, רגישות-סדר, שער אפס-גז. כל ריצה משורשרת בקבלה.
2. **Verify-pack** — בנייה מחדש של עץ המרקל מתוך ה-DB בלבד ואימות כלול-עצמאי לכל עלה; אם `root` ב-DB והעץ המשוחזר חורגים — `rootMatches:false` ייחשף.
3. **Replay עצמאי** — `replay(txs)` מ-genesis מניב stateRoot זהה; זהו הפרימיטיב לאימות צד-שלישי.
4. **שרשרת קבלות** — `GET /api/saos/verify-chain` מחשב מחדש כל digest ומאמת קישוריות (סובלני-פיצולים עם דיווח `forks`); פלט כולל verifiedLeaves/invalidLeaves/proofResult/errors.
5. **Agent-browser** — בדיקת זהב אנד-טו-אנד (desktop+mobile) שבוצעה ומתועדת ב-testing.md; כולל לחיצת פעימה חיה מה-UI.

## 7. מנגנוני אבטחה

- **סודות**: אין סודות בקוד. טוקן GitHub חי ב-`upload/` (gitignored) ונעשה בו שימוש חולפת בלבד; remotes נוקו מטוקנים. `.env*` מנוטרל ב-.gitignore (ר' security.md).
- **אימות**: אין עדיין שכבת auth ל-API — הסנדבוקס חשוף לרשת הגייטוויי בלבד; כל פעולת כתיבה (seal) היא בלתי-הורסת (הוספת חותם), ללא מפתחות, ללא כסף. פירוט ומגבלות ב-security.md.
- **שלמות**: canonical JSON + sha256 + merkle + hash-chain (ה' לעיל).
- **Fail-closed**: קרנל זורק על קלט בלתי-חוקי; אין דרדור שקט.
- **גבול אמת**: `productionAuthority: "NONE"` עד עגינה ציבורית — מוצהר בקוד, לא בפרוזה.

## 8. מצבי עבודה (מומש בקוד — `src/lib/saos/modes.ts`)

| מצב | מה רץ | מה נחסם | כניסה |
|---|---|---|---|
| **dry-run (ברירת-מחדל)** | חישוב מלא + כתיבה (חותמים/קבלות/יישויות) + עגינה advisory | שידור חיצוני (בלתי-אפשרי — אין כספת) | ללא env |
| **safe** | קריאה וחישוב בלבד | כל כתיבה: seal מוחזר `ok:false "mode-refusal"`; קבלות מחושבות ולא נשמרות (`persisted:false`) | `SAOS_MODE=safe` |
| **live** | כמו dry-run + דגל liveArmed | שידור עדיין בלתי-אפשרי (`broadcastCapable:false` — אין כספת) | `SAOS_MODE=live` **וגם** `SAOS_LIVE_CONFIRM=YES`; חסר אחד → נפילה ל-dry-run עם הודעה |
| **maintenance** | כמו safe + פעולות db:push/גיבוי | כל כתיבה נדחית | `SAOS_MODE=maintenance` |

המצב ניתן לצפייה ב-`/status` (mode, modeDetail, writesEnabled, broadcastCapable) ובתג בפוטר ה-UI. נבדק אנד-טו-אנד: safe → סירוב כתיבה; live ללא אישור → dry-run; live עם אישור → mode:live + broadcast:false. מצב לא-מוכר נופל ל-dry-run.
## שכבת האבטחה (Task 5)

```
בקשה ──▶ rate-limit (רך: 429 per-IP per-route, 60s window) ──▶ [נתיב רגיש?]
                                                              │
   ┌──────────────────────────────────────────────────────────┘
   ▼
auth: cookie חתום (HMAC, HttpOnly, 12h) או Bearer → השוואת sha256 בזמן-קבוע
   │ fail-closed: SAOS_ADMIN_KEY_HASH חסר ⇒ 403 לכל פעולה רגישה
   ▼
AuditEvent (כל ניסיון: allowed/denied, בלי חומר-מפתח)
   ▼
הפעולה עצמה (mode-gate עדיין רץ: safe/maintenance דוחים כתיבה)
```

מודולים: `src/lib/saos/auth.ts` (hash בלבד, session signing, audit) · `rate-limit.ts` (in-memory fixed window) · `signer.ts` (SignRequest/SignResponse, registry, אפס מפתחות) · routes: `/auth`, `/live-gate`, `/signer`, `/audit`.

זרימת חתימה keyless: seal (k) ──▶ POST /signer (יצירת SignRequest: payload+digestToSign) ──▶ חתימה מחוץ למערכת ──▶ PATCH /signer (txid ציבורי בלבד, בלתי-הפיך).

הערה: 401/403/429 מותרים **רק** לשכבת האבטחה — שאר ה-API ממשיך בכלל "שגיאה כנתון HTTP 200".


---

## שכבת ה-UI — מרכז שליטה מבצעי (Task 10)

**מקום בארכיטקטורה**: `src/app/page.tsx` (server shell) ← `src/components/saos/*` (client). ה-UI הוא **צרכן-קריאה בלבד** של ה-API: אין לו גישה ישירה ל-DB, אין server actions, וכל mutation עובר דרך הנתיבים המאובטחים הקיימים (auth → audit → rate-limit).

**תלות ב-API** (מיפוי מלא ב-docs/ui.md §2): status · anchor-preflight · verify-chain · signer · plans · audit · live-gate · kernel · seal (POST) · auth · research · repo-status · decisions. ה-UI מטופל בחוזה "שגיאה-היא-נתון" (HTTP 200 ok:false) + שלושת קודי האבטחה (401/403/429) — מסווגים למצבי מסך.

**ניהול מצב**: ללא ספריות מצב. חנות חיצונית מינימלית (`useSyncExternalStore`, ~60 שורות): cache per-key לכל הסשן, טעינה עצלה לכל טאב, רענון ידני בלבד (אפס polling), invalidation ממוקד אחרי mutations. ה-shell הוא Server Component; כל הנתונים נטענים client-side — אפס סיכון hydration.

**כללי-ברזל של השכבה**: אפס נתונים מומצאים · מקור+זמן-בדיקה לכל פאנל · מצבי loading/error/empty/חסום/לא-מאומת בכל נתיב · הפרדה ויזואלית בין dry-run/סימולציה/אימות/עוגן-אמיתי · RTL מלא · אפס גלילה אופקית (נמדד). פירוט מלא: **docs/ui.md**.
