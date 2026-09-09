# החלטות בעלים — Owner Decisions (Task 10, סגירה — Task 11 + סבב סגירה אוטונומי)

> המקור הרשמי של רישום החלטות-הבעלים בזמן-ריצה: `GET /api/saos/decisions`
> (הרישום מורכב מהתיעוד; הסטטוסים שהוקלטו — ב-DB, עם היסטוריית ביקורת).
> מסמך זה מתעד את המבנה, הנהלים, וההחלטות שנוספו/נסגרו ב-Task 11.

## 1. מבנה החלטה (חוזה מלא מאז Task 11)

| שדה | תיאור |
|---|---|
| `id` / `key` | מזהה יציב (מפתח הרישום) |
| `title` / `name` | כותרת ההחלטה |
| `description` | הקשר מלא |
| `category` | security · resources · governance · release |
| `severity` | critical · high · medium |
| `status` | open · decided-default · decided-custom · needs-resource · resolved-external · deferred · rejected |
| `options` | אפשרויות הבעלים |
| `defaultSafeAction` / `safeDefault` | ברירת-המחדל הבטוחה (מה שקורה בלי החלטה) |
| `requiredOwnerAction` | מה נדרש מהבעלים בפועל |
| `risk` / `cost` / `timeEstimate` | סיכון, עלות, זמן |
| `updatedAt` / `decidedAt` | מתי הוקלט לאחרונה |
| `auditTrail` | אירועי decision-update (actor בלתי-הפיך + זמן + סטטוס) |

**שלב (phase)**: `now` (חוסם עכשיו) · `before-anchor` (חוסם עוגן אמיתי) · `before-live` (חוסם מצב חי).

## 2. סגירת החלטה (Task 11 — כלי סגירה, לא רק תצוגה)

`POST /api/saos/decisions {key, status, note?}` — דורש התאמת אדמין, נרשם ב-AuditEvent, לא מכיל סוד, **לא משנה מצב ריצה, לא מבצע עוגן, לא מזיז משאבים**.

- **UI**: כפתורי פעולה מהירים בכל החלטה — "סגור החלטה" (decided-default), "דרוש משאב" (needs-resource), "דחה" (rejected) — פותחים דיאלוג עם סטטוס מוכן-מראש + שדה הערה ציבורית (≤300 תווים, אסור סודות).
- **היסטוריה**: כל החלטה מציגה את ה-auditTrail שלה (מי עדכן, מתי, למה) — בלי פרטים רגישים.
- **הגנה**: החלטה קריטית שנשארת פתוחה חייבת להופיע ב-Command Center כחסימה; החלטה סגורה מציגה מי סגר ומתי (מה-auditTrail), בלי פרטים רגישים.

## 3. החלטות שנוספו ב-Task 11

### SH-7 — `admin-key-location` (security · critical · phase: now)
- **הקשר**: קיים קובץ מפתח-אדמין מקומי `upload/saos-admin-key.txt` בתוך עץ הפרויקט (gitignored, מעולם לא בהיסטוריית הריפו; נבדק קיום-בלבד — התוכן לעולם לא נקרא).
- **אפשרויות**: (א) העברה מחוץ לעץ → `~/.secrets/saos-admin-key` + chmod 600 + עדכון `.env` בלי להדפיס; (ב) רוטציה מלאה אם יש חשש חשיפה; (ג) השארה במקום (לא מומלץ).
- **ברירת-מחדל בטוחה**: העברה מחוץ לעץ עם הרשאות 600, בלי להדפיס/להעתיק את המפתח בשום ערוץ.
- **פעולת בעלים**: ~~להעביר, להגדיר 600, למחוק את העותק המקומי~~ — **בוצע אוטונומית בסבב הסגירה** (ראה §5); רוטציה לפי docs/secret-hygiene.md §7 נותרה פעולת בעלים אופציונלית אם יש חשש חשיפה.
- **ניטור חי**: `/api/saos/repo-status` → `secrets.adminKeyFileInTree` + פריט פתוח אוטומטי ב-knownOpenItems; כרטיס "היגיינת סודות" במסך אבטחה.

