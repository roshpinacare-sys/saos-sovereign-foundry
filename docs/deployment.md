# פריסה מחוץ לסנדבוקס — SAOS Sovereign Foundry v2

נוצר: 2026-09-07 (Task 5, מיסיון 8). מטרה: שיהיה אפשר להריץ את המערכת על שרת אמיתי **בלי לגלות סודות ובלי פעולה מסוכנת**.

## 1. דרישות סביבה

| רכיב | גרסה (כפי שפותח ונבדק) | הערה |
|---|---|---|
| Node.js | 24.x (נבדק 24.19) | ≥20 אמור לעבוד |
| Bun | 1.3.14 | רץ-ראשי: dev/test/backup/restore/cleanup |
| Next.js | **16.3.4** | מתוקן ל-15 ייעוצי אבטחה (ר' security.md §6) |
| React | 19.2 | — |
| Prisma | 6.19.3 + SQLite | `DATABASE_URL=file:./db/custom.db` |
| TypeScript | 5.9 | strict |
| דיסק | ~50MB + גיבויים | `backups/` גדל ~0.4MB לגיבוי |

## 2. התקנה

```bash
git clone <repo> saos && cd saos
bun install
cp .env.example .env          # ואז למלא — ר' §3
bun run db:push               # יצירת/עדכון סכימת SQLite
bun run dev                   # http://localhost:3000
bun run check                 # lint + typecheck + api(45) + concurrency(8) — חייב לעבור מלא
```

## 3. משתני סביבה נדרשים

| משתנה | חובה? | תוכן |
|---|---|---|
| `DATABASE_URL` | כן | `file:./db/custom.db` |
| `SAOS_ADMIN_KEY_HASH` | כן (לפעולות רגישות) | sha256-hex של מפתח המנהל. **לעולם לא המפתח עצמו**: `node -e "console.log(require('crypto').createHash('sha256').update('YOUR_LONG_KEY').digest('hex'))"` |
| `SAOS_SESSION_SECRET` | מומלץ בפריסה | מחרוזת אקראית ≥16 תווים (openssl rand -hex 32). ברירת-מחדל נגזרת מה-hash |
| `SAOS_SESSION_TTL_H` | לא | תוקף סשן בשעות (ברירת-מחדל 12) |
| `SAOS_MODE` | לא | dry-run (ברירת-מחדל) / safe / live / maintenance |
| `SAOS_LIVE_CONFIRM` | רק עם live | `YES` בלבד — הגנת-להבה-כפולה |
| `SAOS_RL_<ROUTE>_PER_MIN` | לא | אחלפת הגבלת-קצב לנתיב (למשל `SAOS_RL_SEAL_PER_MIN=60`) |
| `SAOS_SIGN_TTL_H` | לא | תוקף בקשות-חתימה (ברירת-מחדל 24) |
| `HIVE_RC_PCT`, `TRON_ENERGY` | לא | קלט לחישוב advisory (0.6 / 0) |

**אסור לשים ב-.env ולעולם לא לריפו**: מפתחות פרטיים, seed phrases, טוקנים. המערכת לא צורכת כאלה בכלל.

## 4. מצבי פעולה ומעברים

```
dry-run (ברירת-מחדל)  ──restart(SAOS_MODE=safe)──────────▶  safe (קריאה בלבד)
        │
        └──restart(SAOS_MODE=maintenance)────────────────▶  maintenance
        │
        └──restart(SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES)
                │
                ├─ חסר אחד הדגלים → נפילה אוטומטית ל-dry-run (עם אזהרה)
                └─ חובה קודם: GET /api/saos/live-gate → readyForLive=true (0 blockers)
```

- אין קיצור-דרך בראנטיים ל-live — כל מעבר דורש הפעלה-מחדש של התהליך.
- `POST /api/saos/live-gate` (מחייב הרשאה) מדווח בדיוק מה חסר; הוא **לא** מדליק כלום.
- גם ב-live: `broadcastCapable:false` עד חיבור כספת חתימה חיצונית.

## 5. מה אסור לעשות בלי אישור מפורש

1. העברה ל-live (דורש אישור בעלים + live-gate נקי).
2. חיבור כספת/חותם אמיתי — רק מחוץ למערכת; המערכת מקבלת txid בלבד.
3. עסקאות אמיתיות / שידורים / העברות נכסים — אין לקוד שום יכולת כזו, ואין להוסיף אותה בלב דיון מתועד.
4. מחיקת נתונים — רק דרך `bun run cleanup --yes` עם גיבוי מאומת <24h (אחרת נדחה).

## 6. פרודקשן אמיתי (מעבר ל-dev)

- `bun run build` **לא נבדק בסנדבוקס** (חסימת סביבה מתועדת — לא ניסו לעקוף). מחוץ לסנדבוקס: הרץ build, ואז `next start` מאחורי reverse-proxy עם TLS.
- מאחורי HTTPS: אפשר `secure:true` ב-cookie הסשן (`src/app/api/saos/auth/route.ts`, מסומן בקוד).
- rate-limit הוא in-memory לתהליך בודד; פריסה אופקית דורשת limiter משותף (Redis וכד') — שינוי מתועד בלבד.
- אינטגרציית מערכת-קבצים: `docs/` נקרא בראנטיים ע"י live-gate (`restore-plan`) — לפרוס את תיקיית docs עם התמונה.

## 7. גיבוי ושחזור בפריסה

```bash
bun run backup                    # snapshot מאומת (integrity+counts) + manifest + רישום OpLog
bun run restore backups/<dir>     # dry-run — בודק ולא נוגע
bun run restore backups/<dir> --target /tmp/drill.db   # תרגיל ליעד ניסיוני
bun run restore backups/<dir> --yes                     # שחזור אמיתי (db קודם נשמר)
```

live-gate דורש גיבוי מאומת בן פחות מ-7 ימים; cleanup דורש גיבוי מאומת בן פחות מ-24 שעות.

---

## Task 6 — הוספות

- **סודות**: `.env` חייב הרשאות 600; קבצי `upload/` מחוץ לעץ-הפרויקט בפריסה אמיתית (ר' docs/secret-hygiene.md). אין להעתיק `.env` בין סביבות — רק `SAOS_ADMIN_KEY_HASH` (ה-hash).
- **egress לאימות-ציבורי**: אימות txid (opt-in) דורש גישה יוצאת ל-`api.steemit.com` / `api.hive.blog` / `rpc.blurt.world` / `api.trongrid.io` — בסביבה חסומה התוצאה תהיה כנה-unverified (התנהגות מתועדת, לא תקלה).
- **preflight בבריאות-מערכת**: `GET /api/saos/anchor-preflight` — כלול בסיור השגרתי; `readyForAnchor=false` אינו תקל אלא חסימה מתועדת עם פעולה-המשך.
