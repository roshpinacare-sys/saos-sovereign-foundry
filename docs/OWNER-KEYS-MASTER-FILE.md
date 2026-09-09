# OWNER-KEYS-MASTER-FILE — קובץ-האם: תיעוד מפתחות לכל המשתמשים

> **תאריך:** 2026-09-09 · **נערך על-ידי:** foundry agent · **בקשת הבעלים:** "תעשה את זה לכולם כדי שיהיה לי תיעוד דחוף"
> מסמך זה מכיל **אפס חומר-סוד** — רק מפתחות ציבוריים, סטטוסים והוראות. המפתחות הפרטיים נמצאים אך ורק בקובץ-הגיבוי המוצפן.

---

## 0. איך מורידים את הקובץ (הוראות לבעלים)

### דרך דפדפן (הכי פשוט)
1. היכנס ל-GitHub ופתח את הריפו: `roshpinacare-sys/saos-sovereign-foundry`
2. עבור לתיקייה **`backups/`**
3. לחץ על הקובץ **`key-backup-headcorner-20260909.enc`**
4. לחץ על כפתור **"Download raw file"** (סמל הורדה בראש הדף)
5. חזור והורד גם את `scripts/decrypt-key-backup.mjs` מתיקיית `scripts/`

### דרך שורת-פקודה
```bash
git clone https://github.com/roshpinacare-sys/saos-sovereign-foundry.git
cd saos-sovereign-foundry
ls backups/key-backup-headcorner-20260909.enc   # ← הקובץ שלך
```

### איך פותחים (מפענחים) את הגיבוי
```bash
node scripts/decrypt-key-backup.mjs backups/key-backup-headcorner-20260909.enc --out my-keys.json
# יידרש backup passphrase — הסיסמה נמסרה לבעלים בצ'אט (לעולם לא נשמרת בקבצים)
# הפלט: my-keys.json עם כל המפתחות הפרטיים (mode 0600 — מחקו אחרי שימוש!)
```
- הפורמט: `SAOS-KEY-BACKUP-1` — scrypt(N=16384) + AES-256-GCM (קריפטוגרפיה סטנדרטית של Node.js, עובד אופליין)
- הסיסמה **נמסרה לבעלים בצ'אט בלבד** — לא בקובץ, לא בריפו, לא בלוגים
- אם הסיסמה אבדה: אין דרך לפענח — פשוט יוצרים גיבוי חדש (POST /keys/backup) עם סיסמה חדשה

---

## 1. מצב כללי (נמדד חי, 2026-09-09 06:29 UTC)

| רכיב | סטטוס |
|---|---|
| external-signer (:3033) | ✅ חי, v2.3.0, fail-closed, authority-gate פעיל |
| מעטפת חתומה (SAOS-FLEET-VAULT-1) | ✅ אטומה — sealedAt `2026-09-09T03:46:07Z`, שום מפתח לא נמחק |
| חשבונות טעונים במעטפת | 11 (ראשי headcorner + 10 צי) |
| גיבוי מוצפן בריפו | ✅ `backups/key-backup-headcorner-20260909.enc` — כולל owner+active+posting+memo לראשי, ו-active+posting+owner לכל הצי, שתי הרשתות |
| אימות גיבוי | ✅ נבדק בסבב מלא (יצירה → פענוח → תקינות JSON) ב-06:29 UTC |

---

## 2. טבלת כל המשתמשים — סטטוס שליטה בפועל

**מקור האמת:** סריקה חיה מול השרשרת (get_accounts → owner/active/posting/memo) × כל המפתחות שבידינו, 2026-09-09 06:00 UTC.

| # | חשבון | מפתחות בגיבוי | שליטה-חיה STEEM | שליטה-חיה HIVE | מה דרוש |
|---|---|---|---|---|---|
| 1 | **headcorner** (ראשי) | ✅ posting+active+owner+memo (ישנים) | ❌ סובב 21:17:33 | ❌ סובב 21:17:42 | **seed SAOS-ROT1** (אצל הבעלים/סוכן saos-dex) → הדבקה → שחזור מלא |
| 2 | cashmachine | ✅ active+posting+owner | ❌ | ✅ **מלא — כל 4 התפקידים** | כלום — שליטה מלאה היום |
| 3 | haran | ✅ active+posting+owner | ❌ | ✅ **מלא** | כלום |
| 4 | israelnews | ✅ active+posting+owner | ❌ | ✅ **מלא** | כלום |
| 5 | lsa | ✅ active+posting+owner | ❌ | ✅ **מלא** | כלום |
| 6 | macrame | ✅ active+posting+owner | ❌ | ✅ **מלא** | כלום |
| 7 | siq | ✅ active+posting+owner | ❌ | ✅ **מלא** | כלום |
| 8 | tov | ✅ active+posting+owner (ישנים) | ❌ | ❌ סובב 21:34 | seed SAOS-ROT1 (אותו seed של headcorner) |
| 9 | wic | ✅ active+posting+owner (חדשים) | ❌ | ✅ **מלא** (מפתח-חדש במעטפת) | כלום |
| 10 | wog | ✅ active+posting+owner | ❌ | ✅ **מלא** | כלום |
| 11 | woq | ✅ active+posting+owner | ❌ | ✅ **מלא** | כלום |
| 12 | ynet | ❌ לא במעטפת | ❌ סובב 04.09 | ❌ סובב 04.09 | חומר מקורי של ynet (FACTORY_MASTER אבד — מתועד) |

