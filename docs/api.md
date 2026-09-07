# API — SAOS Sovere Foundry v2

עודכן: 2026-09-07 · כל הנתיבים תחת `/api/saos/*` · כולם `dynamic = "force-dynamic"`.

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

**מה**: פעימת עגינה — בניית באצ' קרנל → replay → stateRoot → עץ מרקל → persist (SealRecord+SealLeaf+AnchorTx×4) → קבלה → OpLog. בסנדבוקס: **advisory-mode** (סטטוסים כנים, `txid:null`).

**קלט** (JSON body, כולו אופציונלי):
| שדה | טיפוס | ברירת-מחדל | מגבלה |
|---|---|---|---|
| `stamps` | number | 6 | מקובץ: `Math.min(24, Math.max(3, n))` |
| `memo` | string | "פעימת עגינה מהמגדל" | נשמר כ-note |

באצ' קבוע מעל ה-stamps: `harvest` (grid-98, 42 SAOS) + `relay` (→ steem:headcorner) + `seal`.

**פלט**:
```json
{
  "ok": true,
  "seal": { "id": "cmtr7jff3…", "height": 3, "root": "7e3b3fc8…", "stateRoot": "459c971a…", "leaves": 8, "gasUsed": 180 },
  "anchors": [
    { "network": "STEEM", "status": "pending", "gate": "advisory-mode: …" },
    { "network": "BLURT", "status": "pending", "gate": "advisory-mode: …" },
    { "network": "HIVE",  "status": "gated",   "gate": "rc-floor(0.6%<8%) · advisory-mode: …" },
    { "network": "TRON",  "status": "transit", "gate": "energy-0 · advisory-mode: …" }
  ],
  "receipt": "<digest>"
}
```

**שגיאות אפשריות**:
- `seal requires stamps in batch` — אם stamps מחושב 0 (קלט לא-מספרי).
- `Unique constraint failed on the fields: (height)` — מירוץ בין שתי פעימות מקבילות (F1 ב-architecture.md). התמודדות: נסיון חוזר.
- כל שגיאה אחרת → `{ok:false, error}` (HTTP 200).

**סטטוס**: ✅ עובד — נבדק חי 2026-09-07: `{"stamps":5}` → height 3, root `7e3b3fc8…`, 8 עלים, גז 180. קלט שגוי `{"stamps":"abc"}` → `{ok:false,"error":"seal requires stamps in batch"}` (HTTP 200).

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

**מה**: מחשבוני ריבונות אנרגיה — TRON energize (ברירת-מחדל) או Hive RC recovery; כל תוכנית משורשרת בקבלה.

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

**מה**: סימולטור גלגל-החור — 4 זרמי הכנסה, סה"כ/יום, מיחזור לאנרגיה (60% מהמיחזור → TRX → יישובים).

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
| `Unique constraint failed on the fields: (height)` | seal | מירוץ בין שתי פעימות (F1) | נסיון חוזר |
| `float/inf rejected — integers only` | canonicalize | קלט לא-מספרי/NaN הגיע לקנוניה (F4) | תקן את הפרמטר |
| `seal requires stamps in batch` | קרנל | קלט stamps לא-מספרי → 0 | שלח מספר 3..24 |
| `status failed` / `seal failed` / כו' | מעטפת | כישלון לא-צפוי (לרוב DB) | בדוק לוג dev, ר' runbook.md |

## מה עוד לא מושלם ב-API

1. אין שכבת auth/rate-limit — ר' security.md.
2. `stamps` מחוץ ל-3..24 נחתך בשקט (מכוון, אך לא מדווח בתשובה).
3. אין פגינציה ב-status (מקובע: 8 seals / 10 receipts).
4. EnergyPlan/EconomySnapshot מוגדרים ב-DB אך אף נתיב לא כותב אליהם (ר' database.md).
