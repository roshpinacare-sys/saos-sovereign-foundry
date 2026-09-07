# API — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 4) · כל הנתיבים תחת `/api/saos/*` · 9 endpoints · כולם `dynamic = "force-dynamic"`.

## כלל על

**API לעולם לא מחזיר 500.** כל שגיאה מוחזרת כנתון:

```json
{ "ok": false, "error": "<message>" }
```

— עם **HTTP 200**. לכן זיהוי כשל נעשה על `ok`, לא על קוד HTTP.

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
| `status failed` / `seal failed` / כו' | מעטפת | כישלון לא-צפוי (לרוב DB) | בדוק לוג dev, ר' runbook.md |

## מה עוד לא מושלם ב-API

1. אין שכבת auth/rate-limit — ר' security.md (חוסם לפני live).
2. `stamps` מחוץ ל-3..24 נחתך בשקט (מכוון, אך לא מדווח בתשובה).
3. אין פגינציה ב-status וב-plans (מקובע: 8 seals / 10 receipts / 10+10).
4. GET ל-energy/economy כותב שורת-מודל בכל קריאה — ללא ניקוי/retention (טבלאות צומחות לאט).
5. `idempotency` מבוססת root: אותו batchId עם `stamps` שונה = root אחר = חותם חדש (מתועד, מכוון).

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
