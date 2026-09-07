# שילוב אתריום וסולנה — Ethereum & Solana Integration (Task 12)

> מצב: **dry-run בלבד, keyless, כנה.** אין עסקה, אין שידור, אין חתימה, אין ארנק מחובר — ואף אחד מהם לא יבוצע על-ידי המערכת.
> המערכת מכינה נתונים ומציגה מצב כנה; הבעלים חותם מחוץ למערכת (docs/external-signer.md); רק תוצאה ציבורית (tx hash / signature) חוזרת פנימה.

---

## 1. מה נוסף

### מודולי רשת (`src/lib/saos/networks/`)

| קובץ | תפקיד |
|---|---|
| `types.ts` | `ChainType` (graphene / tvm / evm / solana-runtime), `RpcStatus` (not-configured / public / configured), `ExtendedNetworkFields` |
| `ethereum.ts` | סטטוס אתריום + `probeEthereumReadonly()` (קריאה-בלבד, opt-in) + `ethereumReadRpcCandidate()` לאימות-txid ציבורי |
| `solana.ts` | סטטוס סולנה + `probeSolanaReadonly()` (קריאה-בלבד, opt-in) + `solanaReadRpcCandidate()` |

כל סטטוס רשת מחזיר את השדות המלאים: `status`, `mode`, `chainType`, `chainId`, `anchorTypes`, `rpcStatus`, `liveProbePossible`, `lastChecked`, `lastVerifiedAnchor`, `nextAction`, `blocker`, `requiredResource`, `unblockPlan`, `isReadyForAnchor`, `isDryRunOnly`, `ownerOptions`, `ownerAction`, `estimatedTime`, `estimatedCost`, `resourceLiveChecked`.

### עקרון not-configured

- אין RPC מוגדר ← **זהו מצב** (`not-configured`), לא שגיאה, לא חריגה, לא נתון מומצא.
- `chainId` ריק ← `null` (לעולם לא "1" במחיר המצאה); `estimatedCost` ← `null` (מחיר gas הוא נתון-שוק — לא מומצא).
- אימות-קריאה (probe) אפשרי **רק** כשמוגדר RPC ציבורי ללא מפתח.

## 2. כובלי בטיחות RPC (נאכפים בקוד)

ה-`safeRpcUrl()` בשני המודולים **מסרב** ל:

- URL לא-תקני או פרוטוקול לא http/https
- כתובת עם credentials מוטמעים (`user:pass@`)
- פרמטר-שאילתה שנראה כמפתח (`key|token|secret|auth`)

ה-URL עצמו **לעולם לא** נשמר, מוצג, נרשם בלוג או חוזר בתשובת API — רק hostname (ב-probe). **RPC עם מפתח לא נכנס לריפו** — `.env.example` מגדיר שמות משתנים בלבד: `ETH_RPC_URL`, `ETH_CHAIN_ID`, `SOL_RPC_URL`, `SOL_CLUSTER`.

## 3. אוצר-מילים לעיגון (תוכנית בלבד — לא ביצוע)

| רשת | chainType | משאב עיקרי | סוגי עיגון אפשריים |
|---|---|---|---|
| ETHEREUM | evm | gas (ETH) | `tx-hash`, `calldata-hash` (stateRoot בנתוני הקריאה), `memo/log-commitment` |
| SOLANA | solana-runtime | SOL (עמלות + rent + compute units) | `signature`, `blockhash-commitment`, `memo-program` (SplMemo) |

## 4. שינויים בממשקים

### `/api/saos/status`

- `networks` — כעת **6** רשתות (STEEM, BLURT, HIVE, TRON, **ETHEREUM**, **SOLANA**), כל אחת כולל שדות ה-Task 12.
- `matrix` — 6 שערים; ETHEREUM/SOLANA = `gated` עם `not-configured` (או gate null כש-RPC מוגדר — עדיין dry-run עד חותם).
- **`?probe=1` (opt-in):** מצרף `probes.ethereum` / `probes.solana` — קריאה-בלבד (`eth_chainId`+`eth_blockNumber` / `getSlot`), פסק-זמן 2.5s, `sourceHost` בלבד. ברירת-המחדל (בלי הפרמטר) נשארת **אפס קריאות רשת חיות**.

### `/api/saos/anchor-preflight`

- מקבל `?network=ETHEREUM|SOLANA` (וגם את הקיימות); רשת לא-מוכרת נשארת fail-closed.
- `not-configured` של ETH/SOL מדווח כ-**warn** — לעולם לא `fail` (היעדר RPC הוא היערכות-יבשה תקינה, לא שער שבור).
- `networks[]` בתשובה כוללת עתה `chainType`, `chainId`, `rpcStatus`, `blocker`, `ownerAction`.

### `/api/saos/signer`

- `SignRequest.network` כולל ETHEREUM/SOLANA; הוראות-חתימה חיצונית ייעודיות (EVM calldata / Solana memo-blockhash).
- אימות txid ציבורי: `eth_getTransactionByHash` / `getTransaction(finalized)` על RPC קריאה keyless (env או ציבורי ידוע); כל כישלון = `unverified` כנה — לעולם לא עוגן-סופי.

### UI (מסך רשתות ומשאבים)

- 6 כרטיסים; כל כרטיס: סטטוס, מצב, dry-run, מוכנות, **chainType**, **RPC-status**, זהות-שרשרת (מזהה/קלאסטר + סוגי-עיגון), חסימה, משאב, אפשרויות בעלים, המלצה, מקור נתון, זמן בדיקה.
- מסך חתימות: dropdown רשת-יעד עם 6 אפשרויות.
- RTL מלא; נבדק 360/390/1440px — אפס גלילה אופקית, אפס שגיאות קונסולה.

## 5. בדיקות (הכול ירוק)

- api-check: **135/135** — כולל סעיפים חדשים 24–27: נוכחות ETH/SOL, dry-run כברירת-מחדל, no-error-without-RPC, chainType, אין-המצאת chainId/עלות/זמן, unblockPlan, ownerAction, אין מחרוזות בצורת-סוד, אין URLs בתשובות, probe כנה, preflight כולל את השתיים, SignRequest יבש לשתי הרשתות + ביטול-ניקוי.
- concurrency: 8/8; lint + typecheck נקיים.

## 6. מה **לא** נעשה (בכוונה — כנות)

- אין עסקה אמיתית באתריום או סולנה; אין שידור; אין חתימה; אין ארנק מחובר; אין ניסיון מימון/גז/rent.
- אין RPC עם מפתח — לא בקוד, לא ב-env לדוגמה, לא בריפו.
- אין ערכי chainId קבועים בקוד (השדה מה-env או `null`).
- הרשתות אינן "מוכנות לעוגן" (`isReadyForAnchor=false`) — חסם הכספת/חותם-חיצוני עדיין עומד לכל הרשתות.

## 7. פעולות בעלים אופציונליות לשדרוג המצב

1. הגדרת `ETH_RPC_URL` / `SOL_RPC_URL` **ציבוריים ללא מפתח** (+ `ETH_CHAIN_ID`, `SOL_CLUSTER`) → נפתח אימות-קריאה אופציונלי. אפס עלות, אפס סיכון.
2. מימון gas/SOL + חתימה חיצונית — **נדרש אישור בעלים מפורש**; המערכת תישאר dry-run עד `SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES` ומוכנות-מלאה לפי docs/first-anchor-runbook.md.
3. סיבוב טוקן ה-remote המוטמע בשיבוט הישן (ראה docs/multi-agent-map.md §2).
