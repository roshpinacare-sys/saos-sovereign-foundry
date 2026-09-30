# Runbook — SAOS Sovereign Foundry v2

עודכן: 2026-09-07 (Task 5) · סביבת הרצה: sandbox, פורט 3000, Node 24 / Bun 1.3

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
curl -s http://localhost:3100/api/saos/status  | head -c 120
curl -s http://localhost:3100/api/saos/kernel  | jq '.result.ok'           # צפי: true
curl -s http://localhost:3100/api/saos/verify-pack | jq '.rootMatches'     # צפי: true (אחרי פעימה ראשונה)
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
| הרצת פעימת עגינה | `curl -s -X POST localhost:3100/api/saos/seal -H 'Content-Type: application/json' -d '{"stamps":6,"memo":"pulse"}'` |
| selftest | `curl -s localhost:3100/api/saos/kernel \| jq .result.ok` |
| הוכחות | `curl -s localhost:3100/api/saos/verify-pack \| jq '.rootMatches,.allVerified'` |
| תוכנית TRON | `curl -s 'localhost:3100/api/saos/energy?net=tron&trx=6500&txs=4'` |
| תוכנית HIVE | `curl -s 'localhost:3100/api/saos/energy?net=hive&rc=0.6'` |
| כלכלה | `curl -s 'localhost:3100/api/saos/economy?fly=30'` |
| lint / types | `bun run lint` · `bun run typecheck` |
| **בדיקה מלאה (פקודה אחת)** | `bun run check` — lint+typecheck+test(26)+verify(8 מקבילות); דורש dev רץ |
| בדיקות חוזה בלבד | `bun run test` (scripts/api-check.mjs) |
| בדיקת מקביליות | `bun run verify` (scripts/concurrency-check.mjs; N פרמטרי: `node scripts/concurrency-check.mjs 10`) |
| אימות שרשרת מלא | `curl -s localhost:3100/api/saos/verify-chain \| jq .ok,.receiptChain,.totals` |
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
curl -s localhost:3100/api/saos/status | jq .ok
```

אם `db push` דורש reset (שינוי דורש-מחיקה): הפסק, שקול `prisma migrate dev` לשימור, או הסכם לאיבוד נתוני-ריצה עם גיבוי בצד.

### 4.2 איפוס סביבת פיתוח

```bash
rm -rf .next db/custom.db && bun run db:push && bun run dev
curl -s -X POST localhost:3100/api/saos/seal -d '{}' -H 'Content-Type: application/json'  # פעימה ראשונה
```

### 4.3 הרשאות — איך מגדירים מפתח-מנהל (Task 5)

```bash
# בחר מפתח ארוך ואקראי, שמור אותו אצלך מחוץ לריפו, ושים את ה-hash ב-.env:
node -e "console.log(require('crypto').createHash('sha256').update('YOUR_LONG_KEY').digest('hex'))"
# ב-.env:  SAOS_ADMIN_KEY_HASH=<ה-hash>
# (אופציונלי) SAOS_SESSION_SECRET=$(openssl rand -hex 32)
```

- התחברות: `POST /api/saos/auth {"key":"..."}` → cookie חתום 12h; סקריפטים: `Authorization: Bearer <key>`.
- **fail-closed**: בלי `SAOS_ADMIN_KEY_HASH` כל פעולה רגישה מקבלת 403 auth-unconfigured.
- סיבוב מפתח: החלף את ה-hash + הפעלה-מחדש; שינוי `SAOS_SESSION_SECRET` מבטל את כל הסשנים.
- בדיקה: `GET /api/saos/auth` → `{authConfigured, authenticated}`.

### 4.4 גיבוי ושחזור (Task 5)

```bash
bun run backup                          # snapshot מאומת + manifest + OpLog(verified) + רטנשן 10
bun run restore backups/<dir>           # dry-run — אימות בלבד
bun run restore backups/<dir> --target /tmp/drill.db   # תרגיל בטוח
bun run restore backups/<dir> --yes     # שחזור אמיתי; אחריו RESTART + bun run check
```

- live-gate דורש גיבוי מאומת <7 ימים; cleanup דורש <24 שעות.
- אימות כולל sha256 לכל קובץ + integrity_check + השוואת ספירות; קובץ פגום → נדחה (הוכח).

### 4.5 רטנשן/ניקוי (Task 5)

```bash
bun run cleanup           # dry-run: מה יימחק (protected: seals/leaves/anchors/receipts/findings/audit)
bun run cleanup --yes     # רק עם גיבוי מאומת <24h; אחרת נדחה
```

מדיניות מלאה: docs/database.md §retention.

### 4.6 שער ה-live (Task 5)

```bash
curl -s http://localhost:3100/api/saos/live-gate | jq '{readyForLive, blockers, warnings}'
curl -s -X POST -H "Authorization: Bearer $KEY" http://localhost:3100/api/saos/live-gate | jq .readyForLive
```

חובה לפני כל מעבר ל-live: `readyForLive=true` (אפס blockers). ה-POST מחייב הרשאה ונרשם ב-audit.
זכור: השער מדווח — ההפעלה היא רק restart עם `SAOS_MODE=live + SAOS_LIVE_CONFIRM=YES`.

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

---

## נהלי Task 6 (anchor preflight + עוגן ראשון מבוקר)

### בדיקת טיסה לפני כל עוגן

```bash
curl -s "http://localhost:3100/api/saos/anchor-preflight" | jq '{readyForAnchor, blockers, recommendedNextAction}'
# readyForAnchor=false ⇒ עצור — השלם את החוסמים המפורטים. אין עוקף.
```

### עוגן ראשון מבוקר (5 שלבים — הבעלים מבצע שלב 3 מחוץ למערכת)

1. `GET /api/saos/anchor-preflight` — חסימה אחת = עצירה.
2. `POST /api/saos/signer {network, signer:"manual"}` (הרשאה נדרשת) → payload+digestToSign מוכנים.
3. **הבעלים חותם מחוץ למערכת** — המפתח לעולם לא נכנס למערכת/לסוכן/ללוגים; בידי הבעלים נשאר רק ה-txid הציבורי.
4. `PATCH /api/saos/signer {id, txid, proofRef?, anchorRef?, verify:true}` (הרשאה נדרשת) → recorded (מאומת) או unverified כנה.
5. תוצאה: `recorded` = עוגן מאומת; כל סטטוס אחר אינו עוגן ואינו מוצג ככזה.

### גיבוי לפני כל שלב קריטי

```bash
bun run backup   # חובה לפני: עוגן אמיתי, שינוי-סכמה, cleanup, שחזור
```

preflight נכשל אוטומטית בלי גיבוי מאומת בן פחות מ-7 ימים; cleanup מסרב בלי גיבוי <24h.

### היגיינת סודות — סריקה שגרתית בסוף כל סבב

```bash
git ls-files | grep -iE '\.env$|\.key$|\.pem$|wallet|seed|credential|token|secret|admin|private'
git grep -lIE 'ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE' -- . || echo clean
```

(מסמך-אב: docs/secret-hygiene.md — מרשם SH-1..SH-7 + סבב הסגירה §6; הסודות חיים ב-`~/.secrets/`, מחוץ לעץ.)

### ביטול-סשנים גלובלי (Task 11)

מתי: חשד לחשיפת cookie/מכשיר אובד, סיום-תפקיד, או אחרי רוטציית מפתח-אדמין (סגירה נקייה).

1. התחברות (cookie או Bearer) → `POST /api/saos/auth/revoke-all`.
2. כל הסשנים הפעילים — **כולל שלך** — מתבטלים מיידית (רוטציית epoch; ללא רשימת-סשנים וללא סוד). התגובה מוחקת את ה-cookie שלך.
3. התחברות-מחדש עובדת מיד; האירוע נרשם ביומן-הביקורת (`auth-revoke-all`).
4. UI: מסך אבטחה ומאגר → "נתק את כל הסשנים" → דיאלוג אישור → toast.
5. מפתח Bearer (סקריפטים) אינו מושפע מכוון — לניטרול מפתח עצמו: רוטציה (docs/secret-hygiene.md §7).

### היגיינת מפתח-האדמין (SH-7 — סגור מאז סבב הסגירה, 2026-09-07)

- **בוצע**: הקובץ הועבר מ-`upload/saos-admin-key.txt` אל `~/.secrets/saos-admin-key` עם `chmod 600` (תיקיה 700) — ההעברה בוצעה ב-`mv` בלבד, תוכן הקובץ לא נקרא; `adminKeyFileInTree=false` אומת ב-API.
- המצב הקבוע: אין קובץ-סוד בתוך עץ הפרויקט; קובץ הטוקן עבר באותו אופן אל `~/.secrets/github-token` (600).
- ניטור אוטומטי: `/api/saos/repo-status` → `adminKeyFileInTree` (קיום בלבד) — אם יופיע קובץ-מפתח חדש בעץ, הפריט ייפתח מחדש אוטומטית.
- חשש חשיפה → רוטציה מיידית לפי docs/secret-hygiene.md §7 (מפתח חדש + hash חדש ב-.env, לעולם לא מודפס) + `revoke-all` + תיעוד כפעולת בעלים.

## Task 12 — נהלי אתריום/סולנה (dry-run)

- **בדיקת מצב**: `GET /api/saos/status` → כרטיסי ETHEREUM/SOLANA (`rpcStatus`, `blocker`, `ownerAction`); `GET /api/saos/anchor-preflight?network=ETHEREUM` (וגם SOLANA).
- **אימות-קריאה אופציונלי**: `GET /api/saos/status?probe=1` — רק כש-`ETH_RPC_URL`/`SOL_RPC_URL` מוגדרים ציבוריים-ללא-מפתח; אחרת `probed:false` (כנה).
- **הגדרת RPC (פעולת בעלים)**: ערכים ב-`.env` מקומי בלבד — **אסור** ש-RPC עם מפתח ייכנס לריפו; המערכת דוחה URL עם credentials/מפתח-בשאילתה מעצמה.
- **הכנת בקשת-חתימה יבשה לרשתות החדשות**: מסך חתימות → צור בקשה → רשת ETHEREUM/SOLANA → הוראות חתימה חיצונית (EVM calldata / Solana memo-blockhash) → רישום תוצאה ציבורית בלבד (tx hash / signature) → אימות opt-in.
- **איסורים קבועים**: אין עסקה, אין שידור, אין חתימה, אין ארנק מחובר, אין מימון gas/SOL — עד `SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES` + אישור בעלים מפורש (docs/first-anchor-runbook.md).

## Task 13 — נוהל מצב חי (safe-live)

המערכת בסנדבוקס רצה כעת ב-**live ללא-שידור** (`SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES` — הגנה כפולה; `broadcastCapable` נשאר false עד חותם חיצוני). נוהל מלא: **docs/live-runbook.md** · תיעוד-ראייה: **docs/live-proof.md**. קיצור:

1. בדיקת-חיים שוטפת: `curl -s :3100/api/saos/live-proof` → `service=ok`, `safeLive=true`, `errors=[]`.
2. ב-live, `POST /seal` דורש הפעלה מאומתת (cookie או `Authorization: Bearer <key>`) — ההיגיון: פעימה ב-live נחשבת broadcast-adjacent.
3. הסוויטה מודעת-מצב: api-check מתחבר אוטומטית כשמצב=live (§1b), concurrency-check בהתאמה + Retry-After לחלון-auth; `verify` רץ דרך bun (טוען `.env` אוטומטית — node לא).
4. חלון ה-auth (8/min, 60s) מתרוקן ע"י ה-burst בסוף api-check — בין ריצות עוקבות חכו ~60s (הסוויטה עצמה מתקנת זאת בניסיון-חוזה מבוקר).
5. חזרה ל-dry-run: `SAOS_MODE=dry-run` ב-`.env` + הרצה-מחדש.
