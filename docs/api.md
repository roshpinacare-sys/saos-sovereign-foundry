# API — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 5) · כל הנתיבים תחת `/api/saos/*` · 13 endpoints · כולם `dynamic = "force-dynamic"`.

## כלל על

**API לעולם לא מחזיר 500.** כל שגיאה מוחזרת כנתון:

```json
{ "ok": false, "error": "<message>" }
```

— עם **HTTP 200**. לכן זיהוי כשל נעשה על `ok`, לא על קוד HTTP.

**תיקון Task 5 — יוצאי-מכחול לשכבת האבטחה בלבד:**

| קוד | מתי | body |
|---|---|---|
| `401` | פעולה רגישה בלי הרשאה/עם הרשאה פגה | `{ok:false, error:"auth-required…"}` |
| `403` | auth לא מוגדר על השרת (fail-closed) | `{ok:false, error:"auth-unconfigured…"}` |
| `429` | מעבר להגבלת-הקצב | `{ok:false, error:"rate-limited…", retryAfterSec}` + header `Retry-After` |

בכל המקרים body נשאר JSON קריא — השגיאה היא נתון גם כאן.

**הגבלת קצב (Task 5)** — חלון של דקה, per-IP per-route, בזיכרון:
`status 120` · `seal 30` · `verify-chain 60` · `kernel/verify-pack/energy/economy 30` · `plans 60` · `auth 8` · `live-gate 30` · `signer 30` · `audit 30` — אחלפי `SAOS_RL_<ROUTE>_PER_MIN`.

**פעולות רגישות (401/403 בלי הרשאה):** `POST /signer` · `PATCH /signer` · `POST /live-gate` · `GET /audit` · `POST /seal` כשהמצב live.

