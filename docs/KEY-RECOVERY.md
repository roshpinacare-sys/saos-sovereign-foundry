# KEY RECOVERY — תיעוד מלא של מצב-המפתחות ודרך-השחזור (Task 30, 2026-09-09)

> מסמך זה הוא **התיעוד הריבוני** שביקש הבעלים: מה קרה, מתי, מי, ואיך מתחברים חזרה.
> במסמך **אין שום חומר-סוד** — רק מפתחות ציבוריים (STM…), חותמות-זמן ותוצאות בדיקה.

---

## 1. מה קרה בפועל (פורנזיה מהשרשרת — לא השערות)

המפתחות **לא נמחקו** מהמערכת שלנו. הם **הוחלפו על-השרשרת** על-ידי סוכן saos-dex
במהלך `SETTLE-10` (קומיט `96db4e5` בריפו saos-dex — "live key rotation — new seed
installed, leaked keys revoked on-chain"). ציר-זמן מאומת מהיסטוריית החשבונות:

| תאריך (UTC) | חשבון | רשת | שינוי | עדות |
|---|---|---|---|---|
| 2026-09-04 07:42:27 | ynet | STEEM | owner+active+posting+memo הוחלפו | account_update בהיסטוריית השרשרת |
| 2026-09-04 07:42:36 | ynet | HIVE | כנ"ל | account_update בהיסטוריית השרשרת |
| 2026-09-08 21:17:33 | **headcorner** | STEEM | owner+active+posting הוחלפו (חתימה אחרונה של מפתח-ה-owner הקודם) | STEEM tx 8313cdcb… block 109,410,651 |
| 2026-09-08 21:17:42 | **headcorner** | HIVE | כנ"ל | HIVE tx 92654439… block 109,745,168 |
| 2026-09-08 21:34:06/15 | tov | STEEM+HIVE | owner+active+posting הוחלפו | account_update בהיסטוריית השרשרת |
| 2026-09-08 ~21:40 | wic | (צי) | הוחלף | tx 9fd13d50… (SETTLE-10) |

**הסכמה החדשה (מתוך הודעת הקומיט SETTLE-10):**

```
מפתחות חדשים = עץ HMAC-SHA256 מ-zipor (seed) אחד של 64-hex:
  SAOS-ROT1/<account>/<chain>/<role>
הסודות חיים רק ב: .env (gitignored) של סביבת ה-saos-dex agent
                  + גיבוי אצל המפעיל (הבעלים) — בצ'אט שבו הסוכן ביצע את הסיבוב
אפס סודות בריפו/לוגים
```

## 2. מצב-השליטה הנוכחי (נמדד חי מול השרשרת, 2026-09-09 06:00)

### שליטה מלאה — 9 חשבונות צי ב-HIVE (owner+active+posting+memo מאומתים חי):
`cashmachine · haran · israelnews · lsa · macrame · siq · wic(חדש) · wog · woq`
- המפתחות האלה אצלנו במעטפת החתומה (`/tmp/agent-audit/steem/agent/fleet_keys.enc`)
- כל הפעולות שלהם עוברות דרך external-signer :3033 (authority-gate)

### ממתין ל-zipor SAOS-ROT1 (המפתח אצל הבעלים בצ'אט השני):
| חשבון | סטטוס | מה דרוש |
|---|---|---|
| **headcorner** | הרשויות-החיות = עץ SAOS-ROT1; המפתח אצל ה-saos-dex agent + הבעלים | **הדבקת ה-zipor (64-hex) או שורות ה-WIF מהצ'אט השני** |
| tov | כנ"ל (סובב ב-SETTLE-10) | כנ"ל — אותו zipor |
| wic | סובב ל-SETTLE-10 | כנ"ל — אותו zipor |
| ynet | נגזר מ-FACTORY_MASTER שאבד (5×אבד-ב-sandbox בתיעוד הריפו) | דרוש חומר מקורי של ynet — ה-zipor החדש לא יגזור אותו |

### הרשויות-החיות הנוכחיות של headcorner (ציבורי):
```
STEEM: owner=STM6p6ZNW7jHCR6cCG6rBavKjW6JGsjjebHemjPGgg5RmekWtm6KZ
       active=STM5beptA4oKZVuj5Q7KANrXNdgYFjN13VRnxrGe7834DNpehzpgX
       posting=STM6UBp98qFGJZtazSxb1GgGoLjJTgyvZJTJ7pD3zfAvxQudAgqBo
HIVE:  owner=STM8mSbBz8zsMfBow2xa1yfTuNhdp6KZf3v7kAs1BSQAB1AMQM1Fw
       active=STM8c9vp3hUnNsXHaWLPTpcYWkPpK5GrnySgN51FiGX9dxhwVz8YZ
       posting=STM6u99ogJKojfZC94VCs73N3wVRxnm9XTjVSmkSm2BE59yDEuH6b
```

## 3. דרך-השחזור (פועל עכשיו — external-signer v2.3.0)

1. הבעלים מאתר בצ'אט-השני (שבו רץ סוכן ה-saos-dex) את **ה-zipor של SAOS-ROT1**
   (מחרוזת 64 תווים hex) או את שורות `STEEM_ACTIVE_WIF` / `HIVE_ACTIVE_WIF`.
2. מדביק ל**מסך-הבקרה → אבטחה → כרטיס "מפתח-בעלים"** (כל שדה מקבל גם zipor!).
3. ה-signer מגזר את **כל העץ** (`SAOS-ROT1/<acct>/<chain>/<role>` × headcorner/tov/wic/צי),
   מאמת כל מפתח מול **הרשות-החיה**, וכותב **רק התאמות** (verify-then-write, fail-closed).
4. המעטפת נאטמת מחדש, ה-signer נטען מחדש — והפייפליין (power-up 9.682 HIVE, עיגונים)
   משתחרר מיד.

## 4. גיבוי מוצפן (מה שכן בידינו — נשמר בריפו)

- קובץ: `backups/key-backup-headcorner-20260909.enc`
- פורמט: `SAOS-KEY-BACKUP-1` — scrypt(N=16384) + AES-256-GCM
- מכיל: כל המפתחות שבמעטפת בעת היצירה (הצי החי-ב-HIVE + ה-slotים של headcorner)
- **הסיסמה נמסרה לבעלים בצ'אט** (ולא נשמרת בשום קובץ!)
- פענוח:
  ```bash
  node scripts/decrypt-key-backup.mjs backups/key-backup-headcorner-20260909.enc --out recovered.json
  ```
- לאחר הדבקת ה-zipor ייווצר גיבוי חדש הכולל גם את headcorner — ויחליף את הקובץ.

## 5. כללי-ברזל (חוזה key-safety §13 — מחייב כל סוכן)

1. **אף מפתח פרטי לעולם לא נכנס לריפו** — רק קבצים מוצפנים (SAOS-KEY-BACKUP-1) ומעטפות חתומות.
2. **אף מפתח לא נדפס בצ'אט/לוגים** — רק מפתחות ציבוריים ופסיקות התאמה.
3. כל סוכן (הצ'אט הזה וכל צ'אט אחר) מבצע פעולות-חתימה **רק דרך external-signer :3033**
   (Bearer מ-`~/.secrets/external-signer-token`, 0600) — לעולם לא מעתיק חומר-מפתח.
4. שינוי-הרשאות (rotation) מותר **רק** באישור-מפורש של הבעלים + תיעוד מיידי כאן.
5. העברת מפתחות בין סוכנים: רק דרך המעטפת החתומה או גיבוי מוצפן — לא דרך צ'אט/קבצים חשופים.

## 6. מה נבדק ונשלל (כדי שלא נחפש שוב)

- ההדבקה של הבעלים (29-b): לא WIF, לא סיסמת-אב, לא sha256 — **אינה** גוזרת אף רשות-חיה
  של אף חשבון (11 חשבונות × 2 רשתות × 4 תפקידים). אינה גם מפתח ישן שלנו (לא מופיע
  בהיסטוריית headcorner/tov). שייכת כנראה לחשבון אחר/סיסמת-הרשמה קדומה.
- כל הכספות בדיסק (zip 6.9 / guardian 19:55 / work-25-d 22:55 / חיה / repo 05:34) —
  **43 מפתחות זהים**; אף אחד מהם אינו תואם את רשויות headcorner/tov הנוכחיות.
- `wallets-seed.json` (SOVEREIGN ROOT, 96 תווים) — גוזר את ארנקות EVM/TRON/SOL/BTC
  (registry 05:32) — **לא** את מפתחות STEEM/HIVE.
- FACTORY_MASTER: אבד (מתועד 5×ב-verify_system) — גזירת ynet (4.9) אינה שחזירה ממנו.
