# סקר-חי ETH/SOL — Ethereum & Solana Live Audit (2026-09-11)

> מטרה: **מענה-מאוחד לשאלת הבעלים** — "איפה ה-SOL/ETH, מה קרה איתם בסוף, מה יש לנו באתריום, עשינו משהו? זה לא מתועד".
> התיעוד היה **מפוזר** (FORENSIC-AUDIT / secret-hygiene / multi-agent-map / partners-status / task-75) ומעולם לא סונתז לתמונה-אחת. מסמך זה סוגר את הפער.
> שיטה: קריאה-בלבד מול mainnet (blockscout API v2 + RPC ציבורי: flashbots/llamarpc/mainnet-beta/publicnode). אפס חתימה, אפס שידור, אפס אינטראקציה עם טוקנים. כל הכתובות ציבוריות (רישום ריבוני, 12 סוכנים).
> אימות-בעלות: הבעלים אישר מפורשות — "הכתובות חייבות להיות שלנו!! עשינו כתובת לכל אחד" (trace 1a08e20803a82dc1).

---

## 1. התשובה הקצרה

1. **המפתחות**: מטוס-ריבוני משוחזר — `~/.secrets/keys-restored/agent/keys/wallets-registry.json` (12 סוכנים × EVM-7רשתות + TRON + SOL + BTC-צפייה; נגזר 2026-09-09T23:05Z מ-`wallets-seed.json`). שלמות pk→address אומתה: **EVM 12/12 · TRON 12/12 · SOL 12/12**. חתימה-חיה מאומתת roundtrip ×3 מישורים דרך key-broker :3040.
2. **כן, עשינו משהו על אתריום מייננט — והרבה** (וזה היה מתועד-חלקית בלבד): כתובת headcorner-EVM ביצעה **76 עסקאות** מצטברות, כולל קמפיין-עיגון חי 08–09/09 (פירוט ב§3), **מימנה 10 כתובות-סוכנים** (§4), ו**פרסה חוזה משלנו** (§5).
3. **SOL**: קמפיין-עיגון חי — headcorner-SOL 10 חתימות (08/09 14:28–14:34) + 1 (09/09 09:25); cashmachine-SOL 10 חתימות (10/09 10:38–10:46); 10 כתובות סוכנים מומנו 0.006 SOL כל אחת וטרם-פעילות.
4. **יתרות חי נכון לסקר** (11/09): ETH מצטבר ≈ **0.00210 ETH** (אבק-גז בלבד); SOL מצטבר ≈ **0.0608 SOL**. אין נכס-משמעותי נזיל על-שתי הרשתות — הערך הוא **הראיות על-השרשרת + המפתחות**, לא היתרות.
5. **אזהרת-בעלים ממומשת**: טוקן **WATTOIN** (Watt2Trade, `0x5eef5946AD78E614bB3Ee7b9eD1097c517ae97f7`) ישב על headcorner-EVM (5.0 יחידות) — **לא נרכש על-ידינו**. מטופל כנכס-לא-רצוי/מתחזה-פוטנציאלית: **איסור מוחלט על approve/transfer/interact** (§7).

---

## 2. מטוס-ריבוני — היכן המפתחות ומה מאומת

| פריט | מצב |
|---|---|
| Seed ריבוני | `~/.secrets/keys-restored/agent/keys/wallets-seed.json` (שוחזר במשימה 67, מאומת 48/48) |
| רישום-כתובות | `wallets-registry.json` — 12 חשבונות: EVM(7 רשתות)+TRON+SOL+BTC-zpub, נגזר 2026-09-09T23:05:50Z |
| שלמות | pk→address: EVM 12/12 · TRON 12/12 · SOL 12/12; evm.pk≠tron.pk (0/12 זהים — מפתחות-נפרדים-מתוכננים); BTC watch-only |
| חתימה-חיה | key-broker :3040 — EVM EIP-191 65B · TRON 0x19-header 65B · SOL ed25519 64B → valid:true ×3 |
| מישורי-רשת | ETH: `gated` — קריאה-בלבד, אין שידור מהפלטפורמה; SOL: `gated` — קריאה-בלבד, אין שידור (חוק-זהב: גז/SOL ממומן-בעלים + חתימה-חיצונית) |

---

