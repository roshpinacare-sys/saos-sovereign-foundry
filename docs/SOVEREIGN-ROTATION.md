# SOVEREIGN-ROTATION — הרוטציה הקבועה: רגל-ה-foundry ברשת

> **תאריך:** 2026-09-29 · **נערך-על-ידי:** סוכן-ביקורת חיצוני (מימוש-החלטת-בעלים)
> **החלטת-בעלים:** *"להכניס את התיקייה לרוטציה הקבועה הכללית של כלל המערכת
> והריבונות והאוטונומיה של הרשת, לחזק את החלק של התיקייה ברשת"*

---

## 0. לפני / אחרי

**לפני:** ל-foundry היו שירותים-חיים מצוינים (guardian, chief, signer, fleet-cure,
key-broker) אבל **אין רישום-קבוע ברוטציה של הצי** — כל סוכן פעל מתוך-עצמו, והמשמעות
הייתה שאם ה-foundry נופל, אף-אחד לא שומר עליו מהרשת, ואם הוא חי — אין עדות-קבועה
שהוא ממשיך לשאת את תפקידו.

**אחרי:** ה-foundry רשום כחבר-קבוע ברוטציה עם מניפסט מכונה-קריא (`agent/rotation.json`),
מחזיק-רוטציה ייעודי (`mini-services/rotation-keeper`, פורט 3035) שמפעיל beats
קבועים ורושם כל ריצה בפנקס-משורשר-האש, ורגל-עצמאית בחוות-ה-CI (Domain) שבודקת
את הבית מדי יום מבחוץ.

---

## 1. מניפסט הרוטציה (מכונה-קריא)

**מיקום:** `agent/rotation.json` · **סכמה:** `SAOS-SOVEREIGN-ROTATION/1`

המניפסט הוא כתובת-הרישום של ה-foundry ברשת: תפקיד (trust-foundry — שער-הרשת),
כל ה-beats הקבועים עם מחזוריהם, ה-beats היורשים שכבר-חיים בשירותים-אחרים
(anchor-pulse של chief, drift-monitor של ה-signer), ונקודות-האינטגרציה של
שומרי-הצי (cloud-heart ב-steem, keeper-fleet ב-Zip, חוות-ה-CI ב-Domain).

**שומרי-הצי קוראים את הרגל הזו מבחוץ:**
- `GET http://127.0.0.1:3035/rotation/status` — מצב כל ה-beats (loopback; דרך
  הגייטווי רק עם whitelist-פורט מתאים)
- `broadcasts/rotation/ledger.jsonl` — פנקס-הרוטציה (משורשר-האש)

---

## 2. ה-beats הקבועים (rotation-keeper :3035)

| beat | מחזור | מה נמדד/נעשה | kill-switch |
|---|---|---|---|
| `health` | 15 דק' | probe של app:3000 + כל 5 שירותי-ה-foundry | — |
| `drift-report` | 30 דק' | ספירות-drift של הכספת (נתונים-ציבוריים בלבד) → פנקס | — |
| `selftest` | 2 שעות | kernel-selftest בתהליך-בן אפמרלי + נוכחות node_modules/prisma/db | — |
| `backup-freshness` | 6 שעות | גיל הגיבוי הטרי; אם >24h → טריגר גיבוי-חי אצל ה-signer | `SAOS_NO_ROT_BACKUP=1` |
| `git-hygiene` | 6 שעות | שינויים-לא-קומיטו + גיל HEAD → פנקס (רישום-בלבד; הסוכן-התורן מקדם) | — |

**כיבוי-כללי:** `SAOS_NO_ROTATION=1` (השירות עולה אבל הרוטציה מנוטרלת).

### פנקס-הרוטציה

כל ריצת-beat — עברה או נכשלה — נרשמת ב-`broadcasts/rotation/ledger.jsonl`:

```json
{"ts":"…","beat":"health","ok":true,"summary":"services 6/6 alive","prevHash":"…","hash":"…","durationMs":…}
```

אותה משמעת של קבלות-הראיות של הבית: כל רשומה מכילה `prevHash` ו-`hash`
(sha256 על הרשומה) — קטיעה או עריכה של הפנקס ניכרת מיד.

---

## 3. היורשים — מה כבר חי ולא משוכפל

ה-rotation-keeper **לא משכפל** מנגנונים-קיימים (העיקרון: קנון-אחד לכל-דבר):

| beat | הבעלים הקנוני | מחזור |
|---|---|---|
| anchor-pulse | chief-of-staff :3032 (Task 74) | בדיקה כל 5 דק' |
| drift-monitor | external-signer :3033 | כל 10 דק' |
| brief | chief-of-staff :3032 | כל 30 דק' |
| fleet-cure | fleet-cure :3034 | חלון-RC |

---

## 4. אינטגרציה עם הרשת

- **steem / cloud-heart** — הלב-החיצוני של הרוטציה (Actions heartbeat). רגל-ה-foundry
  נמדדת דרך `:3035/rotation/status` והפנקס.
- **Zip / keeper-fleet** — שומרי-הבית-הריבוני סוקרים חברים; צורת-הסטטוס
  `{ok, service, beats[], ledger}` אחידה וזמינה לסקר.
- **Domain / חוות-ה-CI** — `.github/workflows/foundry-rotation-check.yml`:
  מדי יום ב-04:47 UTC — install + typecheck + kernel-selftest על הריפו המלא,
  בלי תלות במארח-החי. עין-חיצונית-עצמאית על הבית.
- **gitleaks** — נוסף ל-foundry (והורחב ב-Domain): כל-push נסרק לסודות.

## 5. כללי-ברזל (לא מתפשרים)

1. **אפס-מפתחות כאן** — ה-rotation-keeper לא מחזיק ולא רואה חומר-מפתח; הכספת
   נשארת אטומה ב-signer :3033. טוקנים נקראים לזיכרון-בלבד ולעולם לא בלוג.
2. **fail-safe** — קריסת-beat נכללת ונרשמת; הפנקס הוא האמת, לא זיכרון-התהליך.
3. **derived-or-silence** — כל המספרים נמדדים-חי בכל-beat; אין טענות-קפואות.
4. **loopback-only** (R123) — כל ה-probes וה-bind על 127.0.0.1.
5. **רישום-בלבד** — ה-rotation-keeper לא מבצע קומיטים ולא שידורים; הוא מתזמן,
   בודק ורושם. הביצוע נשאר בשערים-המאושרים (signer, app API).

---

*רשום-לראשונה: 2026-09-29, מימוש-ביקורת האבטחה המקיפה (keys-map gate + Caddyfile
whitelist + HARDEN v6 לחוזים — ראו דוח-הביקורת בצ'אט הבעלים).*
