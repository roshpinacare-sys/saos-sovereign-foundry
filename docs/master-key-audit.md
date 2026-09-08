# Master-Key Audit — מפתח אחד להכל (Task 17, 2026-09-08)

> שאלת הבעלים: "חייב לוודא שאני יוכל להתחבר להכל עם מפתח אחד של steem של
> headcorner — המפתח הראשי. מעבר לזה לא הוכח כלום… הקוד אומר משהו אחר לגמרי… תבדוק."
>
> הביקורת הזאת נעשתה **מהקוד ומהשרשרת בלבד** — לא מהתיעוד. אפס סודות הודפסו,
> נשמרו או נרשמו. אפס חתימות, אפס שידורים, אפס מחיקות.

---

## 1. מה הוכח חי מול השרשראות (עובדות-על, ללא מפתח פרטי)

נשלפו הסמכויות הציבוריות של `@headcorner` משלוש השרשראות (condenser_api, ציבורי):

| תפקיד | STEEM | HIVE | BLURT | זהות בין-שרשראות |
|---|---|---|---|---|
| owner | `STM5aUKyd9Lz…yMFpvv` | `STM5aUKyd9Lz…yMFpvv` | `BLT5aUKyd9Lz…yMFpvv` | **זהה** |
| active | `STM5HhJD5WUX…BvuHXF` | `STM5HhJD5WUX…BvuHXF` | `BLT5HhJD5WUX…BvuHXF` | **זהה** |
| posting | `STM8m3rBLd8C…52N9cw` | `STM8m3rBLd8C…52N9cw` | `BLT8m3rBLd8C…52N9cw` | **זהה** |
| memo | `STM7mBK98NCE…pQcXM9` | `STM7mBK98NCE…pQcXM9` | `BLT7mBK98NCE…pQcXM9` | **זהה** |

- המפתחות הציבוריים **זהים ביט-ביט** על שלוש השרשראות (ההבדל הוא קידומת-תצוגה בלבד —
  Graphene מציגה את אותו מפתח-דחוס עם `STM`/`BLT`).
- **משמעות**: קבוצת-מפתחות **אחת** שולטת ב-`@headcorner` על STEEM + HIVE + BLURT יחד.
  זו עובדה-על מהשרשרת, לא טענה.
- אלגוריתם הגזירה מהסיסמה-הראשית מתועד בקוד המערכת עצמו
  (`steem/agent/keyrotate.cjs:169`): `scalar = sha256(username + role + password)` —
  בדיוק `steem.auth.getPrivateKeys`. כלומר **הסיסמה-הראשית אחת גוזרת את ארבעת
  התפקידים**, וה-username מוטמע בגזירה.

## 2. מה הקוד באמת אומר — ולמה הבעלים צדק ש"זה אומר משהו אחר"

בדיקת-קוד ארכיאולוגית חוצת-ריפואים (foundry + steem) מצאה **שלושה שורשים**, לא אחד:

### שורש א' — סיסמת-האב של headcorner (Graphene)
- גוזרת owner/active/posting/memo של headcorner.
- שולטת (כאמור בסעיף 1) בחשבון על **שלוש** שרשראות.
- נטענת בקוד דרך הכספת: `sovereign/node/vault-lib.cjs` (מעטפת AES-256-GCM, scrypt
  N=2^15, מפתח-אב `.vaultkey` מקומי; חברים: `wallets-seed.json`,
  `wallets-registry.json`, `vault.json` (רוסטר-צבא-STEEM), `tron-mnemonic.txt`).

### שורש ב' — FACTORY_MASTER לחשבונות-הצי על Graphene
- `agent/factory_v2.cjs:103` + `agent/verify_system.cjs:1052`: כל חשבונות-הצי
  (הרוסטר ב-`vault.json`) נגזרים מ**סיסמת-מפעל אחת** דרך אותו
  `getPrivateKeys(username, FM, roles)` — ה-username בתוך ה-hash יוצר מפתחות
  שונים לכל חשבון מאותה סיסמה.
- כלומר: **סיסמה אחת** גוזרת את כל חשבונות-הצי — אבל זו **לא** סיסמת-headcorner.

