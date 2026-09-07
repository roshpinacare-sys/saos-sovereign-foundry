# מסד נתונים — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 5)

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
network (TRON/HIVE), mode (energize | rc-recovery — תוצרי תכנון בלבד), trxStaked? (TRX), energyOut?, settlements?, burnCost? (TRX/יום מעוגל), rcFloorPct?, notes?, payload (JSON integer-safe), createdAt. **@@index([network, createdAt])** (נוסף Task 4).
**✅ נכתב מאז Task 4**: `/api/saos/energy` שומר שורה בכל קריאה (planId מוחזר); נקרא דרך `/api/saos/plans`.

### EconomySnapshot — צילומי כלכלה
label, inputs (JSON), streams (JSON), totalPerDay (Float), flywheelPct, createdAt. **@@index([createdAt])** (נוסף Task 4).
**✅ נכתב מאז Task 4**: `/api/saos/economy` שומר שורה בכל קריאה (snapshotId מוחזר); נקרא דרך `/api/saos/plans`.

### EvidenceReceipt — קבלות ראיות
| שדה | טיפוס | אילוצים |
|---|---|---|
| id | String | PK |
| kind | String | seal/selftest/verify-pack/energy-plan/economy-sim/verify-chain; @@index([kind]) |
| digest | String | **unique** — דיג'סט הקבלה |
| prevDigest | String? | קישור לקבלה קודמת (hash chain / DAG) |
| at | DateTime? | **זמן-החיתום — חלק מהדיג'סט**; שומר מאז Task 4; שורות ישנות שוחזרו ב-backfill מוכח-דיג'סט |
| payload | String | JSON של ה-payload |
| sealId | String? | FK אופציונלי |

### ResearchFinding — פסק-הדין של המחקר
archive (**unique**), rank, score (0..100), verdict, salvage (JSON), evidence (JSON). 10 רשומות — מראה idempotent מ-`findings.ts` דרך `/api/saos/research`.

### OpLog — יומן תפעול
op (String, @@index([op])), detail?, createdAt. נכתב נכון להיום רק על `seal`.


### AuditEvent — יומן ביקורת אבטחה (חדש Task 5)