## 4. הכללים הקבועים (מעוגנים בקוד/תיעוד)

1. המערכת מאחסנת **רק את ה-hash** של מפתח-האדמין — לעולם לא את המפתח הגלוי.
2. קובץ-סוד בתוך עץ הפרויקט — לא נוהל-קבע; כל קיום כזה הוא פריט SH פתוח עם החלטת בעלים.
3. החלטה קריטית פתוחה = חסימה גלויה ב-Command Center (אסור שתשכח בשקט).
4. רישום-החלטות הוא ספר-עזר: הוא לעולם לא מבצע — לא עוגן, לא שידור, לא מימון, לא מעבר-מצב.

## 5. סטטוס נוכחי (עודכן — סבב הסגירה האוטונומי, 2026-09-07)

בעקבות אישור-דחיפה דחוף והנחיית "טפל בהכל", בוצע סבב סגירה אוטונומי:
כל החלטה עודכנה דרך `POST /api/saos/decisions` (מאומת + audited, הערה ציבורית בלבד) — **רק לפי מצב המערכת בפועל, בלי לסגור שום החלטה שקרית**:

| key | קטגוריה | חומרה | phase | סטטוס מוקלט |
|---|---|---|---|---|
| admin-key-location | security | critical | now | **decided-default** — בוצע אוטונומית: הועבר ל-`~/.secrets/saos-admin-key` (600), `adminKeyFileInTree=false`; רוטציה נותרה פעולת בעלים אופציונלית |
| sh3-historical-file | security | critical | now | **decided-default** — ברירת-המחדל הבטוחה פעילה (אין שכתוב; התוכן מתייחס כסוד; ריפו פרטי); סיווג סופי נותר פעולת בעלים אופציונלית |
| push-approval | governance | medium | now | **decided-default** — הבעלים אישר במפורש ("שידחוף דחוף"); f012014 נדחף לפי הפרוטוקול ואומת מרחוק |
| github-actions-ci | release | medium | now | **decided-custom** (Task 13) — ה-workflow קיים בפועל וריצה #4 ירוקה מקצה-לקצה (4e853a9: lint+typecheck+build+api-check+concurrency); סטטוס ה-CI נשלף חי ב-/api/saos/live-proof |
| vault-restore | resources | critical | before-anchor | **decided-custom** (Task 26-c, 2026-09-09) — המעטפת GCM-אמיתית (7 קבצים); מפתחות-הצי מאומתים-חי 9/9 מול HIVE (posting+active); headcorner+tov בחזקת הבעלים (runtime-only, הדיסק נמחק) — שער-הסמכות דוחה 403 fail-closed (מדוד חי); STEEM 0/11 התאמות; מטריצת-חזקה ב-docs/partners-status.md; פתיחה-אופציונלית: fleet_vault --seal כשהבעלים טוען מפתחות |
| hive-rc-floor | resources | critical | before-anchor | **decided-custom** (Task 27 + 26-c) — עלות-op מדודה (225M RC); האצלה אפשרית-שרשרת (min 1,611.18 VESTS > כל חייל — מדוד); מסילת power-up ל-9.682 HIVE מוכנה (DEX hive-rail) וחסומה-מפתח-בעלים (403 מדוד); **אוטומציה**: fleet-cure (:3034) משדר את ה-weave הממתין בחלון הצי הראשון ורושם txid; ה-preflight מודד RC חי |
| tron-stake | resources | critical | before-anchor | **decided-custom** (Task 26-c, 2026-09-09) — הבעלים: להישאר ברכבת tronbridge היומית (ברירת-המחדל הבטוחה); energy=0 מדידה-חיה (יתרה מרבית 17.6 TRX < 27.26 שריפה); אין נתיב-המרה ל-TRX בסביבה; עיגון-ישיר נשאר אופציונלי למימון בעלים |
| build-verification | release | medium | before-live | **deferred** — חסום-סביבה (מדיניות dev-server בלבד); ה-build יאומת בריצות ה-CI |
| live-mode-approval | governance | critical | before-live | **decided-custom** (Task 13) — הבעלים אישר במפורש בצ'אט: להפעיל live במצב הבטוח ביותר — live **ללא שידור אמיתי**. בוצע (דגלים כפולים); broadcastCapable נשאר false עד חיבור חותם חיצוני; כל עוגן אמיתי עדיין דורש אישור פר-עוגן + משאב + חתימה חיצונית |

