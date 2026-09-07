# Runbook — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 4) · סביבת הרצה: sandbox, פורט 3000, Node 24 / Bun 1.3

## 1. הקמה מאפס (שחזור מלא מהריפו)

```bash
# דרישות: node >= 20 (נבדק על 24), bun, או npm/pnpm חלופי
bun install                      # תלויות (bun.lock נכלל בריפו)

# משתני סביבה:
cat > .env <<'EOF'
DATABASE_URL="file:./custom.db"
# אופציונלי — ברירות-מחדל 0.6 / 0:
# HIVE_RC_PCT=0.6
# TRON_ENERGY=0
EOF

bun run db:push                  # יוצר את הסכמה ב-SQLite (prisma db push)
bun run dev                      # next dev -p 3000 — רץ ברקע
```

בדיקת בריאות ראשונה:

```bash
curl -s http://localhost:3000/api/saos/status  | head -c 120
curl -s http://localhost:3000/api/saos/kernel  | jq '.result.ok'           # צפי: true
curl -s http://localhost:3000/api/saos/verify-pack | jq '.rootMatches'     # צפי: true (אחרי פעימה ראשונה)
```

## 2. משתני סביבה

| משתנה | חובה | ברירת-מחדל | משמעות |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | `file:./custom.db` (יחסית ל-prisma) |
| `HIVE_RC_PCT` | — | 0.6 | אחוז RC נוכחי של Hive — מזין את המטריצה |
| `TRON_ENERGY` | — | 0 | אנרגיית TRON זמינה — מזין את המטריצה |
| `SAOS_MODE` | — | dry-run | מצב פעולה: `dry-run` \| `safe` \| `live` \| `maintenance`; ערך לא-מוכר → dry-run |
| `SAOS_LIVE_CONFIRM` | — | — | חייב `YES` כדי ש-`SAOS_MODE=live` ייקלט (הגנת אישור-כפול); גם אז `broadcastCapable:false` עד כספת |

## 3. פעולות שגרה

| פעולה | פקודה |
|---|---|
| הרצת פעימת עגינה | `curl -s -X POST localhost:3000/api/saos/seal -H 'Content-Type: application/json' -d '{"stamps":6,"memo":"pulse"}'` |
| selftest | `curl -s localhost:3000/api/saos/kernel \| jq .result.ok` |
| הוכחות | `curl -s localhost:3000/api/saos/verify-pack \| jq '.rootMatches,.allVerified'` |
| תוכנית TRON | `curl -s 'localhost:3000/api/saos/energy?net=tron&trx=6500&txs=4'` |
| תוכנית HIVE | `curl -s 'localhost:3000/api/saos/energy?net=hive&rc=0.6'` |
| כלכלה | `curl -s 'localhost:3000/api/saos/economy?fly=30'` |
| lint / types | `bun run lint` · `bun run typecheck` |
| **בדיקה מלאה (פקודה אחת)** | `bun run check` — lint+typecheck+test(26)+verify(8 מקבילות); דורש dev רץ |
| בדיקות חוזה בלבד | `bun run test` (scripts/api-check.mjs) |
| בדיקת מקביליות | `bun run verify` (scripts/concurrency-check.mjs; N פרמטרי: `node scripts/concurrency-check.mjs 10`) |
| אימות שרשרת מלא | `curl -s localhost:3000/api/saos/verify-chain \| jq .ok,.receiptChain,.totals` |
| שחזור `at` לקבלות (חד-פעמי, אידמפוטנטי) | `bun scripts/backfill-receipt-at.ts` |
| לוג חי | `tail -f dev.log` (קריאת-זנב בלבד — תמיד הרשומות האחרונות) |

## 4. תחזוקה

### 4.1 שינוי סכמה (maintenance mode)

```bash
# 1. גיבוי
cp db/custom.db "backups/custom-$(date +%Y%m%d-%H%M%S).db"   # צור backups/ אם אין
# 2. ערוך prisma/schema.prisma
# 3. החל
bun run db:push
# 4. אימות
curl -s localhost:3000/api/saos/status | jq .ok
```

אם `db push` דורש reset (שינוי דורש-מחיקה): הפסק, שקול `prisma migrate dev` לשימור, או הסכם לאיבוד נתוני-ריצה עם גיבוי בצד.

### 4.2 איפוס סביבת פיתוח

```bash
rm -rf .next db/custom.db && bun run db:push && bun run dev
curl -s -X POST localhost:3000/api/saos/seal -d '{}' -H 'Content-Type: application/json'  # פעימה ראשונה
```

## 5. תקלות נפוצות

| תסמין | סיבה | טיפול |
|---|---|---|
| `mode-refusal: כתיבה אסורה במצב …` | השרת רץ ב-safe/maintenance | הפעל מחדש עם `SAOS_MODE=dry-run` (או live+confirm) |
| `Timed out fetching a connection` / `SQLITE_BUSY` חוזרים | עומס כתיבה חריג מעל יכולת ה-retry | נסה שוב; אם נמשך — בדוק תהליכים כפולים על אותו קובץ DB |
| `float/inf rejected — integers only` | פרמטר לא-מספרי ב-query | תקן את הפרמטר |
| `P1003: database file does not exist` | db push לא רץ / נתיב DATABASE_URL שגוי | `bun run db:push`, בדוק `.env` |
| `Invalid project directory … /lint` | סקריפט lint ישן (`next lint`) | BUG-002 תוקן — ודא `"lint": "eslint ."` ב-package.json |
| דף ריק/שגיאת hydration | רוב הסיכויים compile חלקי ב-dev | רענן; בדוק סוף dev.log; `rm -rf .next` אם נתקע |
| הכול 200 אבל `ok:false` בכל קריאה | DB לא זמין | ר' שורת P1003 לעיל |

## 6. פריסה / גרסאות

- הפרויקט רץ בסנדבוקס בלבד (פורט 3000 דרך גייטוויי). **אין** deploy חוץ כרגע.
- ערוץ ההתמדה הוא GitHub: `roshpinacare-sys/saos-sovereign-foundry` (main). נהל על פי סדר-הסיום הקבוע:

```bash
bun run lint && bunx tsc --noEmit
git add -A && git commit -m "<תיאור ברור>"
git push origin main
# ואז: עדכון worklog.md (append) — חובה לפני סיום הסבב
```

- Repos אחים: `saos-sovereign-platform` (עותק עצמאי מדורג), `anchor-baseline` (שחזור מדויק של 5356dab).

## 7. מדדי בריאות (מה "תקין" נראה)

| מדד | ערך תקין |
|---|---|
| `GET /status` → `ok` | true (+ `mode` מוצג) |
| `GET /kernel` → `result.ok` | true (7/7) |
| `GET /verify-pack` → `rootMatches` + `allVerified` | true + true (אחרי פעימה ראשונה) |
| `GET /verify-chain` → `ok` | true; `receiptChain.digestErrors=[]`, `linkErrors=[]`; `forks` יכול להכיל [17] היסטורי |
| `bun run check` | יציאה 0 (26 api-check + 8/8 concurrency) |
| DB עקביות | heights רציפים יחודיים; leaves = Σ leavesCount; 0 יתומים |
| dev.log | ללא stack traces חדשים; 200-ים בקריאות שגרה |
| HTTP codes | 200 תמיד; כישלון מזוהה על `ok:false` |
