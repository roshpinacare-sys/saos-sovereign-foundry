# עדות — תקרית-ynet ועוגן-החילוץ החי (Task 70, 2026-09-10 UTC)

> **הנחיית-הבעלים** (trace 1a08d489fce57289): "אין לי את המפתח הוא שונה… בלעדיו תמצא פתרון לזה — תמשיך ודחוף."
> הבעלים אינו-מחזיק את סיסמת-ynet הנוכחית. המשימה: לחבר/להפעיל את ynet בלעדיה.
> **עיקרון**: אפס-הדפסת-סודות; כל-הבדיקות fail-closed; כל-המסקנות מהשרשרת החיה או מעדויות-משוחזרות.

## 1. מצב-השרשרת-החי של ynet (נתונים-ציבוריים)

| עובדה | STEEM | HIVE |
|---|---|---|
| `last_owner_update` | 2026-09-04T07:42:27 | 2026-09-04T07:42:33 |
| owner/active/posting/memo | STM7s5gVtC… / STM4tXiBSD… / STM6YhgKFL… / STM5TJngAd… | **זהים-בייט** (STEEM≡HIVE) |
| `recovery_account` | `steem` (רשמי — לא-שלנו) | `steem` |
| owner_history prev | STM86gwPfu… | STM86gwPfu… |
| posting `account_auths` | `headcorner:1 · steemauto:1` (threshold=1) | **זהה** |

- הסבת-ynet בוצעה 04-09 בסקריפט (פער-6-שניות-בין-השרשראות) — **4-ימים-לפני** רוטציית-SETTLE-10 של-שאר-הצי (08-09 21:17–21:35). ynet הוא-היוצא-מן-הכלל.
- מסלול-`recover_account` **מת**: דורש את חשבון-ההתאוששות (`steem` הרשמי) — לא-בשליטתנו.

## 2. הראיה-המכריעה — rotation_evidence.json (מהזיפ-המשוחזר, מעולם-לא-נקרא)