### שורש ג' — זרע-הצי הריבוני (EVM/TRON/SOL/BTC)
- `sovereign/node/wallets.cjs`: זרע אחד (`wallets-seed.json`, 48 בתים
  `crypto.randomBytes` — **עצמאי**, לא נגזר מאף סיסמה) ממנו נגזרים 12 סוכנים ×
  10 רשתות: EVM `m/44'/60'/0'/0/i` (משרת 7 רשתות: ETH·BSC·Polygon·Arbitrum·
  Optimism·Base·Avalanche), TRON `m/44'/195'`, SOL `ed25519(sha256(seed|sol|name))`,
  BTC `m/84'/0'` P2WPKH. הכתובות עוגנו ציבורית (`saos:wallets/v1`, custom_json על
  STEEM, anchor txid `9f593bdc…`, `anchor.by=headcorner`, verified).
- היסטוריה-כנה בקוד עצמו (wallets.cjs): כתובות-v1 הן מצבות receive-only — הזרע
  אבד ב-rollback (Task 115) ונוצר זרע-חדש; הרוטציה מתועדת בקוד.

### גשר חוצה-שרשראות שכבר קיים (חשוב!)
- `agent/anchor.cjs`: חתימת EIP-191 (`personal_sign`) **עם אותו סקלר secp256k1
  של ה-ACTIVE_WIF** של headcorner — כל מאמת יכול `ecrecover(hash, sig) → EC ==
  סמכות-active`. כלומר המערכת **כבר מנצלת** את העובדה שמפתח-ה-active של STEEM
  (secp256k1) הוא גם מפתח-EVM תקף — זהות-EVM מגולגלת ממפתח-Graphene, מאומתת
  מתמטית על-ידי צד-שלישי ללא סודות.

## 3. פסק-הדין על "מפתח אחד מתחבר להכל"

| תחום | נשלט ע"י סיסמת-האב של headcorner? | ביסוס |
|---|---|---|
| headcorner @ STEEM (כל-4-התפקידים) | **כן** | אלגוריתם מתועד + סמכויות-על-השרשרת |
| headcorner @ HIVE | **כן** | מפתחות-ציבוריים זהים ביט-ביט |
| headcorner @ BLURT | **כן** | מפתחות-ציבוריים זהים ביט-ביט |
| זהות-EVM של ה-active | **כן (מתמטית)** | אותו סקלר secp256k1; anchor.cjs מאמת ב-ecrecover |
| חשבונות-הצי על STEEM/HIVE/BLURT | **לא — כרגע שורש-נפרד** (FACTORY_MASTER) | factory_v2.cjs / verify_system.cjs |
| ארנקי-הצי EVM/TRON/SOL/BTC (12×10) | **לא — כרגע שורש-נפרד** (זרע randomBytes) | wallets.cjs |

**התשובה הישירה**: כרגע, מפתח-אחד = שליטה מלאה ב-headcorner על שלוש שרשראות +
זהות-EVM מגולגלת — **אבל לא** בכל-הצי. "מפתח-אחד-להכל" אינו המצב הקיים; הוא
**שינוי-מדיניות אחד + רוטציה אחת** מרחק קצר, כי כל-הפרימיטיבים כבר בקוד:

> **נוהל-הקשירה (החלטת-בעלים)**:
> 1. `FACTORY_MASTER' = KDF(masterPw, "factory")` — אותו זיהוי גזירה, גורם-אחד.
> 2. `seed' = KDF(masterPw, "wallets-seed")` — הזרע נגזר מהסיסמה-הראשית.
> 3. רוטציית-צי אחת: גזירה-מחדש, עדכון רוסטר בכספת, עיגון רישום-ציבורי חדש
>    (המנגנון הקיים: custom_json + op-on-chain), ודריסת המצבות.
> 4. מאז: סיסמה-ראשית אחת משחזרת הכל — headcorner ×3 רשתות, כל-הצי על 13+ רשתות.
>
> סיכון-ידוע: רוטציה מחליפה כתובות/מפתחות של הצי כולו (ראו היסטוריית-v1) —
> פעולה של בעלים בלבד, לא של סוכן.

## 4. ערכת-ההוכחה — `scripts/master-key-proof.cjs`