מוסכמת קלט: פרמטרים מספריים שאינם מספר (למשל `rc=abc`) מתנהגים לפי fail-closed — הקנוניה דוחה NaN/float והנתיב מחזיר `ok:false` (ר' שגיאות נפוצות בסוף).

---

## 1. `GET /api/saos/status`

**מה**: מצב העגינה המלא — מטריצת 4 הרשתות, רפרנסים היסטוריים, 8 החותמים האחרונים עם העוגנים שלהם, 10 הקבלות האחרונות, מונה OpLog.

**קלט**: ללא. משתני-סביבה `HIVE_RC_PCT` (ברירת-מחדל 0.6), `TRON_ENERGY` (ברירת-מחדל 0) מזינים את המטריצה.

**פלט** (קטעים רלוונטיים):
```json
{
  "ok": true,
  "motto": "אנחנו מנצחים את הבלוקצ'יין",
  "matrix": [ { "network": "STEEM", "status": "anchored", "gate": null, "detail": "...", "recovery": null },
              { "network": "HIVE", "status": "gated", "gate": "rc-floor(0.6%<8%)", "detail": "...", "recovery": "..." } ],
  "historic": [ { "network": "STEEM", "txRef": "3452e62bc3bf5b…dee9ee1003", "state": "anchored", "note": "..." } ],
  "seals":   [ { "id": "...", "height": 3, "root": "7e3b…", "stateRoot": "459c…", "leaves": 8, "gasUsed": 180,
                 "createdAt": "...", "anchors": [ { "network": "STEEM", "status": "pending", "txid": null, "gate": "..." } ] } ],
  "receipts": [ { "kind": "seal", "digest": "...", "prevDigest": "...", "at": "..." } ],
  "opsLogged": 3
}
```

**שגיאות אפשריות**: כישלון DB → `{ok:false, error}` (HTTP 200).

**סטטוס**: ✅ עובד — נבדק חי 2026-09-07 (HTTP 200, מטריצה תקינה).

---

## 2. `GET /api/saos/kernel`

**מה**: selftest הקרנל — 7 בדיקות תכונה, כל ריצה נחתמת בקבלה (התנגשות digest בריצה חוזרת זהה נסבלת בכוונה ולא שוברת את השרשרת).

**קלט**: ללא.

**פלט**:
```json
{
  "ok": true,
  "result": {
    "ok": true,
    "stateRoot": "4d714729…",
    "gasUsed": 160,
    "checks": [
      { "name": "determinism",        "pass": true, "detail": "root 4d71… stable across runs" },
      { "name": "gas-table",          "pass": true, "detail": "160 == 160" },
      { "name": "hard-dedupe",        "pass": true, "detail": "replayed nonce rejected" },
      { "name": "value-preservation", "pass": true, "detail": "supply 1000500 == 1000500" },
      { "name": "fail-closed",        "pass": true, "detail": "insufficient balance rejected" },
      { "name": "order-sensitivity",  "pass": true, "detail": "reordered ops yield different stateRoot" },
      { "name": "the-door",           "pass": true, "detail": "relay/relay_ack = 0 gas — sponsored real work" }
    ]
  },
  "receipt": "<digest>"
}
```

**שגיאות אפשריות**: `selftest failed` (מעטפת), שגיאת DB על כתיבת קבלה — נסבלת.

**סטטוס**: ✅ עובד — נבדק חי 2026-09-07: 7/7 pass.

---

## 3. `POST /api/saos/seal`

**מה**: פעימת עגינה אטומית — mode-gate → בניית באצ' קרנל (nonces נזרעים מ-batchId) → replay → stateRoot → מרקל → **טרנזקציה אחת מאחורי write-lock** (SealRecord+leaves+AnchorTx×4+קבלה+OpLog) → retry על התנגשויות.

**קלט** (JSON body, כולו אופציונלי):
| שדה | טיפוס | ברירת-מחדל | משמעות |
|---|---|---|---|
| `stamps` | number | 6 | 3..24 (מחוץ לטווח נחתך) |
| `memo` | string | "פעימת עגינה מהמגדל" | note |
| `batchId` | string (≤64, `[\w.-]`) | randomUUID | **מפתח-idempotency**: אותו batchId+stamps ⇒ אותו root; שליחה חוזרת מחזירה את החותם הקיים (`idempotent:true`), לא יוצרת כפילות |

באצ' קבוע מעל ה-stamps: `harvest` (grid-98, 42 SAOS) + `relay` (→ steem:headcorner) + `seal`.

**פלט**:
```json
{
  "ok": true,
  "idempotent": false,
  "batchId": "…",
  "mode": "dry-run",
  "seal": { "id": "…", "height": 4, "root": "6c79…", "stateRoot": "db56…", "leaves": 8, "gasUsed": 180 },
  "anchors": [ { "network": "STEEM", "status": "pending", "gate": "advisory-mode: …" }, "…×4" ],
  "receipt": "3a0a…"
}
```

**שגיאות אפשריות**:
- `mode-refusal: כתיבה אסורה במצב safe|maintenance` — דחיית מצב (fail-closed, HTTP 200).
- `seal requires stamps in batch` — קלט stamps לא-מספרי.
- התנגשויות height/root מטופלות פנימית (retryWrite) — לא נחשפות למשתמש.

**סטטוס**: ✅ עובד — נבדק חי (Task 4): idempotency 2×אותו-root; 8/8 פעימות מקבילות דרך concurrency-check; קלט שגוי `stamps=abc` → `{ok:false}` (HTTP 200).

---

## 4. `GET /api/saos/verify-pack`

**מה**: משטח ההוכחה הציבורי — החותם האחרון → בניית עץ מחדש מהעלים ב-DB → `rootMatches` → הוכחה+אימות עצמאי לכל עלה → `sampleProof` + הוראות אימות ידני.

**קלט**: ללא.

**פלט**:
```json
{
  "ok": true,
  "seal": { "height": 3, "root": "7e3b…", "stateRoot": "459c…", "createdAt": "…" },
  "tree": { "leaves": 8, "levels": 4, "root": "7e3b…" },
  "rootMatches": true,
  "allVerified": true,
  "proofs": [ { "index": 0, "leaf": "bf85e5d45552a00ab64a…", "verified": true } ],
  "sampleProof": { "index": 0, "leaf": "…", "root": "…", "path": [ { "sibling": "…", "dir": "R" } ] },
  "receipt": "<digest>",
  "howToVerify": ["קח את sampleProof.path", "hash = leaf; …", "השווה ל-root — …"]
}
```

**שגיאות אפשריות**: אין חותמים → `{ok:true, empty:true, message}` (לא שגיאה).

**סטטוס**: ✅ עובד — נבדק חי 2026-09-07: `rootMatches:true, allVerified:true` על 8 עלים.

---

## 5. `GET /api/saos/energy`

**מה**: מחשבוני ריבונות אנרגיה — TRON energize (ברירת-מחדל) או Hive RC recovery; **כל קריאה משמרת שורת EnergyPlan** (`planId` בתשובה) ומשורשרת בקבלה.

**קלט** (query):
| פרמטר | רשת | ברירת-מחדל | משמעות |
|---|---|---|---|
| `net` | שניהם | `tron` | `tron` \| `hive` |
| `trx` | TRON | 6500 | TRX להימור |
| `txs` | TRON | 4 | יישובי USDT רצויים ליום |
| `price` | TRON | — | מחיר TRX ב-USD (אופציונלי, לדיווח) |
| `rc` | HIVE | 0.6 | אחוז RC נוכחי |

**פלט TRON** (קטעים): `params {sunPerTrx:1000000, burnSunPerEnergy:420, usdtTransferEnergy:64895, energyPerTrxPerDay:10}`, `minStakeForSettlements`, `plan {trxStaked, dailyEnergy, settlementsPerDay, uncoveredPerDay, burnCostPerTxTrx:27.26, breakEvenTxs:239, txPlan[4] (freezeBalanceV2 → delegateResource → TriggerSmartContract → unfreeze+withdraw), verdict}`.

דוגמה חיה (`?net=tron&trx=6500&txs=4`): dailyEnergy 65,000 → 1 יישוב/יום מכוסה, 3 לא-מכוסים; שריפה 27.26 TRX/tx; break-even 239 txs; מימון מינימלי ל-4 יישובים = 25,958 TRX.

**פלט HIVE** (קטעים): `params {regenPctPerDay:20, lightFloor:8, heavyFloor:12}`, `plan {currentPct, lightFloorHours:8.9, heavyFloorHours:13.7, verdict, path[4] (regen → 8% → 12% → power-up/delegate)}`.

**שגיאות אפשריות**: `float/inf rejected — integers only` על קלט לא-מספרי (למשל `rc=abc`) — fail-closed דרך הקנוניה.

**סטטוס**: ✅ עובד — נבדק חי 2026-09-07 לשתי הרשתות + קלט שגוי → `{ok:false}` HTTP 200.

---

## 6. `GET /api/saos/economy`

**מה**: סימולטור גלגל-החור — 4 זרמי הכנסה, סה"כ/יום, מיחזור לאנרגיה (60% מהמיחזור → TRX → יישובים); **כל קריאה משמרת שורת EconomySnapshot** (`snapshotId` בתשובה) ומשורשרת בקבלה.

**קלט** (query, כל הפרמטרים אופציונליים עם ברירות-מחדל): `pool` (50,000 מחזור יומי), `fee` (0.3%), `rounds` (1,800 סבבי מיקרו-טיק), `profit` (0.4 לסבב), `rail` (3,000 STEEM נכנס), `rate` (1000 — 0.001 STEEM = 1 SAOS), `door` (250 קריאות THE-DOOR), `doorFee` (2), `fly` (30% מיחזור).

**פלט** (קטעים):
```json
{
  "ok": true,
  "input": { "…": "…כפי שהתקבל" },
  "result": {
    "streams": [ { "name": "pool-fees", "amount": 150, "note": "0.3% על מחזור 50,000" },
                 { "name": "grid-fees", "…": "…" }, { "name": "inbound-rail", "…": "…" }, { "name": "door-fees", "…": "…" } ],
    "totalPerDay": 152.5, "reinvestedPerDay": 61.0, "retainedPerDay": 91.5,
    "energyFunded": { "trx": 36, "settlements": 0 },
    "verdict": "גלגל-החור: 40% מהרווח חוזר לריבונות …"
  },
  "receipt": "<digest>"
}
```
הערה קנונית: הקבלה מקודדת כסף כ-micro-units (×100) — שלמים בלבד.

**שגיאות אפשריות**: `economy failed` במעטפת; קלט לא-מספרי מוחזר לברירת-מחדל (לא נכשל).

**סטטוס**: ✅ עובד — נבדק חי 2026-09-07 (`?fly=40`).

---

## 7. `GET /api/saos/research`

**מה**: פסק-הדין על 10 הארכיונים + ההחלטה המסונתזת; מראה (idempotent upsert) של הפסק ל-DB לצורך ביקורת.

**קלט**: ללא.

**פלט**: `{ok, findings[10] {archive, rank, score, verdict, salvage[], evidence[]}, synthesis {chosen, why[], roadmap[]}}`.

**שגיאות אפשריות**: כישלון DB → `{ok:false, error}` (HTTP 200).

**סטטוס**: ✅ עובד — נבדק חי 2026-09-07; 10 רשומות ב-DB (ResearchFinding=10).

---

## שגיאות נפוצות לכל הנתיבים

| הודעה | מקור | פירוש | פעולה |
|---|---|---|---|
| `mode-refusal: כתיבה אסורה במצב …` | modes | כתיבה נדחית ב-safe/maintenance | הגדר `SAOS_MODE=dry-run` (או live+confirm) |
| `float/inf rejected — integers only` | canonicalize | קלט לא-מספרי/NaN הגיע לקנוניה (F4) | תקן את הפרמטר |
| `seal requires stamps in batch` | קרנל | קלט stamps לא-מספרי → 0 | שלח מספר 3..24 |
| `seal not found for the given selector` | verify-chain | height/root לא קיים | בדוק קלט מול /status |
| `index out of batch — leafCount=N` | verify-chain | index מחוץ לטווח העלים | 0..N-1 |
| `auth-required: …` | auth | פעולה רגישה בלי cookie/Bearer תקף (401) | `POST /auth` או Bearer key |
| `auth-unconfigured: …` | auth | `SAOS_ADMIN_KEY_HASH` חסר על השרת (403) | הגדר את ה-hash (deployment.md §3) |
| `auth-denied: מפתח שגוי` | auth | מפתח התחברות שגוי (401) | בדוק את המפתח מול מי שיצר את ה-hash |
| `rate-limited` | rate-limit | מעבר על המגבלה (429) | המתן `retryAfterSec` |
| `txid already recorded — רישום הוא בלתי-הפיך` | signer | ניסיון לשכתב תוצאה רשומה | אין — רישום הוא היסטוריה |
| `status failed` / `seal failed` / כו' | מעטפת | כישלון לא-צפוי (לרוב DB) | בדוק לוג dev, ר' runbook.md |

## מה עוד לא מושלם ב-API

1. `stamps` מחוץ ל-3..24 נחתך בשקט (מכוון, אך לא מדווח בתשובה).
2. אין פגינציה ב-status וב-plans (מקובע: 8 seals / 10 receipts / 10+10).
3. GET ל-energy/economy כותב שורת-מודל בכל קריאה — יש מדיניות רטנשן (database.md §retention) אך לא ניקוי אוטומטי.
4. `idempotency` מבוססת root: אותו batchId עם `stamps` שונה = root אחר = חותם חדש (מתועד, מכוון).
5. rate-limit אינו משותף בין תהליכים (in-memory) — לפריסה אופקית דרוש limiter חיצוני.

---

## 8. `GET /api/saos/verify-chain` (חדש Task 4)

**מה**: משטח האימות העצמאי המלא — בדיקת שרשרת-הקבלות + בנייה מחדש ואימות של כל חותם/עלה. כל ריצה משורשרת בקבלה משלה (kind=`verify-chain`); הריצה מאמתת את השרשרת כפי שהייתה **לפני** הקבלה של עצמה.

**קלט** (query):
| פרמטר | ברירת-מחדל | משמעות |
|---|---|---|
| `scope` | `chain` | `chain` (הכול) \| `seal` (חותם אחד) \| `leaf` (עלה בודד) |
| `height` | — | בחירת חותם לפי גובה (scope seal/leaf) |
| `root` | — | בחירת חותם לפי root (64 hex) |
| `index` | — | מספר העלה (scope=leaf בלבד) |

**פלט scope=chain**:
```json
{
  "ok": true,
  "scope": "chain",
  "receiptChain": { "ok": true, "checked": 41, "digestErrors": [], "linkErrors": [], "forks": [17] },
  "seals": [ { "height": 1, "root": "…", "leafCount": 8, "rootMatches": true, "verifiedLeaves": 8, "invalidLeaves": 0, "proofResult": "all-verified" } ],
  "totals": { "sealsChecked": 25, "leafCount": 180, "verifiedLeaves": 180, "invalidLeaves": 0 },
  "proofResult": "all-verified",
  "root": "…", "height": 25, "leafCount": 180, "verifiedLeaves": 180, "invalidLeaves": 0,
  "errors": [],
  "receipt": "…", "persisted": true
}
```

**פלט scope=seal**: `ok, height, root, stateRoot, leafCount, rootMatches, verifiedLeaves, invalidLeaves, proofResult, proofs[], sampleProof, errors, receipt`.
**פלט scope=leaf**: `ok, verified, height, root, leafCount, index, proof{leaf,root,path}, proofResult, verifiedLeaves, invalidLeaves, errors, receipt`.

**משמעות `forks`**: אינדקסי קבלות היסטוריות ש-chain-ו על קבלה שאינה הקודמת המיידית (ענפים מהתקופה שלפני הכתיבה האטומית) — **מדווחים, לעולם לא נשכתבים**. המשמעות המבצעית: `ok:true` גם עם forks — כל עוד digestErrors ו-linkErrors ריקים.

**שגיאות אפשריות** (כולן `{ok:false}` HTTP 200):
- `missing selector: provide height or root` · `invalid root format — expected 64 hex chars` · `invalid height format` · `seal not found for the given selector` · `index out of batch — leafCount=N` · `unknown scope "…" — expected chain | seal | leaf`.

**סטטוס**: ✅ עובד — נבדק חי (Task 4): 41 קבלות מאומתות (כולל שחזור `at` מוכח-דיג'סט), fork באינדקס 17 מדווח; כל עלי כל החותמים verified; 6 מקרי fail-closed ירוקים.

---

## 9. `GET /api/saos/plans` (חדש Task 4)
**מה**: משטח קריאה לשתי היישויות שעד Task 4 היו מוגדרות-ולא-נכתבות: 10 שורות EnergyPlan האחרונות + 10 EconomySnapshot האחרונות. קריאה-בלבד — ללא כתיבה וללא קבלות.

**קלט**: ללא.

**פלט**:
```json
{
  "ok": true,
  "energyPlans": [ { "id": "…", "network": "TRON", "mode": "energize", "trxStaked": 6500, "energyOut": 65000, "settlements": 1, "burnCost": 109, "rcFloorPct": null, "notes": "…", "payload": {…}, "createdAt": "…" } ],
  "economySnapshots": [ { "id": "…", "label": "sim-2026-09-07T…", "inputs": {…}, "streams": […], "totalPerDay": 152.5, "flywheelPct": 30, "createdAt": "…" } ],
  "counts": { "energyPlans": 15, "economySnapshots": 5 }
}
```

**שגיאות אפשריות**: כישלון DB → `{ok:false, error}` (HTTP 200).

**סטטוס**: ✅ עובד — נבדק חי (Task 4): counts אחרי הרצות = energyPlans 15 / economySnapshots 5.

---

## 10. `POST /api/saos/auth` + `GET` + `DELETE` (חדש Task 5)

**מה**: שכבת-ההרשאות. השרת מחזיק **רק sha256** של מפתח-המנהל (`SAOS_ADMIN_KEY_HASH`); ההתחברות משווה hash-ל-hash בזמן-קבוע.

| verb | קלט | פלט | סטטוסים |
|---|---|---|---|
| `POST` | `{"key":"..."}` | `{ok:true, authenticated:true, sessionTtlSec}` + Set-Cookie `saos_session` (HttpOnly, SameSite=Strict, 12h) | 200 / 401 שגוי / 403 לא-מוגדר / 429 |
| `GET` | — | `{ok, authConfigured, authenticated, actor, ipHash}` — בלי חומר-סוד | 200 / 429 |
| `DELETE` | — | התנתקות (ניקוי cookie) + audit | 200 / 429 |

חלופה לסקריפטים: `Authorization: Bearer <key>` על כל נתיב רגיש (אותה השוואת-hash).
**כל ניסיון כושל/מוצלח נרשם ב-AuditEvent — בלי חומר-מפתח בשום שדה.**

**סטטוס**: ✅ עובד — נבדק חי: כניסה שגויה→401, נכונה→cookie, סשן מאמת, יציאה מנקה (api-check 45/45).

## 11. `GET /api/saos/live-gate` + `POST` (חדש Task 5)

**מה**: שער המעבר ל-live — רשימת-בדיקה אוטומטית של 10 בדיקות; מדווח בדיוק מה חוסם. **לא מפעיל כלום** — ההפעלה בפועל דורשת restart עם שני הדגלים.

**קלט**: GET — אופציונלי `?deep=1` (מוסיף אימות-עלים מלא). POST — דורש הרשאה (401 בלי); מבצע את אותה ריצה + audit.

**פלט**:
```json
{
  "ok": true, "readyForLive": false,
  "blockers": [ { "id": "backup-verified", "detail": "…" } ],
  "warnings": [ { "id": "networks-ready", "detail": "…" } ],
  "checks": [ { "id": "auth-configured", "status": "pass", "detail": "…" }, … ],
  "generatedAt": "…"
}
```

**10 הבדיקות**: `auth-configured` (fail אם חסר) · `rate-limit-active` · `mode-gate` · `backup-verified` (fail אם אין גיבוי מאומת <7 ימים) · `restore-plan` (warn אם docs חסרים בראנטיים) · `chain-integrity` (fail אם שרשרת פגומה) · `networks-ready` (warn — רשתות advisory) · `security-open` (warn — 4 פריטים ידועים) · `signer-attached` (fail אם אין חותם) · `tests-green` (warn — דורש `bun run check` טרי).

**סטטוס**: ✅ עובד — נבדק חי: איתור blocker אמיתי (אין-גיבוי) → תיקון (backup) → readyForLive=true עם 3 אזהרות.

## 12. `/api/saos/signer` — GET + POST + PATCH (חדש Task 5)

**מה**: תור חתימה **ללא-מפתחות**. המערכת מייצרת SignRequest (payload קנוני + payloadHash + digestToSign + metadata + הוראות); החתימה עצמה מתבצעת מחוץ למערכת; חוזר רק ה-txid הציבורי. אין שדה שבו מפתח פרטי יכול אפילו להישמר.

| verb | הרשאה | קלט | פלט |
|---|---|---|---|
| `GET` | פתוח (קריאה-ציבורית) | — | registry (manual=ready, external/hardware/none=disconnected) + counts + 20 אחרונות |
| `POST` | **נדרש** | `{network: STEEM\|BLURT\|HIVE\|TRON, signer?: manual\|external\|hardware, height?/sealId?}` | SignRequest מלא; בקשה זהה-פתוחה קיימת → `idempotent:true` |
| `PATCH` | **נדרש** | `{id, txid}` | רישום התוצאה הציבורית → `signerStatus:"ready"`; **בלתי-הפיך** (רישום-כפול נדחה); txid לא-תקני נדחה |

מחזור-חיים: `awaiting-approval` → (חתימה מחוץ למערכת) → `ready` עם txid. תוקף בקשה: 24h (`SAOS_SIGN_TTL_H`).

**סטטוס**: ✅ עובד — נבדק חי: יצירה→ממתין→רישום→אי-שכתוב; idempotency; דחיית txid פגום; אפס חומר-מפתח בתגובות (api-check).

## 13. `GET /api/saos/audit` (חדש Task 5)

**מה**: קריאת יומן-הביקורת האבטחתי. **הרשאה נדרשת** — היומן עצמו רגיש.

**קלט**: `?take=1..100` (ברירת-מחדל 50).

**פלט**: `{counts:{total, denied, byKind[]}, events:[{kind, actor, action, allowed, ipHash, detail, createdAt}]}`.

סוגי-אירועים: `auth-login` / `auth-login-failed` / `auth-logout` / `sensitive-denied` / `signer-create` / `signer-result` / `live-gate-attempt`.

**סטטוס**: ✅ עובד — נבדק חי: 401 לאנונימיים, ספירות נכונות, אפס חומר-מפתח (נבדק אוטומטית ב-api-check).

---

## 14. `GET /api/saos/anchor-preflight` (Task 6)

בדיקת-טיסה לפני עוגן אמיתי — **קריאה בלבד**: לא מבצעת עוגן, לא משדרת, לא נוגעת במפתח, לא משנה מצב.

**פרמטרים**: `?network=STEEM|BLURT|HIVE|TRON` (אופציונלי; ערך לא-מוכר ⇒ `ok:false` fail-closed).

**פלט**: `{ok, readyForAnchor, mode, liveGateReady, backupFresh, backupVerified, authReady, rateLimitReady, signerReady, externalSignerConnected, pendingSignatureQueue:{open,signedExternally,recorded,expired,cancelled,failed}, chainStatus:{ok,seals,receipts,forks}, networks[], target, blockers[], warnings[], checks[×10], recommendedNextAction, generatedAt, note}`.

**10 הבדיקות**: backup-fresh-verified · auth-ready · rate-limit-ready · seal-present · chain-intact · network-status-clear · network-resources · signature-request-open · security-open-items · mode-allows-broadcast.

**תוצאה חיה (מדידה בסבב זה)**: `readyForAnchor=false` עם 2 חוסמים כנים (HIVE RC 0.6%<8% · TRON energy=0) + 1 אזהרה; `externalSignerConnected=false` — כנה.

**סטטוס**: ✅ עובד — נבדק חי (חוזה מלא + fail-closed לפרמטר בוגוס + scope TRON); 65/65 ב-api-check.

## 15. `/api/saos/signer` — מחזור-חיים מלא (Task 6, שדרוג של נקודה 13)

**שינויי Task 6**:
- `POST` מציב `status`: manual → `awaiting-approval`, אחרים → `pending`.
- `PATCH` מרחיב לשלוש פעולות (כולן הרשאה+קצב+audit):
  - **רישום תוצאה ציבורית** `{id, txid, proofRef?, anchorRef?, verify?}` → `signed-externally`; עם `verify:true` המערכת בודקת את ה-txid מול רשת ציבורית (קריאה בלבד, פסק-זמן 5s): אומת → `recorded` + `verificationSource`; לא אומת → נשאר `signed-externally` + `verified:false` + סיבה כנה — **לעולם לא מוצג כעוגן סופי**.
  - `{id, action:"cancel", reason?}` → `cancelled` (רק לפני תוצאה).
  - `{id, action:"fail", reason}` → `failed` (רק לפני תוצאה).
- `GET` חושף `status` (מחזור-חיים), `proofRef`, `anchorRef`, `verified`, `verificationSource`, `cancelReason` + ספירות byStatus.
- פקיעה עצלה: pending/awaiting-approval שעבר `expiresAt` נקרא `expired` (מחושב; לא נכתב בקריאות).
- אל-תקינות מקובעת: txid רשום אינו ניתן לשינוי/ביטול; מצבי סופי מסרבים מוטציה.

**סטטוס**: ✅ עובד — מסלול מלא נבדק חי גם ב-api (65/65) וגם בדפדפן (login → create → badge → txid+verify → unverified כנה → cancel).