`~/.secrets/keys-restored/agent/rotation_evidence.json` (נוצר 2026-09-04T07:42:27Z ע"י-כלי-המפעיל):

- `derivedFrom: "FACTORY_MASTER"` · `scheme: "sha256(username+role+password) via steem-js getPrivateKeys"` — **המפתחות-החיים-הנוכחיים-של-ynet נגזרים-דטרמיניסטית מסיסמת-מפעל אחת**.
- `before`: owner=STM86gwPfu… (זהה-ל-prev-בשרשרת) · `after`: owner=STM7s5gVtC… (זהה-לחי).
- `accountAuthsPreserved.posting: [["headcorner",1],["steemauto",1]]` — **עוגן-החילוץ שהמפעיל שמר-בתוך-רשות-ה-posting של ynet**.

## 3. מה-שבידינו-ומה-שאבד

- **Ynet.txt** (52 תווים, P-format, מהזיפ): גוזר את מצב-**לפני**-ההסבה — owner == STM86gwPfu… **אומת-offline 4/4-מול-ה-`before` שבעדות**. זו סיסמת-המפעל-הקודמת; אינה-גוזרת את-החי.
- **FM1** (סיסמת-המפעל-הנוכחית) — חי-רק ב-`agent/.env` של-סנדבוקס-המפעיל (נמחק; "אבד 5×" לפי-תיעוד-הריפו). מקורות-שנבדקו-ולא-מכילים אותו:
  - ריפו-המפעיל `roshpinacare-sys/steem` — שיבוט-מלא; `agent/factory_v2.cjs`/`verify_system.cjs` מגלים ש-FM נטען-מ-`.env` בלבד; בשום-בלוב-שנסרק אין `FACTORY_MASTER=`.
  - **master_blast_report.json** (02:04Z 09-10, מטעם-המפעיל-עצמו): 5,877 מועמדים × 282,096 בדיקות מול-96-הפומביות-החיות **כולל-8-סלוטי-ynet** → `hits: []`.
  - סוויפ-עצמאי-שלנו: כל-טוקני-הד.txt (כולל-8-מפתחות-K/L-דחוסים-שפוענחו-ידנית + 256-וריאנטי-HMAC של-זרע-ROT1), סריקת-124.8MB-של-1,068-קבצים-מקומיים (102-WIF + 5,970-hex64 + 0-סיסמאות-P) — **אפס-התאמות-מול-8-הפומביות-החיות-של-ynet**.

## 4. הפתרון בלעדי-המפתח — העוגן-החי (נמדד-ומוכח-בשרשרת)

רשות-ה-posting של ynet (threshold=1) כוללת את **headcorner** כ-account_auth — ומפתח-ה-posting-החי של headcorner נמצא-אצלנו (STEEM 4/4 · HIVE 4/4, Task 69). חתימת-ה-posting של headcorner מקיימת את רשות-ynet.

**הוכחה-אנד-אנד** — `custom_json` (id=`saos-ping`, payload=`ynet-posting-plane-via-headcorner-anchor`) שודר-בשם-ynet חתום-במפתח-ה-posting של headcorner:

| שרשרת | בלוק | txid |
|---|---|---|
| HIVE | 109,803,966 | `3d7ac3f419eb81349fa6e8eca1bdce689612fbe2` |
| STEEM | 109,469,365 | `12f1270ded36a01c7b3a3f12bbadc6f5f16f5423` |

שניהם-אומתו-ב-`get_account_history` של-ynet (op=`custom_json`, id=`saos-ping`).

**גילוי-נלווה**: ynet כבר-תחת-זרם-`saos`-custom_json-מתמשך-בשתי-השרשראות (הדמונים-של-המפעיל-משתמשים-באותו-עוגן) — ynet מעולם-לא-היה-זומבי; **מישור-הפוסטינג שלו חי-וזמין-לנו עכשיו, בלי-שום-מפתח-ישיר**.

## 5. שינויי-קוד (נגזר-או-שתיקה)

- **signer v2.4.5** — `steemPlaneProbe`: שדה-נגזר `postingAnchor: {STEEM, HIVE}` לכל-חשבון (האם-החשבון-הראשי-שלנו-יושב-ב-account_auths של-ה-posting במשקל-≥-threshold) + `summary.postingAnchoredGaps`. נתונים-ציבוריים-בלבד; שום-מפתח-לא-נוגע.
- **מסך (overview-tab)** — תג-`עוגן-פוסטינג-חי (headcorner)` לשורות-עם-פער-שיש-להן-עוגן; תג-`STEEM≡HIVE` נוטרל-מטענה-המיושנת.
- **keys-map** — תיקון-טענה-שגויה (ynet **כן** סובב 09-04 — לא "לא-סובב-מאז-2018"); משפט-העוגן נגזר-מהשדה-החי.

## 6. מה-נותר-פתוח

- **סלוטי-המפתחות של ynet (STEEM+HIVE × 4)** בכספת — נסגרים-כולם **בהדבקה-אחת** של סיסמת-המפעל-הנוכחית (FM1) או של כל-מפתח-חי (אוניברסלי-paste, verify-then-write fail-closed). עד-אז: פעולות-פוסטינג זמינות-דרך-העוגן; פעולות-active/owner (העברות, claim, delegate) — חסומות-עד-המפתח.
- Ynet.txt (סיסמת-המפעל-הקודמת) נשמר-כחומר-משמורת (היא-רשות-ה-owner-האחרונה-של-ynet — הערך: עדות-ושחזור-עידן).

## 7. היגיינה

אפס-חומר-סוד-בלוגים/גיט/צ'אט · כל-קבצי-המועמדים-ב-/tmp (0600) גרוסו-shred×3-בתום-העבודה · אפס-force-push · דחיפה-דרך-askpass-ונמחקה-בתום-האימות.