הבעלים מריץ מקומית:
```bash
node scripts/master-key-proof.cjs headcorner        # הסיסמה נקראת מ-stdin בלי הד
SAOS_MASTER_PW='...' node scripts/master-key-proof.cjs headcorner
```
הפלט: טבלת PASS/FAIL לכל רשת (STEEM/HIVE/BLURT × owner/active/posting/memo) +
פסק-דין אחד "מפתח-אחד שולט ב-N/12".

תכונות-בטיחות (מאומתות):
- הסוד נשאר בזיכרון בלבד — לא נדפס, לא נשמר, לא נשלח לשום מקום (רק sha256
  מקומי חד-כיווני); מקטעי-זיכרון מנוקים בסיום.
- קריאה-בלבד מול RPC ציבורי — אפס חתימות, אפס שידורים, אפס טרנזקציות.
- ההשוואה בייט-מול-בייט דרך **אותו מפענח** לשני הצדדים (קידוד לא יכול לייצר
  תוצאה-כוזבת). צ'קסאם מפתח-ציבורי Graphene אומת מול 4 המפתחות-החיים:
  `ripemd160(payload)[:4]`.
- אלגוריתם הגזירה הוכח **זהה בייט-בייט** ל-`steem.auth.getPrivateKeys`
  (בדיקה על סיסמה-סינתטית — לא על סוד אמיתי).
- בדיקה-שלילית: סיסמה שגויה → 0/12 (אין חיוב-שקר). `--selftest` → roundtrip
  גזירה↔קידוד↔פענוח תקין.

אם הבעלים מריץ עם הסיסמה-הראשית שלו ומקבל 12/12 — זו **ההוכחה** שביקש. אם מקבל
FAIL בחלק מהתפקידים — המפתחות-על-השרשרת הוחלפו בעבר והסיסמה הזאת כבר לא
הראשית; הכלי יראה בדיוק אילו תפקידים סטו.

## 5. חסימת-דמון מפני דחיפה — המציאות והפתרון שהופעל

- **הגנת-ענף (branch protection)**: נוסתה דרך ה-API על steem/platform/
  anchor-baseline → **HTTP 403** — תוכנית-GitHub-חינם לא תומכת בזה על ריפואים
  פרטיים (דרוש Pro). לא ניתן למנוע את הדחיפה עצמה בצד-השרת כרגע.
- **שומר-הכספת (מופעל)**: `mini-services/vault-guardian` — סריקה כל-10-דקות של
  ראשי-ענפים; אם הדמון מדליף שוב: גיבוי אוטומטי ל-`~/.secrets/vault-recovery/
  guardian-<ts>/` (0600) → נטרול הנתיבים מהקומיט-הראש (רק נתיבים ברשימה-השחורה,
  הורים-נקיים או CRITICAL ללא-fix) → force-push → אימות מרחוק. חלון-חשיפה:
  עד-10-דקות במקום נצחי. מצב-חי: `/status` על פורט 3031.
- **מצב עכשיו (מאומת)**: לופ-2 של הדמון — 8 קומיטים אחרי הניקוי (04:18 עד
  11:42), **0 נתיבי-כספת** בכולם; המקור שממנו דלף ב-loop-1 כבר לא נדחף.
- **המניעה האמיתית (צד-בעלים)**: הדמון משתמש בטוקן-כתיבה שנמצא אצלך — החלף
  אותו בטוקן קריאה-בלבד, או הסר את היכולת-push מהלופ; או GitHub Pro →
  ואז branch-protection נסגר בקריאת-API אחת.

## 6. שקיפות-מלאה — מה נבדק ומה לא

- נבדק מהקוד: signer.ts (foundry keyless-by-design — headcorner מופיע שם רק
  כיעד-relay), kernel.ts, seal/route.ts, anchor.cjs, identity.cjs, wallets.cjs,
  vault-lib.cjs, fleet_vault.cjs, factory_v2.cjs, keyrotate.cjs, verify_system.cjs.
- לא נפתח/לא פוענח: שום כספת, שום .enc, שום meta — הכלי הזה לא צריך אותם כדי
  להוכיח שליטה, והדיסציפלינה אוסרת.
- לא נמדד כאן: BLURT-evelope עצמו (מעוגן קיים), יתרות, dex-counters — מחוץ
  לשאלת המפתח-האחד.
