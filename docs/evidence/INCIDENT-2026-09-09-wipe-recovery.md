# אירוע-מחיקה 2026-09-09 ~22:03 UTC + שחזור מלא

## מה קרה
גורם חיצוני לפרויקט (לא קוד הפרויקט — `scripts/cleanup.mjs` חף: מסרב בלי גיבוי מאומת ונוגע רק בשורות-DB ישנות) מחק קבצים לא-עקובים:

| נמחק | תוצאה |
|---|---|
| `.env` (נשארה שורת `DATABASE_URL` בלבד) | `SAOS_MODE=live` חזר ל-dry-run · `SAOS_ADMIN_KEY_HASH` אבד → fail-closed על כל פעולה רגישה |
| `db/custom.db` (מסד ריק, סכימה טרייה) | 0 חותמות, 0 קבלות, 0 החלטות, 0 OpLog — כל מצב-הריצה אבד |
| `upload/saos-admin-key.txt` | חומר-הגלם של מפתח-האדמין הישן (ה-hash אבד איתו — אי-אפשר לשחזר אותו מפתח) |
| `backups/` | כל ארכיוני הגיבוי המקומיים |

**שרד**: כל הקבצים המגובים בגיט (קוד, docs, evidence, worklog), ה-token ב-`upload/Roshcaregt.txt`, ותמונת הארנק.

## שחזור (2026-09-09 22:51–23:0x UTC)
1. `.env` נבנה מחדש: `SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES` (הסכמת-בעלים מתועדת, Task 40 — עוגנים חיים שודרו ואומתו), מפתח-אדמין **חדש** הונפק **מחוץ לעץ** (`~/.secrets/saos-admin-key`, 600 — SH-7 נסגר כהלכה), hash בלבד בעץ, סוד-סשן חדש, RPC ציבוריים.
2. 9/9 החלטות-בעלים נרשמו מחדש דרך `POST /api/saos/decisions` (auth) — **מהתיעוד המגובה בגיט בלבד** (worklog Tasks 38–40 + docs/next-steps.md): 5 decided-custom, 3 resolved-external, 1 deferred (build-verification), 1 needs-resource (hive-rc-floor). אפס המצאות.
3. `bun run backup` → גיבוי טרי ומאומת (`backups/backup-2026-09-09T22-51-00`, integrity ok) + OpLog.
4. חותמת ג'נזיס חדשה: seal `9edc42eb…` — שרשרת-עדויות מתחילה מחדש, מתועדת כאן. השרשרת ההיסטורית: ג'נזיס-ארכיון בגיט (`legacy-chain-archive-2026-09-08.json`) + עדויות העוגנים החיים ב-commit e7e32cb (STEEM 109438757/109438812, BLURT 63502020) — ניתנות לאימות על-השרשרת בעצמה.

## תוצאה מדודה
- preflight: **0 חוסמים קשים** (היו 5), `readyForAnchor: true`, mode=live, backupFresh=true, authReady=true.
- החלטות: 9/9 מוקלטות, 0 פתוחות, 0 קריטיות-פתוחות, 1 needs-resource.
- 4 אזהרות כנות (משאבי-רשת TRX/RC · אין-בקשת-חתימה פתוחה · פריטי-אבטחה · broadcastCapable עד חיבור-חותם מלא).

## מניעה
- תבנית האירוע זהה לניסיון-ה-wipe על `.gitignore` (גורם-ניקוי חיצוני): **לשים לב ל-.env/.gitignore/db/upload בכל כניסה**; `.gitignore` חייב להישאר 53 שורות.
- מפתח-אדמין עכשיו מחוץ לעץ — wipe עתידי של העץ לא ינתק את ה-auth (רק יחייב עדכון hash ב-.env).
- גיבויים: להריץ `bun run backup` בסוף כל סבב (גם כותב OpLog שמזין את שער backup-fresh).