כל ניסיון פעולה-רגישה (מאושר או נדחה). **אין חומר-מפתח** — actor הוא תווית בלתי-הפיכה (`cookie:<8hex>` / `bearer:<8hex>` / `anonymous`), ipHash מקוצר לקורלציה בלבד.
אינדקסים: `[kind, createdAt]`, `[createdAt]`. נשמר **לתמיד** (protected — ר' §retention).

### PendingSignature — תור חתימה ללא-מפתחות (חדש Task 5)

בקשת-חתימה שנוצרת ע"י המערכת: payload קנוני, payloadHash, digestToSign, signer (none/external/manual/hardware), signerStatus (disconnected/ready/awaiting-approval/error), txid ציבורי **בלתי-הפיך** אחרי רישום, expiresAt (ברירת-מחדל 24h).
עיצוב-מפתח: **אין עמודה שבה מפתח פרטי יכול להישמר** — ההגנה מבנית, לא נוהלית.
אינדקסים: `[signerStatus]`, `[network, createdAt]`. קשר ל-SealRecord (sealId, optional).

## 3. מצב נוכחי (מדידה חיה בסוף Task 4)

```
seals=31 (heights 1..31 רציפים ויחודיים)  leaves=229 (דיג'סטים יחודיים, סכום תואם)
anchors=124  receipts=117  energyPlans=15  economySnapshots=5  findings=10  oplog=31
orphanLeaves=0  orphanAnchors=0  orphanReceipts=0
```

### 3.1 מיפוי מחזור-חיים לכל ישות (Task 4)

| ישות | כותב | מתי | קלט | פלט/שימוש | נקרא דרך | בדיקה |
|---|---|---|---|---|---|---|
| SealRecord | POST /seal | כל פעימה (בתוך טרנזקציה) | batchId, stamps, memo | height/root/stateRoot/gasUsed | /status, /verify-pack, /verify-chain | api-check + concurrency-check |
| SealLeaf | POST /seal | אותה טרנזקציה | digests של פעולות הבאצ' | עלי מרקל להוכחה | /verify-pack, /verify-chain | api-check + verify-chain |
| AnchorTx | POST /seal | אותה טרנזקציה | מטריצת העגינה | סטטוסים כנים לכל רשת | /status | api-check |
| EvidenceReceipt | /seal, /kernel, /verify-pack, /verify-chain, /energy, /economy | אחרי כל פעולה ראויה-ראיה | kind, payload, prevDigest, at | שרשרת ראיות | /status, /verify-chain | verify-chain (digest+link) |
| EnergyPlan | GET /energy | כל קריאה (persisted בהתאם למצב) | trx/txs או rc | היסטוריית תוכניות | /plans | api-check |
| EconomySnapshot | GET /economy | כל קריאה | פרמטרי הסימולציה | היסטוריית צילומים | /plans | api-check |
| ResearchFinding | GET /research | upsert idempotent | findings.ts | פסק-הדין בביקורת | /research | api-check |
| OpLog | POST /seal | אותה טרנזקציה | op=seal + detail | יומן תפעול | מונה ב-/status | api-check |

## 4. מיגרציות

- **תהליך**: אין תיקיית migrations — משתמשים ב-`prisma db push` (declarative). התאמה לסנדבוקס; לפרודקשן מומלץ `prisma migrate dev` כדי לקבל היסטוריית מיגרציות.
- **תיקון היסטורי**: הסוג `Double` נדחה על SQLite → הוחלף ל-`Float` (worklog Task 2).
- **אילץ ייחודי height**: נוסף מההתחלה; הבאג שחשף אותו מתועד ב-testing.md (BUG-001).

## 5. גיבוי — סקריפט מאומת (Task 5)

```bash
bun run backup    # scripts/backup.mjs
```

- **snapshot עקבי-אונליין** באמצעות SQLite `VACUUM INTO` (בטוח גם כשהשרת רץ)
- manifest.json: git commit, גרסאות, sha256+size לכל קובץ, ספירות-שורות לכל המודלים, רשימת החרגות מפורשת
- **אימות**: פתיחת ה-snapshot ב-PrismaClient נפרד → `PRAGMA integrity_check` + השוואת ספירות מול ה-manifest
- רישום `OpLog(op=backup, detail=…verified=true…)` — ה-live-gate קורא אותו (backup-verified, תוקף 7 ימים)
- **ההחרגות קבועות**: .env, upload/, research/, node_modules — סודות לעולם לא נכנסים לגיבוי
- רטנשן: שומר 10 האחרונים (backups/ כולו gitignored)

## 6. שחזור — תמיד מאומת (Task 5)

```bash
bun run restore backups/<dir>               # dry-run: אימות בלבד, לא נוגע בכלום
bun run restore backups/<dir> --target X    # תרגיל: שחזור ליעד ניסיוני
bun run restore backups/<dir> --yes         # שחזור אמיתי (ה-db הקודם מקבל שם .pre-restore-<ts>)
```

אימות בכל מצב: manifest תקין → sha256 לכל קובץ → integrity_check → השוואת ספירות. **כישלון אימות = נגיעה אסורה.**
הוכח בביקורת-עצמית (תיחום): שינוי בת-בייט אחד ב-snapshot → `❌ restore aborted — verification failed`.

### מדיניות רטנשן (Task 5, מיסיון 6) — `bun run cleanup`

| טבלה | מדיניות |
|---|---|
| SealRecord, SealLeaf, AnchorTx, EvidenceReceipt, ResearchFinding, **AuditEvent** | **לתמיד — protected**: הסקריפט מסרב לגעת |
| OpLog | מעל 90 יום, תוך שמירת 1000 הצעירות |
| EnergyPlan | מעל 180 יום |
| EconomySnapshot | מעל 180 יום, תוך שמירת 100 הצעירות |
| PendingSignature | שפג-תוקף לפני מעל 30 יום |
| backups/ | מעבר ל-10 האחרונים (בתוך backup.mjs) |

`cleanup` (dry-run ברירת-מחדל) מדפיס מה יימחק; `--yes` מבצע **רק אם קיים גיבוי מאומת <24h** (אחרת: "אין גיבוי → אין מחיקה"). כל ריצת מחיקה נרשמת ב-OpLog.

## 7. נקודות תורפה

| # | תורפה | אפקט | הערה |
|---|---|---|---|
| W1 | SQLite קובץ-יחיד | אין ריבוי-מופעים; תלות בדיסק מקומי | מספיק לסנדבוקז; מעבר Postgres דורש שינוי provider בלבד (הסכימה תואמת) |
| W2 | `db push` ללא היסטוריית מיגרציות | שינוי סכמה עלול לבקש reset בעתיד | לפני כל push: גיבוי |
| W3 | ~~מירוץ height~~ | ~~unique constraint → ok:false~~ | **סגור Task 4**: טרנזקציה+mutex+retry+idempotency; מוכח 8/8 מקבילות | ✅ |
| W4 | ~~פיצול hash-chain~~ | ~~כתיבה כפולה~~ | **סגור Task 4**: קבלה בתוך טרנזקציית ה-seal; פיצול היסטורי (אינדקס 17) מדווח בלי שכתוב | ✅ |
| W5 | Float על כסף (EconomySnapshot.totalPerDay) | עיגול-נקודה-צפה בשדה התצוגה | קבלות מקודדות micro-units (שלמים); שדה Float הוא תצוגה בלבד, לא מדוג'סט | מופחת |
| W6 | ~~EnergyPlan/EconomySnapshot ללא כותב~~ | ~~טבלאות מתות~~ | **סגור Task 4**: כותבים + /plans לקריאה | ✅ |
| W7 | קבלות GET צומחות בכל קריאה | נפח | **מופחת Task 5**: מדיניות רטנשן קיימת (cleanup) אך ידנית — אין ריצה אוטומטית | מופחת |

---

## Task 6 — PendingSignature: מחזור-חיים ותוצאה ציבורית

עמודות חדשות (db push מאומת; גיבוי לפני — backup-2026-09-07T14-36-56):

| עמודה | טיפוס | משמעות |
|---|---|---|
| `status` | String @default("pending") | pending / awaiting-approval / signed-externally / recorded / failed / expired / cancelled |
| `proofRef` | String? | הוכחה ציבורית (URL סייר/בלוק) — נתון ציבורי בלבד |
| `anchorRef` | String? | רפרנס עגינה ציבורי |
| `verified` | Boolean? | null=לא נבדק · true=אומת מול רשת ציבורית · false=לא ניתן לאימות (הסיבה ב-verificationSource) |
| `verificationSource` | String? | ה-endpoint הציבורי שאימת — או הסיבה הכנה שלא |
| `verifiedAt` | DateTime? | מועד האימות |
| `cancelReason` | String? | סיבה ציבורית ל-cancelled/failed |
| `cancelledAt` | DateTime? | מועד הביטול |

אינדקס חדש: `@@index([status])`. **אין שום עמודה שבה ניתן לשמור חומר-מפתח** — הערה מבנית שנשמרת.

ספירות במדידת הסבב: 57 seals · 416 leaves · 228 anchors · 211 receipts · 31 plans · 11 snapshots · 10 findings · ~70 audit · pendingSignature ~13 (מחזור-חיים: 3 awaiting/pending פתוחים, 3 signed-externally, 1 cancelled, 1 failed + היסטוריית Task 5).

פקיעה: חישוב עצל בקריאה (`effectiveStatus`) — pending/awaiting-approval מעבר ל-`expiresAt` נקראים `expired`; cleanup.mjs ממשיך לגזום רשומות שפגו מעל 30 יום (מדיניות Task 5 ללא שינוי).