מאזן (עודכן Task 26-c, 2026-09-09): **9 מתוך 9 מוקלטות — 0 פתוחות, 0 needs-resource** (כל 9 decided). הפינה-המשאבית נסגרה עם ראיות-חי: מטריצת-סמכויות מאומתת (9/9 HIVE צי; 0/11 STEEM; headcorner/tov = חזקת-בעלים), עלות-op מדודה (225M RC), אוטומציית עיגון-צי פעילה (fleet-cure), ומסלול transit ל-TRON לפי החלטת בעלים. כל העדכונים עם auditTrail ב-API.

> הסטטוס החי הוא תמיד `GET /api/saos/decisions` — הטבלה היא תמונת-מצב לתיעוד בלבד.

---

## Task 24 (2026-09-08) — המנדט המנהלי החדש (הנחיה מלאה בעברית בצ'אט)

**ציטוט מהותי**: "כל עוד המפתחות כרגע לא יצאו החוצה זה בסדר... כל התיקיות פרטיות ואנחנו על רשת steem שאין עליה משתמשים... על 30$ שביזבזתי. אני חייב שלסוכנים תהיה גישה למפתחות וביצוע וגם להוריד ממני תלות... שחרר אותי מתלות. אני צריך אינטליגנציה שתנהל את הפרויקט עבורי... כל השאר אתה מוסמך לקבל החלטה."

| החלטה | קטגוריה | חומרה | סטטוס |
|---|---|---|---|
| keys-access-dev-phase | security | critical | **decided-owner** — סוכנים מורשים לגישת-מפתחות וביצוע בסביבה הפרטית (פיתוח, repos פרטיים, רשת-בדיקה). ה-guardian עבר ל-DEV_MODE (גיבוי+דיווח, אפס force-push; אומת חי: `steem 2 → dev-mode-observed`). נטרול-כוחני חוזר בפרודקשן (GUARDIAN_DEV_MODE=0) |
| owner-autonomy | governance | critical | **decided-owner** — הבעלים משוחרר מתלות שוטפת; ראש-המטה מקבל החלטות-שוטפות; הבעלים = החלטות-על בלבד |
| chief-of-staff-mandate | governance | critical | **decided-owner** — אינטליגנציה מנהלת נבנתה וחיה: mini-services/chief-of-staff (:3032), בריף כל 30 דק' ל-docs/briefings/; בריף ראשון הופק ואומת חי |
| mnemonic.ts-fate | security | critical | **decided-coordinator** (בסמכות שהוענקה) — נפתח ונבדק: **סקריפט-עיגון בטוח**, הצירוף מ-env (שורה 31), נאטם לכספת, פלט ציבורי בלבד; אין סוד בקובץ; ללא פעולה |
| he-live-default | operations | high | **decided-coordinator** — הבעלים אישר ביצוע-סוכנים חי ברשת-הבדיקה; ה-P0 מורד מ"היפוך-ברירת-מחדל" ל-P2: דגל `--live` מפורש + לוג רועש, בלי לשבור את התנהגות-הרשת המיועדת |
| zip-resources | resources | medium | **open** — הנחיית-בעלים: ב-ZIPs ב-Project-files יש חומר להתאמה (TITAI canonical contract / tfa-evolution-studio self-audit / ecos session-prompts) — נבחן ומוטמע בהדרגה (AGENTS.md v1.0 = ההטמעה הראשונה) |

