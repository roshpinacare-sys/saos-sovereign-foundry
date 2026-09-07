# מיפוי סביבת עבודה רבת-סוכנים — Multi-Agent Map (Task 12)

> מטרה: מיפוי זהיר של תיקיות סוכנים אחרים באותו מרחב עבודה ושל ריפואים באותו חשבון GitHub.
> כלל עליון: מטא-דאטה ומבנה עליון בלבד; **אף קובץ סוד לא נקרא ולא ייקרא**; אין העתקת קוד; מה שלא בטוח — מסומן חסום.
> תאריך מיפוי: 2025-09-07 (Task 12, באישור בעלים מפורש).

---

## 1. כללי המיפוי שהוחלו

- נקראו רק: שמות תיקיות ברמה העליונה, `package.json`, `README`/רשימת docs, עץ קבצים (שמות בלבד).
- **לא נקראו** (ולא ייקראו) קבצים בתבנית: `.env`, `.env.local`, `*.key`, `*.pem`, `wallet*`, `seed*`, `credentials*`, `token*`, `secrets*`, `id_rsa*`, `keystore*`.
- ריפואים באותו חשבון GitHub (`roshpinacare-sys`) ושהם של אותו בעלים → מקור מידע **מורשה לקריאה בלבד**.
- תיקייה/ריפו חשוד, לא-שייך או מכיל סודות → מסומן `blocked`/`unauthorized`, תיעוד קצר בלבד.

## 2. מרחב העבודה המקומי (`/home/z/`)

| נתיב | מה זה | סוג פרויקט | מצב |
|---|---|---|---|
| `/home/z/my-project` | **הפרויקט הפעיל** — SAOS Sovereign Foundry v2 (Next.js 16, Prisma/SQLite, מרכז שליטה) | blockchain | active |
| `/home/z/saos-repo` | שיבוט **מיושן של אותו ריפו** (`saos-sovereign-foundry`) בסטטוס Task 6 (`bb12c62`) — מקור/יעד זהה ב-git remote | blockchain (duplicate) | read-only mapping only |
| `/home/z/.secrets` | אחסון סודות הבעלים (dir 700, files 600) | secrets | **blocked לקריאה** — מחוץ לתחום |
| `/home/z/TODO` | קובץ JSON בבעלות root — רשימת משימות שהושלמה של סבב קודם (Task 11-closure; 10/10 completed) | artifact | נקרא (מטא-דאטה) — אין בו הוראות חדשות |
| `.agent-browser`, `.bun`, `.cache`, `.config`, `.local`, `.npm`, `.npm-global`, `.venv` | מטמוני כלים וסביבת ריצה | infrastructure | ignored |
| `pyproject.toml` + `uv.lock` | הגדרת סביבת Python (uv) | infrastructure | ignored |
| `node_modules` (symlink → npm-global) | קישור תשתית | infrastructure | ignored |

### ממצא ביטחוני על `saos-repo` (חשוב)

- ה-git remote שלו מכיל **טוקן גישה מוטמע בתוך כתובת ה-URL** (`.git/config`). הטוקן **לא הוצג כאן ולא יוצג**.
- זהו אותו ריפו של אותו בעלים — אין דליפה חוצה-חשבון — אבל זו תבנית מסוכנת (טוקן בקובץ קונפיגורציה מקומי).
- **המלצה לבעלים:** לשקול סיבוב הטוקן (לפי docs/secret-hygiene.md §7) ומחיקת השיבוט המיושן (הוא מוגדר כ-superseded; כל ההמשך הוא ב-`my-project`).

## 3. ריפואים בחשבון GitHub של הבעלים (`roshpinacare-sys` — 8 ריפואים, כולם private)