## 3. מה באמת קרה על אתריום מייננט (headcorner-EVM `0x2767e8146c11baD1d9B0784f11325375195c1b0f`)

**ההקשר ההיסטורי (מתועד-בפזורה):** סוכן `saos-dex` (ריפו עצמאי ~306KB, FORENSIC-AUDIT §27) החזיק מפתח-ETH חי ב-env-זמן-ריצה ושידר מהכתובת הזאת; סוכן `saos-jummper` (Python, graphene.py) עיגן עם witness קהילתיים. שני הסוכנים נבדקו supply-chain (task-23) וארכיונם תועד. **החלק החסר בתיעוד — מה באמת ישב על-השרשרת** — מסונתז כאן לראשונה מול mainnet:

| קמפיין | מתי | מה נמדד חי |
|---|---|---|
| `saos-dex/v1 chain-seal` | מ-08/09 02:30 | payload מפוענח (tx `0xbda442c1…`, 08/09 02:57): `{"protocol":"saos-dex/v1","action":"chain-seal","height":636,"stateRoot":"63580a47…d97091","digest":"d59211e7…8f313d"}` — תואם `saos-dex/state/anchors.json` שנתפס ב-Forensic |
| `saos-jumpper/v1 batch-anchor` | 09/09 01:54–04:56 | **6 עוגני-אצווה חיים** בעמוד-האחרון; payload מלא מפוענח (tx `0x4f27c008…529d1b0e`): `{"protocol":"saos-jumpper/v1","action":"batch-anchor","height":74907,"root":"758495563ce041deb468b4c89cfc93ef31b3fb9ed2c450f819c0d42df1129dea","leafCount":64,"at":"2026-09-09T04:54:17.588Z","witness":{"steem":109419800,"hive":109754327,"tron":86085952,"ethereum":25937567,"solana":445525351}}` — **עדות-חוצת-שרשראות עם גבהי-חסוי של 5 רשתות על אתריום מייננט** |
| self-tx עיגון | 08–09/09 | 44+ עסקאות self (to=self, value=0) עם calldata JSON — דפוס "memo-log commitment" מהמסמך-המקורי (ethereum-solana-integration.md §3) |
| חוזה-שלנו | 08/09 | **פריסה עצמית**: creator של `0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6` = headcorner עצמו; 4 קריאות (3× selector `0x277c9c3c`, 1× `0x8be975cf` — האחרונה נושאת commitment 32בייט `4460a0c2…702214c8`) |
| העברה-חוץ | 09/09 04:5x | 0.000081 ETH → `0x01Bd2879Cd99…` — כתובת **חוץ-לצי** (לא אחת מה-12). זוהתה, מסומנת לבדיקת-בעלים (לא חוסמת) |
| nonce מצטבר | — | **76** outgoing; יתרה-נוכחית 0 |

**הערת-שם**: קיימת וריאנט-כתיב `saos-jumpper` (עם "pp") — זהה לשם סוכן `saos-jummper` ברישום הצי (secret-hygiene §220, next-steps §336). לא שחקן-זר: אותה כתובת-חותמת (headcorner), אותו דפוס, אותו ציר-זמן.

---

## 4. הצבת-הסוכנים (מה שהבעלים זכר — "עשינו כתובת לכל אחד")

**ETH — 11 כתובות מעבר ל-headcorner:**
- 10 כתובות (ynet, haran, israelnews, lsa, macrame, siq, tov, wic, wog, woq): **מומנו 0.0002 ETH כל אחת** מתוך headcorner (ynet אומת: טרנספר-נכנס יחיד 08/09 02:10:59 מ-`0x2767e8146c11…`) — nonce=0, לא שלחו דבר, יתרת-אבק יושבת.
- cashmachine (`0x0FB6C180…`): nonce=3, יתרה 0.0001012686 ETH.

**SOL — 12 כתובות:**
- 10 כתובות סוכנים: מומנו **0.006 SOL** כל אחת (חתימה-נכנסת אחת = המימון), לא-פעילות.
- headcorner-SOL (`9knfnFML…giL`): יתרה 0 לאחר קמפיין-עיגון (10 חתימות 08/09 14:28–14:34 + 1 ב-09/09 09:25).
- cashmachine-SOL (`HBBdhpbp…736s`): יתרה 0.000815; 10 חתימות 10/09 10:38–10:46.