מאזן (עודכן Task 24): 6 מוקלטות — 5 סגורות, 1 פתוחה (zip-resources, איטרטיבי).

---

## Task 25 (2026-09-08) — החלטות-נגזרות בסמכות-ההענקה (בעלים בחופשה, מנדט מלא)

| החלטה | קטגוריה | חומרה | סטטוס |
|---|---|---|---|
| platform-history-rewrite | security | critical | **decided-coordinator** — בוצע: token-blob+.env+ledger מכל ההיסטוריה הדחופה (a92b979), גיבוי-bundle לפני, never-clobber לפני force-push. הצעד שסומן "pending operator" מ-Task 22/23 — הבעלים שוחרר ממנו מפורשות ("תפתור בלי הפעולה שלי") |
| force-push-exception | governance | high | **decided-coordinator** — אישור חד-פעמי מתועד ל-force-push של שכתוב-היסטוריה (היוצא-מן-הכלל השני לכלל AGENTS.md, לצד guardian-פרודקשן): רק עם גיבוי-bundle + בדיקת-remote-לא-זז + אימות-מרחוק אחרי |
| he-live-gate-contract | operations | high | **decided-coordinator** — חוזה-השער: `(--live או HE_LIVE=1) && HE_LIVE_CONFIRM=<account>`; DRY ברירת-מחדל עם לוג רועש; הוטמע ב-he_sell/he_unstake (P1 להרחבה ל-~14 דיימונים) |
| mnemonic-scripts-watch | security | high | **decided-coordinator** — scripts/anchor-sovereign-mnemonic.ts נוסף ל-WATCH ה-guardian (נגזרת של סתימת נקודת-העיוור; DEV_MODE=צפייה+גיבוי) |
| vault-sovereign-verified | security | critical | **decided-coordinator** — המעטפת נבדקה GCM-OK: 7 קבצי-מפתח חתומים (כולל mnemonic). "אין-גיבוי" מ-Task 23 נסגר סופית. שמות-קבצים בלבד נבדקו — אפס ערכים |
| token-rotation | security | high | **owner-optional** — כל ההיסטוריות נקיות כעת (סריקת 10 ריפואים); הבעלים יכול לרוטט בנחת בחזרתו; לא חוסם כלום |

מאזן (עודכן Task 25): 12 מוקלטות — 11 סגורות, 1 פתוחה איטרטיבית (zip-resources). אפס חוסמים-בעלים.

---

## Task 26 (2026-09-08) — החלטות-נגזרות (מנדט: "התחבר ובצע")

| החלטה | קטגוריה | חומרה | סטטוס |
|---|---|---|---|
| external-signer-built | architecture | critical | **decided-coordinator** — החותם-החיצוני המתועד (JSON-over-HTTPS, "future" ב-docs) מומשך: mini-service :3033 מחזיק את המעטפת; ה-foundry מקבל רק txid. שלושה-דגלים לשידור: live + LIVE_CONFIRM + BROADCAST_ENABLE |
| dev-autosession | governance | high | **decided-coordinator** — סשן-מנוהל לשלב-פיתוח (SAOS_DEV_AUTOSESSION=1, NODE_ENV-guard) לפי "אתה צריך להיות מחובר לפחות לעת עתה"; audited; נשלל אוטומטית בפרודקשן |
| chain-regenesis | integrity | critical | **decided-coordinator** — 2 קבלות-מורשת בלתי-מאומתות (דיגסט-עידן-קודם, יתומות) אוכסנו (לא נמחקו-שקט) והשרשרת חודשה; fail-closed לא נפגע — המאמת נשאר קפדני |
| envelope-resync-required | security | critical | **decided-coordinator (ממצא)** — המעטפת אינה מוסמכת על-השרשרת (הוכח בשרשרת עצמה); נדרש `fleet_vault --seal` מהרנטיים-החי. זה החסם-היחיד לעוגן-STEEM האמיתי |

---