| ריפו | שפה | גודל | סיווג | תוכן עליון בולט | מצב קריאה |
|---|---|---|---|---|---|
| `saos-sovereign-foundry` | TypeScript | — | blockchain | **הריפו של הפרויקט הזה** | active |
| `steem` | JavaScript | ~191MB | blockchain / agent-platform | `sovereign/`, `agent/`, `mini-services/`, `THE_WEAVE.md` — SAOS Steem AI Agent OS (snapshot Task 114) | קריאת-שטח בלבד; עיון עמוק דורש אישור |
| `Saosmartwallet` | TypeScript | ~443KB | **wallet (רגיש)** | `packages/`, `engineering/`, `mini-services/` | **blocked** — מדיניות: ארנקים לא נחקרים ללא אישור מפורש |
| `saos-sovereign-platform` | TypeScript | ~421KB | blockchain / platform | "The chosen project — standalone canonical copy"; `agent/` | מורשה לקריאה; מועמד להשוואת עותק-קנוני |
| `saos-dex` | TypeScript | ~250KB | trading | ספר-הזמנות + AMM; `audit-package/` | מורשה לקריאה; לא רלוונטי לעיגון כרגע |
| `anchor-baseline` | — | ~1KB | baseline restore | **מכיל `.env` ברמה העליונה** | **blocked** — לא נקרא; סוג-סוד |
| `roshpina` | TypeScript | ~481KB | agent / kernel | `kernel/`, `kernel-smoke.ts` — Trust & Value Platform | מורשה לקריאה; דורש סקירת רישיון/תאימות |
| `Project-files` | — | — | archives | 10 ארכיוני ZIP של כל העבודה ההיסטורית (מקור Task 1) | known |

## 4. סיכונים שזוהו

1. **`anchor-baseline/.env`** — קובץ סוד בתוך ריפו GitHub (פרטי, אך עדיין סוד בריפו). לא נקרא, לא יועתק. **פעולת בעלים מומלצת:** להסיר/לסובב את הסוד שבו.
2. **טוקן מוטמע ב-remote של `saos-repo`** (מקומי) — המלצת סיבוב לעיל.
3. **שיבוט מיושן** (`saos-repo` @ Task 6) — עלול לבלבל סוכנים עתידיים לעבוד על עותק לא-נכון. מסומן: superseded.
4. `steem` (191MB) — נפח עצום + תוכן לא-ממופה; עיון עמוק בלי הכנה יכול לחשוף סודות היסטוריים שנשכחו בתוכו → נדרש אישור בעלים ותיקיית סריקה מבוקרת.

## 5. הזדמנויות שילוב (ללא העתקה גורפת)

| מקור | מה עשוי להיות שווה | מה נדרש |
|---|---|---|
| `steem` (repo) | מודולי עיגון/sovereign בשלים; היסטוריית הרצות חיות | אישור בעלים + סקירה מבוקרת + סריקת סודות לפני כל קריאה עמוקה |
| `roshpina` | קרנל אמון; smoke tests | סקירת רישיון + תאימות ל-SALES kernel הקיים |
| `saos-sovereign-platform` | השוואה מול "העותק הקנוני" — וידוא שאנחנו העותק המוביל | קריאת README/docs בלבד לעת עתה |
| `Saosmartwallet` | תיאוריה: חיבור ארנק לחתימה חיצונית | **חסום** עד אישור בעלים מפורש (מדיניות ארנקים) |
| `saos-dex` | — | להתעלם (תחום אחר) |

## 6. המלצה מסכמת

- **לשלב עכשיו:** כלום לא הועתק — הרחבת אתריום/סולנה נעשתה **native** בקוד זה (ראה `docs/cross-agent-findings.md`).
- **להתעלם:** `saos-dex`, מטמוני התשתית, `TODO` (רשימה ישנה).
- **דורש אישור בעלים:** עיון עמוק ב-`steem`/`roshpina`/`saos-sovereign-platform`; כל מגע ב-`Saosmartwallet`; פתיחת `anchor-baseline` (רק לצורך הסרת/סיבוב ה-`.env` שבו).
- **לתעד בהמשך:** כל מיפוי עתידי יתעדכן במסמך זה לפי אותם כללים.