---

## 5. יתרות-חי (נמדד 2026-09-11, blockscout + flashbots/mainnet-beta)

| רשת | מצטבר | הערה |
|---|---|---|
| ETH | ≈ 0.00210 ETH (11 כתובות: 10×0.0002 + 0.00010127) | אבק-גז בלבד; headcorner=0 |
| SOL | ≈ 0.0608 SOL (10×0.006 + 0.000815) | אבק-rent; headcorner=0 |

סודות: אפס נחשף — רק כתובות-ציבוריות ו-txid-ציבוריים.

---

## 6. פערי-תיעוד שנסגרו במסמך זה

1. **סינתזה ראשונה** של ההיסטוריה-החיה על-השרשרת מול המפוזר ב-Forensic/secret-hygiene/task-75.
2. **פענוח-payload מלא** של עוגן `saos-jumpper/v1` (כולל witness-חוצת-שרשראות) — לא הופיע בשום מקום.
3. **זיהוי חוזה-עצמי** 0xa52D85cA (creator=headcorner, ללא-אימות-מקור) — לא הופיע בשום מקום.
4. **מיפוי-מימון הסוכנים** (10×0.0002 ETH + 10×0.006 SOL) עם הוכחת-מקור מ-headcorner.
5. **אזהרת WATTOIN** — רישום-נכס-לא-רצוי עם מדיניות-איסור-מגע.

---

## 7. מדיניות WATTOIN (אזהרת-בעלים, trace 1a08e1fc1021d845)

- **זיהוי**: `WATTOIN` / "Watt2Trade" @ `0x5eef5946AD78E614bB3Ee7b9eD1097c517ae97f7`, 9 ספרות, יתרתנו 5.0; בנוסף שני "WATTOIN Receipt" מזויפים (holders 1/0) — דפוס-אבק/פתיון קלאסי.
- **קביעה**: לא נרכש על-ידינו; מקורו airdrop/העברה-חיצונית. כל-עוד לא אומת אחרת על-ידי הבעלים — **מתייחסים אליו כמתחזה**.
- **איסור-מוחלט (נאכף)**: אפס approve, אפס transfer, אפס swap, אפס חתימה-על-הודעה, אפס אינטראקציה עם החוזה. קריאת-יתרה-ציבורית לבדה מותרת (בוצעה).
- תוצאה-צפויה: נכס-מת לכל-דבר; שוואי-שווי בלבד. אין-פעולה = המדיניות הנכונה.

---

## 8. אפשרויות-בעלים (לא מבוצעות אוטומטית — תור-החלטות)

1. **המשך-עיגון ETH/SOL**: נדרש מימון-גז/SOL על headcorner + חתימה חיצונית (חוק-זהב; הפלטפורמה מוכנה — sign/broadcast דרך החותם, txid בלבד נקלט).
2. **אימות-מקור החוזה** 0xa52D85cA: העלאת-מקור/מטאדטה ל-blockscout אם קוד-המקור שרד בארכיוני-הסוכנים — משפר-אמינות העוגנים ההיסטוריים.
3. **בדיקת `0x01Bd2879Cd99…`** (יעד 0.000081 ETH): אימות-בעלים שזהו כתובת-לגיטימית מטעמו (exchange/ארנק-אישי).
4. **WATTOIN**: אין-פעולה (מדיניות §7). לעולם לא להעניק approval — אפילו לא "רק לבדוק".

---

*נמדד-חי 2026-09-11 · קריאה-בלבד · blockscout API v2 + rpc.flashbots.net + api.mainnet-beta.solana.com · אפס-מגע-בטוקנים · אפס-סודות-במסמך.*

---

# פרק-ביצוע (Task 78) — עיגון-חי ראשון על SOLANA + ETHEREUM מהמפתחות-הריבוניים

