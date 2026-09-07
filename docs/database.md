# מסד נתונים — SAOS Sovereign Foundry v2

עודכן: 2026-09-07

## 1. סוג ומיקום

- **מנוע**: SQLite דרך Prisma ORM 6.16.2 (provider `sqlite`).
- **קובץ**: `db/custom.db` (נתיב מ-`DATABASE_URL` ב-`.env`).
- **קליינט**: `src/lib/db.ts` — Prisma singleton, לוג `warn/error`, מופע גלובלי ב-dev למניעת דליפת חיבורים.

## 2. סכמה (prisma/schema.prisma)

### SealRecord — שורשי-האיטום
| שדה | טיפוס | אילוצים | הערות |
|---|---|---|---|
| id | String | PK (cuid) | |
| height | Int | **unique** | רצף החותמים; נגזר `max(DB)+1` ב-seal |
| root | String | **unique** | שורש מרקל של הבאצ' (hex) |
| leavesCount | Int | | מספר עלים |
| stateRoot | String | | sha256 של מצב הקרנל הקנוני |
| gasUsed | Int | | סך גז לפי GAS_TABLE |
| note | String? | | memo |
| createdAt | DateTime | default now | index |

יחסים: `anchors AnchorTx[]`, `leaves SealLeaf[]`, `receipts EvidenceReceipt[]`.

### SealLeaf — עלי הבאצ'
| שדה | טיפוס | אילוצים |
|---|---|---|
| id | String | PK (cuid) |
| sealId | String | FK → SealRecord, **onDelete: Cascade** |
| index | Int | **@@unique([sealId, index])** |
| kind | String | stamp/seal/harvest/relay/relay_ack/wallet |
| payload | String | JSON קנוני של הפעולה |
| digest | String | sha256 של ה-payload; **@@index([digest])** |

### AnchorTx — עגינה ציבורית
| שדה | טיפוס | הערות |
|---|---|---|
| id | String | PK |
| sealId | String? | FK אופציונלי → SealRecord |
| network | String | STEEM/BLURT/HIVE/TRON; **@@index([network, status])**; @@index([sealId]) |
| kind | String | weave/checkpoint/identity |
| txid | String? | **null כל עוד לא נחתם — אסור לביים** |
| status | String | anchored/pending/gated/transit |
| gate | String? | סיבת אי-עגינה (rc-floor, energy-0, advisory-mode…) |
| meta | String? | JSON נלווה (rcPct, tronEnergy…) |

### EnergyPlan — תוכניות אנרגיה
network (TRON/HIVE), mode (energize/powerup/delegate), trxStaked?, energyOut?, settlements?, burnCost?, rcFloorPct?, notes?, payload (JSON קנוני מלא), createdAt.
**⚠️ פער ידוע**: המודל קיים אך **אף נתיב API לא כותב אליו כיום** — `/api/saos/energy` משורשר קבלה אך לא שומר EnergyPlan. ר' next-steps.

### EconomySnapshot — צילומי כלכלה
label, inputs (JSON), streams (JSON), totalPerDay (Float), flywheelPct, createdAt.
**⚠️ פער ידוע**: כנ"ל — מוגדר, לא נכתב.

### EvidenceReceipt — קבלות ראיות
| שדה | טיפוס | אילוצים |
|---|---|---|
| id | String | PK |
| kind | String | seal/selftest/verify-pack/energy-plan/economy-sim; @@index([kind]) |
| digest | String | **unique** — דיג'סט הקבלה |
| prevDigest | String? | קישור לקבלה הקודמת (hash chain) |
| payload | String | JSON של ה-payload |
| sealId | String? | FK אופציונלי |

### ResearchFinding — פסק-הדין של המחקר
archive (**unique**), rank, score (0..100), verdict, salvage (JSON), evidence (JSON). 10 רשומות — מראה idempotent מ-`findings.ts` דרך `/api/saos/research`.

### OpLog — יומן תפעול
op (String, @@index([op])), detail?, createdAt. נכתב נכון להיום רק על `seal`.

## 3. מצב נוכחי (מדידה חיה 2026-09-07)

```
seals=3  leaves=25  anchors=12  receipts=28  energyPlans=0  economy=0  findings=10  oplog=3
```

## 4. מיגרציות

- **תהליך**: אין תיקיית migrations — משתמשים ב-`prisma db push` (declarative). התאמה לסנדבוקס; לפרודקשן מומלץ `prisma migrate dev` כדי לקבל היסטוריית מיגרציות.
- **תיקון היסטורי**: הסוג `Double` נדחה על SQLite → הוחלף ל-`Float` (worklog Task 2).
- **אילץ ייחודי height**: נוסף מההתחלה; הבאג שחשף אותו מתועד ב-testing.md (BUG-001).

## 5. גיבוי

```bash
# גיבוי מלא (קובץ יחיד):
cp db/custom.db "backups/custom-$(date +%Y%m%d-%H%M%S).db"

# ייצור נתונים לוגיים (לצורך ביקורת):
curl -s http://localhost:3000/api/saos/status | jq . > backup-status.json
curl -s http://localhost:3000/api/saos/verify-pack | jq . > backup-verify-pack.json
```

- **תדירות נדרשת**: לפני כל `db push` ולפני כל סבב תחזוקה (ר' runbook.md).
- **הכללה בריפו**: `db/` ו-`prisma/*.db` מנוטרלים ב-.gitignore — קובץ ה-DB **אינו** בריפו במתכוון (נתוני ריצה, לא קוד). הסכימה עצמה בריפו.

## 6. שחזור

1. `bun install`
2. הגדר `.env` עם `DATABASE_URL="file:./custom.db"` (יחסית ל-`prisma/`).
3. `bun run db:push` — יוצר סכמה מלאה מתוך `schema.prisma`.
4. (אופציונלי) שחזור נתונים: העתקת קובץ גיבוי ל-`db/custom.db`, או ריצה מחדש של פעימות seal + `curl /api/saos/research` למילוי ResearchFinding.
5. הפעלה: `bun run dev`.

שחזור מלא מהריפו מובטח עבור: קוד, תלויות (bun.lock), סכימה, תיעוד. נתוני ריצה משוחזרים מגיבוי קובץ או ע"י יצירה מחדש (הפלטפורמה דטרמיניסטית — פעימה חדשה תניב שורשים חדשים תקינים).

## 7. נקודות תורפה

| # | תורפה | אפקט | הערה |
|---|---|---|---|
| W1 | SQLite קובץ-יחיד | אין ריבוי-מופעים; תלות בדיסק מקומי | מספיק לסנדבוקז; מעבר Postgres דורש שינוי provider בלבד (הסכימה תואמת) |
| W2 | `db push` ללא היסטוריית מיגרציות | שינוי סכמה עלול לבקש reset בעתיד | לפני כל push: גיבוי |
| W3 | מירוץ height (F1) | unique constraint → ok:false | ר' architecture.md; תיקון אטומי ב-next-steps |
| W4 | hash-chain prevDigest לפי createdAt | כתיבה כפולה כמעט-מקבילה עלולה לפצל שרשרת | מופע יחיד מקטין סיכוי; verifyChain חושף |
| W5 | Float על כסף (EconomySnapshot.totalPerDay) | עיגול-נקודה-צפה | מקבילת micro-units נאכפת בקבלות; שדה ה-DB לא נכתב כיום (הפער מגן בפועל) |
| W6 | EnergyPlan/EconomySnapshot ללא כותב | טבלאות מתות | מסומן ב-next-steps |