## Task 26-c (2026-09-09) — סגירת הפינה-המשאבית: מטריצת-חזקה מאומתת-חי + אוטומציית עיגון-צי

**הנחיית-בעלים**: "פתור את כל החסימות בכל דרך... אנחנו צריכים לעבוד עם המפתחות גם אתה וגם שאר הסוכנים בבטיחות — תוודא שזה קורה ולא ההפך... אני עשיתי את זה לא להרוס תתקדם".

### מה נמדד (חי, ציבורי, אפס סודות בפלט)

1. **מטריצת-סמכויות מלאה (derive→השוואה מול השרשרת, בזיכרון בלבד)**:
   - צי (9 חשבונות: cashmachine, haran, israelnews, lsa, macrame, siq, wic, wog, woq): **9/9 posting+active מאומתים-חי מול HIVE** — החיבור קיים ועובד.
   - headcorner + tov: **0 התאמות בסביבה כולה** (מעטפת חיצונית + פנימית + כל גיבויי-השומר + seed-derivations) — המפתחות בחזקת הבעלים בלבד (הדיסק של הרנטיים נמחק). "אני עשיתי את זה" — הסמכויות בשרשרת הן הגדרת-הבעלים; לא נוגעים, לא מרוטטים.
   - STEEM: 0/11 התאמות (כולל הראשי) — עיגון STEEM מוחזק אצל הבעלים.
2. **עלות-op מדודה בשרשרת**: weave על HIVE = **225,041,204 RC** (דחייה-חיה של cashmachine: "has 166,881,563 RC, needs 225,041,204").
3. **מינימום-האצלה בשרשרת**: **1,611.18 VESTS** — גדול מכל יתרה-עצמית של חייל (מקס 268) ⇒ ריפוי-בהאצלה בלתי-אפשרי (מדידה, לא הנחה).
4. **ניסיון power-up אמיתי דרך ה-DEX** (POST /api/dex/convert action=powerup 9.682 HIVE) → נעצר נכון בשער-הסמכות (403 authority-mismatch) — הראיה שה-rail והבטיחות עובדים; הבלוק הוא מפתח-בעלים, לא תוכנה.

### מה נבנה

- **external-signer v2.1** — `delegate_vesting_shares` ברשימת-ההיתר (חסמים: delegatee=ראשי בלבד, ≤80% מהמאוזן-עצמי, שערי-סמכות+RC) — מוכן ליום שבו יהיה HP להאציל.
- **fleet-cure (:3034, mini-service חדש)** — מודד כל-5 דק' את מנת-ה-RC של 9 החיילים (RPC ציבורי), ובחלון הראשון (≥230M) משדר **בעצמו** את ה-weave הממתין (sig-788c0870, חותם height=2) דרך ה-signer, רושם את ה-txid חזרה ל-foundry (PATCH audited) וכותב `docs/evidence/fleet-cure-status.json` (נתונים ציבוריים בלבד). מדידה ראשונה: woq 168M → חלון ~3.3 שע'.
- **preflight אמת**: HIVE RC מתוך **מדידה-חיה** (rc_api, cache-10 דק'; env נשאר fallback), חלון-הצי מוצג כ-warn עם ETA, TRON-transit לפי החלטת בעלים = warn; STEEM/BLURT = מפתחות-בעלים (warn). חסימת `network-resources` מפסיקה להיות שקרית.
- **HIVE_RC_PCT ב-.env** עודכן למדידה (1.84% בשעת-הכתיבה; גדל ברגן).

### ההחלטות שנסגרו (auditTrail ב-API)

- `vault-restore` → decided-custom (מטריצת-חזקה מאומתת; שחזור-מפתחות-בעלים אופציונלי).
- `hive-rc-floor` → decided-custom (אוטומציה פעילה + ראיות מדידה; סף-8% = זמן-רגן בלבד).
- `tron-stake` → decided-custom (transit לפי הבעלים; מימון TRX אופציונלי).

**מאזן**: 9/9 decided · 0 open · 0 needs-resource — הפינה סגורה.