**סיכום:**
- **HIVE: 9/11 חשבונות בשליטה-מלאה מאומתת-חי** (cashmachine, haran, israelnews, lsa, macrame, siq, wic, wog, woq)
- **STEEM: 0 התאמות** — כל מפתחות-ה-STEEM שבידינו הוחלפו-על-השרשרת (דליפה שנאטמה ב-SETTLE-10); דרוש חומר חדש
- **headcorner + tov:** המפתחות-החדשים קיימים — עץ `SAOS-ROT1/<acct>/<chain>/<role>` מ-seed אחד של 64-hex, שמור אצל סוכן saos-dex (כספת `saos-dex/agent/keys/fleet_keys.enc` מ-2026-09-09 00:08) + גיבוי אצל הבעלים בצ'אט השני
- **ynet:** דרוש חומר מקורי של החשבון

---

## 3. הרשויות-החיות של headcorner (מפתחות ציבוריים — לאימות עצמי)

```
STEEM: owner=STM6p6ZNW7jHCR6cCG6rBavKjW6JGsjjebHemjPGgg5RmekWtm6KZ
       active=STM5beptA4oKZVuj5Q7KANrXNdgYFjN13VRnxrGe7834DNpehzpgX
       posting=STM6UBp98qFGJZtazSxb1GgGoLjJTgyvZJTJ7pD3zfAvxQudAgqBo
HIVE:  owner=STM8mSbBz8zsMfBow2xa1yfTuNhdp6KZf3v7kAs1BSQAB1AMQM1Fw
       active=STM8c9vp3hUnNsXHaWLPTpcYWkPpK5GrnySgN51FiGX9dxhwVz8YZ
       posting=STM6u99ogJKojfZC94VCs73N3wVRxnm9XTjVSmkSm2BE59yDEuH6b
```
כל מי שמחזיק את ה-zipor (seed 64-hex) יכול לוודא: הגזירה `SAOS-ROT1/headcorner/<chain>/<role>` תניב בדיוק את המפתחות-הציבוריים האלה.

---

## 4. דרך-השחזור של headcorner (רץ עכשיו — external-signer v2.3.0)

1. הבעלים מאתר את **ה-zipor של SAOS-ROT1** (64 תווים hex) — אצל סוכן saos-dex בצ'אט השני, או בגיבוי שקיבל באותו צ'אט.
2. מדביק אותו ב**מסך-הבקרה → אבטחה → כרטיס "מפתח-בעלים"** (כל שדה מקבל גם seed) — או בצ'אט כאן.
3. ה-signer גוזר את **כל העץ** (headcorner/tov/wic/צי × STEEM/HIVE × owner/active/posting/memo), מאמת מול **הרשויות-החיות**, וכותב רק התאמות (verify-then-write, fail-closed).
4. המעטפת נאטמת מחדש — headcorner חוזר לשליטה-מלאה, הפייפליין (power-up 9.682 HIVE + עיגוני STEEM) משתחרר.
5. נוצר גיבוי חדש ומלא — מחליף את הקובץ הנוכחי.

---

## 5. קבצים בריפו (המפה המלאה)

| קובץ | תוכן |
|---|---|
| `backups/key-backup-headcorner-20260909.enc` | **הגיבוי המוצפן** — כל המפתחות שבמעטפת (SAOS-KEY-BACKUP-1) |
| `scripts/decrypt-key-backup.mjs` | מפענח אופלייני (Node.js סטנדרטי) |
| `docs/OWNER-KEYS-MASTER-FILE.md` | המסמך הזה |
| `docs/PROMPT-FOR-ALL-AGENTS.md` | הפרומט שהבעלים שולח לכל הסוכנים |
| `docs/KEY-RECOVERY.md` | פורנזיה מלאה: מה קרה, מתי, ומי סובב |
| `docs/keys-access.md` | חוזה הגישה-למפתחות לכל סוכן (iron rules) |
| `agent/lib/keys-access.cjs` | כלי סוכנים: status / health / sign (רק דרך ה-signer) |

---

## 6. כללי-ברזל (מחייב כל סוכן — §13)

1. אף מפתח פרטי לעולם לא נכנס לריפו — רק קבצים מוצפנים ומעטפות חתומות.
2. אף מפתח לא נדפס בצ'אט/לוגים — רק מפתחות ציבוריים ופסיקות התאמה.
3. חתימות רק דרך external-signer :3033 — לעולם לא העתקת חומר-מפתח.
4. `fleet_keys.meta.json` (מכיל מפתח-הפעלה של הכספת) — **אסור** לדחוף לריפו.
5. סיסמאות-גיבוי עוברות **רק בצ'אט עם הבעלים** — לא בקבצים.
6. לעולם לא force-push ולא מחיקת היסטוריה.

---

## 7. לוג עדכונים

- **2026-09-09 06:29 UTC** — גיבוי חדש עם סיסמה-חדשה (הקודם: סיסמה לא הגיעה לבעלים); אימות פענוח מלא; מסמך זה + פרומט לכל-הסוכנים נדחפו לריפו.
- **2026-09-09 06:00 UTC** — סריקת-מפתחות מלאה: 9 חשבונות בשליטת-HIVE-מלאה; headcorner/tov ממתינים ל-SAOS-ROT1.
- **2026-09-08 21:17 UTC** — סיבוב-מפתחות על-השרשרת על-ידי saos-dex (SETTLE-10).
