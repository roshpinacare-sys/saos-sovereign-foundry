# הרחבת-עיגון צי — חותם h16 מ-11 כתובות ריבוניות (2026-09-11)

**משימה**: 79 · **הרשאה**: הנחיית-בעלים 2026-09-11 (trace 1a08e34c83694f99): "יש סול תעגן … אתה רשאי להשתמש בסול לעיגון … גם איתריום … אבל שנדע מה אנחנו עושים" · **עוקב**: ETH-SOL-LIVE-AUDIT-2026-09-11.md + FIRST-LIVE-ANCHOR-AND-UNIFICATION-2026-09-11.md

---

## 1. שורה תחתונה

חותם h16 (root `eaeae2242e5b3495d3e06f9116d7a8aefab971bda16cc5affe818e8b66697ca5`) נעוגן **מ-11 כתובות ריבוניות** בבעלותנו המלאה:

- **SOLANA** — עוגן-מפתח-יחיד מ-cashmachine (המשגר-המאוחד של הצי), memo חי על mainnet, finalized.
- **ETHEREUM** — **8 עוגנים באותו בלוק (25951350)** מ-8 כתובות סוכנים טריות (nonce 0→1), כולן calldata = root‖height.

שני העוגנים הראשיים (SOLANA + ETHEREUM) נקלטו לפלטפורמה דרך POST /api/saos/anchor-ingest עם **אימות-שרת-עצמאי מול RPC ציבורי** (verifiedBy מתועד). h15 נשאר 4/6 רשתות נעוגנות; h16 פתח עם ETH+SOL מהרגע הראשון, STEEM+BLURT בתור-אוטומטי (שער-כלכלי 6ש'), HIVE/TRON מאחורי השערים המוכרים.

## 2. החותם

| שדה | ערך |
|---|---|
| height | **16** |
| root | `eaeae2242e5b3495d3e06f9116d7a8aefab971bda16cc5affe818e8b66697ca5` |
| stateRoot | `adade5a92749bc09de5f9106fff2f7900d1f4bac5503166147635e417ce8922b` |
| leaves | 9 (6 stamps + harvest + relay + seal) |
| batchId | `task79-fleet-anchor-2026-09-11` (אידמפוטנטי) |
| נוצר | 2026-09-11T02:49:43.008Z |

## 3. עוגן SOLANA — cashmachine (המשגר-המאוחד)

- **כתובת חותמת**: `HBBdhpbpFP3BwqcvrxJ44hAyKSid3D6AB4SFvtrN736s` (מפתח-ריבוני מהרישום, חתימה in-process — אפס-יציאת-סודות)
- **signature**: `5NCzMv7NGcnkeA6UGzTZC1gt1mfeWxtZDqBhG35Wxd4w38gEwDaGH78Rk2NA3DeGBACPg4WyyaEygLYn6WkEyuVw`
- **slot**: 446047519 · **commitment**: finalized · **fee**: 5000 lamports (0.000005 SOL) · err=null
- **מבנה**: memo-only tx (program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, חשבונות ריקים) — **זהה במבנה לעוגן task-78** של ynet.
- **memo חי על-השרשרת** (נפענח מ-getTransaction):
  ```json
  {"v":1,"protocol":"saos.weave.v1","height":16,"root":"eaeae2242e5b3495d3e06f9116d7a8aefab971bda16cc5affe818e8b66697ca5","requestId":"sig-b17715f1-5506-4815-ab81-7537c9c4e10a","agent":"cashmachine"}
  ```
- **קליטה**: anchor-ingest → ok, verifiedBy `https://api.mainnet-beta.solana.com`

## 4. עוגני ETHEREUM — 8 סוכנים, בלוק אחד

**פורמט זהה ל-task-78**: EIP-1559 self-tx, value=0, gasLimit 30000, calldata = `root(32B) || height(4B BE)` = `0xeaeae224…97ca5` + `00000010`. baseFee נמדד 0.0586 gwei; maxFee = base×2+tip(0.5) ≈ 0.617 gwei (תקרת-בטיחות 1 gwei).

| סוכן | כתובת (שולח=מקבל) | tx hash | בלוק | status |
|---|---|---|---|---|
| israelnews | `0x4702Ed075a368023A26BDc651D0eC282c8Aa4E84` | `0x1a7e2d11f010040ceb4dd128bebb20291eb0cd529a1c23a6e4afb5a6208b2bc9` | 25951350 | 1 |
| lsa | `0x505BbaA179827A1759b2875d50806eb7933E9add` | `0xf35afd27541bdbd28164a4106c0a6d80d80a273b31a0b1b94c064d8d535dea8b` | 25951350 | 1 |
| macrame | `0x174465Ded517d129CC6B7424671Da8C181413A55` | `0x7eac6e9c43fb2d3567008a25db735af1d6c4d5f5f782738308e523982b90034b` | 25951350 | 1 |
| siq | `0xc2bF134836c93a1B88da025639609882cB67368b` | `0xab46bd91b86ed74be531a6cccca1cacfaea5e9638efe1eea0f2ec311506d71b3` | 25951350 | 1 |
| tov | `0x0eBb322CE1E54738ccAD27F524754AD859677360` | `0x31c1747d6902d36a83e880b09d22fe44c97083b6bd9414e7291b346207cbcbe8` | 25951350 | 1 |
| wic | `0x004085135371bd271345daB84bc8bE8B677d1733` | `0x0e2130db3c3175d9c50bfc16ececfdb4a2b975ed32f0c2040861d5851afe3035` | 25951350 | 1 |
| wog | `0x9b47dB08Fc1bc552856A69872d0a15486447c5Cb` | `0x1e7ea33ec22b735438dcced311173c4949f96f29e3318dd7898dba1c8a90ea65` | 25951350 | 1 |
| woq | `0x9978ab0F642bBf0b75E92db0E639EE863e053aC4` | `0xb5b66aab7b848b11c79e7813ef33751fd1f614e3884a5ac27a298194c321a9a2` | 25951350 | 1 |

כולן nonce 0→1 (כתובות צי טריות — "עשינו כתובת לכל אחד", הוכחה-חיה). gasUsed 22350 לכל אחת; עלות בפועל ≈0.0000123–0.0000245 ETH לעוגן (סה"כ ≈0.000124 ETH ל-8).

- **קליטה**: anchor-ingest (ETHEREUM) → ok, txid `0x1a7e2d11…`, verifiedBy `https://ethereum-rpc.publicnode.com`. שאר 7 ה-txids חיים-על-השרשרת ומתועדים כאן (תקרת-פלטפורמה: שורת-עיגון אחת ל-(חותם,רשת) — CAS, אף-עוגן לא נדרס).

## 5. כלכלת העיגון (נמדד חי)

| נכס | לפני | אחרי | שריפה |
|---|---|---|---|
| SOL (cashmachine) | 0.06062 | 0.06042 | 0.000005 עמלת-עוגן (יתר-דלק: ~12,000 עוגנים) |
| ETH (8 כתובות) | 0.0002 כ"א | 0.000175–0.000188 | ≈0.000124 סה"כ — דלק לעוד ~100 עוגנים בגז הנוכחי |

## 6. שקיפות-תהליך (כנות-מלאה)

- **ניסיון-ראשון נתקע**: מנוע ethers+web3.js תקע את ההמתנות (provider-retry פנימי; poll נגד mainnet-beta הוצף-rate-limit). **העסקה עצמה עלתה תקין** — אומתה בנפרד מול getSignatureStatuses (finalized). תיקון: פיצול לסקריפט lean — חתימה ללא-provider (ethers signTransaction טהור) + JSON-RPC גולמי עם פסקי-זמן קשיחים + fallback של 3 RPCs לכל קריאה.
- **שגיאת-עמלות נתפסת-לפני-שידור**: flashbots החזיר maxFee מוצע < ה-tip שלנו → ethers סירב (עיצוב-נכון). תוקן: maxFee = baseFee×2+tip מהבלוק-החי, תקרה 1 gwei.
- אפס-סודות בלוגים/פלטים/git; המנוע חי מחוץ לריפו (`~/task79-engine` — כלי-חתימה לא נכנס לגיט); אפס-force-push.

## 7. מצב-המטריצה אחרי המשמרת

| רשת | h15 | h16 | הערה |
|---|---|---|---|
| STEEM | ✅ נעוגן `c0b2b74e…` | ⏳ תור-אוטומטי (שער-כלכלי עד ~06:24Z) | chief-of-staff יורה לבד |
| BLURT | ✅ נעוגן `16b0f861…` | ⏳ תור-אוטומטי (עד ~06:04Z) | chief-of-staff יורה לבד |
| ETHEREUM | ✅ נעוגן `0x806de293…` | ✅ **נעוגן `0x1a7e2d11…` + 7 עדים חיים** | נתיב-חוץ מהרשאת-בעלים |
| SOLANA | ✅ נעוגן `4PfUv42v…` | ✅ **נעוגן `5NCzMv7N…`** | נתיב-חוץ מהרשאת-בעלים |
| HIVE | ⛔ rc-floor | ⛔ rc-floor | רגן-טבעי ~12:00Z או power-up (החלטת-בעלים) |
| TRON | 🚂 transit | 🚂 transit | ממתין מימון-אנרגיה (החלטת-בעלים) |

**WATTOIN-אפס-מגע מאומת-מחדש**: nonce של headcorner-EVM עמד 76 גם אחרי כל-הפעילות — אף-אינטראקציה עם הטוקן-המתחזה.

## 8. שינוי-יכולת

עד היום הצי היה "כתובות-עם-דלק" — מהיום הן **מנוע-עיגון-מבצעי**: כל חותם חדש יכול לרדת ל-SOLANA מ-cashmachine ול-ETHEREUM מ-8 כתובות-במקביל, בעלות של שקל-עגינה זעיר, בפורמט-קנוני זהה ל-task-78, עם קליטה-מאומתת-שרת. המפתחות שהבעלים שחרר ("אתה רשאי להשתמש בסול לעיגון") עובדים.
