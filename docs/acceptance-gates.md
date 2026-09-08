# Acceptance Gates — שערי-קבלה של הרשת

> **מקור-השראה**: `14_ACCEPTANCE_GATES.md` מ-TITAI canonical-agent-platform v18
> (ZIP `TITAI_v18_VERIFIED_INSTALLER_WITH_ARCHITECTURE (3).zip` →
> `docs/canonical/14_ACCEPTANCE_GATES.md` — נקרא סטטית בלבד, מעולם לא הורץ),
> מותאם ללולאת-הביצוע של AGENTS.md (7 צעדים). המקור המחייב נשאר AGENTS.md;
> המסמך הזה מפרק אותו לשערים ברי-בדיקה.

## המיפוי: לולאת-הביצוע (AGENTS.md) → שערים

| צעד בלולאה (AGENTS.md) | השער | שאלת-המעבר |
|---|---|---|
| 1–2: קריאת worklog/next-steps + בחירת משימה מוקצית (תחום מוגבל) | **(טרום-שער) תחום** | האם למשימה יש בעלים, תחום מוגבל ומקור ב-next-steps/worklog? |
| 3: יישום הפרוסה האנכית הקטנה שעובדת | — (הביצוע עצמו) | — |
| 4: הוכחה בראיות | **implemented** | האם זה רץ אצל מי שמימש, עם ראיה? |
| 5: אימות עצמאי | **verified** | האם משהו שאינו ה-builder אישר? |
| 6: עדכון worklog + next-steps | **documented** | האם הרשומה עומדת במשמעת-התיעוד? |
| 7: commit + push במדיניות never-clobber | **pushed** | האם הדחיפה נקייה ולא-דורסת? |

**כלל-על** (מהמקור, מתורגם ללשון הרשת): "מה שכתוב לא אומר כלום — הקוד והראיות אומרים".
שער ללא ראיה = לא עבר. קביעה בלי file:line או פלט-פקודה = "unverified" או שקט.

---

## טבלת-השערים (implemented → verified → documented → pushed)

| שער | קריטריונים קונקרטיים (כולם חובה) | ראיה נדרשת | נכשל → פעולה |
|---|---|---|---|
| **implemented** | 1. `bun run lint` עובר · 2. `bunx tsc --noEmit` נקי (או נקודות-כאב קיימות מתועדות ולא-חדשות) · 3. טסט/בדיקת-התנהגות רלוונטית רץ ועובר · 4. אפס סודות בקוד/פלט/לוג (דיווח נתיב+מחלקה בלבד) · 5. אפס תלות-רשת-נסתרת חדשה (מקור TITAI: "no new hidden remote dependency") · 6. אפס קוד-זר שהורץ — סריקה סטטית בלבד | פלט-פקודה מהמושב עצמו + file:line | חוזרים לצעד 3; לא מדרגים את עצמנו "implemented" |
| **verified** | 1. אימות עצמאי שונה מה-builder (טסט חוזר / סריקה חוזרת / agent-browser / סוכן אחר) · 2. הנתיב הכושל נבדק (fail-closed) ולא רק הנתיב המאושר · 3. אפקטים של אבטחה/פרטיות/נתונים/rollback נבחנו (מקור TITAI: security, privacy, data, migration, rollback, operational effects) · 4. "מה לא אומת" נכתב במפורש | פלט האימות העצמאי (שונה מפלט ה-builder) | נשאר implemented בלבד; חסימה מתועדת ב-next-steps |
| **documented** | 1. רשות-worklog חדשה (append בלבד, template רשמי: `---`/Task ID/Agent/Task/Work Log/Stage Summary) · 2. next-steps עודכן (זנב — פתוחים חדשים שהתגלו) · 3. הדוקומנטציה תואמת את ההתנהגות בפועל (מקור TITAI: "Documentation matches behavior") · 4. טעות שהתגלתה = תיקון-עצמי גלוי ברשומה חדשה, לא מחיקה | file:line ב-worklog/next-steps המצביעים על הראיות | השער לא עבר — אסור לדלג ישר ל-push |
| **pushed** | 1. commit עם הודעה מסקנתית והראיות העיקריות בתוכן · 2. `git fetch` לפני push; remote זז → לא דורסים, מדווחים וממתינים להחלטה · 3. אפס force-push (החרגה יחידה: guardian בפרודקשן GUARDIAN_DEV_MODE=0) · 4. אפס סודות בקומיט (כולל .git/config, tool-results, קבצי .env/.enc/.key/*token*) · 5. release-truth-audit הורץ לפני ה-push והתוצאה מוצמדת לרשומה | קוד-יציאה של `bun run release-truth-audit` + hash של ה-push | עצירה; דיווח ל-coordinator/בעלים |

---

## בדיקות-רוחב מהמקור ה-TITAI (מותאמות — מופעלות לפי סוג המשימה)

לא כל משימה נוגעת בכולן; כשהמשימה נוגעת — השער הרלוונטי לא עובר בלעדיהן:

| תחום (TITAI) | התאמה לרשת שלנו |
|---|---|
| Supply chain | כל תלות/ZIP/קוד-זר: סריקה סטטית, ללא הרצה (כלל-החבלן); טובין לא-מאומתים לא עוברים שער promoted |
| Operations & sovereignty | אובדן-רשת / שירות-מת (guardian :3031, chief-of-staff :3032): מה קורה? יש recovery מתועד? |
| Durable execution | הרג/הפעלה-מחדש בכל נקודת-ביקורת → מצב-סוף אחד, בלי אפקט-צד כפול, בלי שרשור-אודיט שבור (supervisor/instrumentation) |
| Data & memory | בעלות/הרשאות/מחיקה/retention: הנגזרות (indexes/מטמונים) מצייתות למחיקה במקור |
| Human oversight | האם משהו כאן הוא החלטת-על? → ניסוח ל-owner-decisions.md ולא החלטה עצמאית של סוכן; פורץ-חסמים = הבעלים בלבד |
| Performance/cost | כסף אמיתי רק בהיקף המאושר (רשת-בדיקה $30); מדידות עם פילוח ולא ממוצע-בודד |

## סיכום-השער בשורה

**implemented** = רץ אצל ה-builder עם ראיה · **verified** = מאומת עצמאית + fail-closed נבדק ·
**documented** = worklog (append) + next-steps + דוק תואם-התנהגות · **pushed** = דחיפה נקייה,
never-clobber, אפס סודות, release-truth-audit ירוק-או-גלוי.