> הרשאת-בעלים מפורשת (trace 1a08e34c83694f99): "אתה רשאי להשתמש בסול לעיגון… גם איתריום סול מה שצריך להתקדם… אבל שנדע מה אנחנו עושים".
> החיפוש אחר SOL-אישי: כל נתיבי-הארנקים הסטנדרטיים (Phantom m/44'/501'/0'/0', Sollet /0'/0/i, MetaMask m/44'/60'/0'/0/i) משני ה-mnemonic-ים השמורים (tron-mnemonic + security-wallet-legacy) — **12 כתובות-SOL + 10 כתובות-ETH: הכל ריק על mainnet** (יתרה 0 + אפס-היסטוריה). ה-SOL הזמין = דאסט הסוכנים (10×0.006 + 0.000815) — והוא מספיק (עמלת-memo 0.000005/tx ≈ 1200 עוגנים לכתובת).

## מה בוצע (נמדד-חי 2026-09-11, חותם h15 root `f5ce4952…`)

| רשת | מחותם | txid | סטטוס |
|---|---|---|---|
| SOLANA | ynet | `4PfUv42vNJTF8NswPdA3KNFuyPerFUA2waFqQwzVtxs6jD2hgaarEXtXX7KDqyDkxFmyW5drUKD9Sd2zxYyTMyPi` | **recorded+anchored** (slot 446041776, finalized; memo=`saos.weave.v1` h15) |
| SOLANA | haran | `2ucCSpx26K6doC8MP8u2FXm2tg3bvp2e1KC3ktyaHwZs5yyFgyShcs5RfmEHjRwp3Hk9ctpPTchffWWhb1isNAHP` | recorded (slot 446041819) |
| ETHEREUM | ynet | `0x806de2934b2985d7dad77e9ad94f76e042dcc6b4930db43aef64078359e15df7` | **recorded+anchored** (block 25951133; calldata=root+height) |
| ETHEREUM | haran | `0xac428bf0c4b566c81c1a7f19c69f3055eb75e3106a20cb970cae287701e4cd6c` | recorded (block 25951134) |

עוגנים-נוספים על-השרשרת (טרם-התיקון, רישום-פלטפורמה נחסם עקב הבאג — קיימים כראייה ציבורית):
- SOL ynet `2AKXEHoMRBbv…ocUKNRvVozNouusZj1gXb3f7g5` (slot 446040933 — **עוגן-ה-SOL החי הראשון של העידן**) · SOL ynet `67ceJYYwXz37…Aa1fbG8` · SOL haran `3oJmuGEAX4qE…1hgmmhowK`
- שריפת-עמלות מצטברת: ≈0.000015 SOL + ≈0.000009 ETH — אבק, מתוך הדאסט שהוקצה לזה.

## תוצאות-פלטפורמה

- **חותם h15: 4/6 רשתות נעוגנות** — STEEM ✓ BLURT ✓ **ETHEREUM ✓ SOLANA ✓** (HIVE=RC-floor, TRON=energy-0).
- כרטיסי-הרשת ETH/SOL: `lastVerifiedAnchor` חי, `isReadyForAnchor=true`, `isDryRunOnly=false`, blocker=null — האמת החדשה מוצגת.
- נתיב-חדש `POST /api/saos/anchor-ingest` (auth, rate-limit, audit): קליטת עוגן-חוץ — השרת מאמת מחדש את ה-txid מול RPC-ציבורי (verifyTxidPublic) לפני שום-כתיבה; מילוי-CAS של שורת-הכוונה מבלי לדרוס txid קיים; סירוב-כנה ללא-אימות.

## באג-P0 שנתפס-חי ותוקן

**הרעלת-אידמפוטנטיות ב-POST /api/saos/signer**: שאילת-ההמשך (`sealId+network+txid:null+signerStatus:"awaiting-approval"`) לא סיננה סטטוסים-סופיים — שורת-drill שבוטלה-ידנית (מהדרילים של 10/09) החזירה עצמה לנצח מכל POST חדש לאותו (seal,network), וכל PATCH נדחה "מצב-סופי". נמדד-חי: שני POSTs עוקבים החזירו את אותו `sig-4b99…` המבוטל. **תיקון**: סינון `status in [pending, awaiting-approval]` — נוסה-חי: POST מייצר שורה-חדשה, העיגון נרשם.

## שערים

tsc נקי · lint נקי · **api-check 149/0** (25 SKIP owner-held) · כל ה-txids אומתו מול mainnet (getTransaction finalized / getTransactionReceipt) · אפס-סודות-במסמך · אפס-מגע-בטוקנים (WATTOIN נשאר מוסגר).
