# SAOS Sovereign Foundry v2 — תיעוד הנדסי

> מפתח-התיעוד. כל קובץ כאן נכתב לפי עקרון אחד: **מה שחשוב — כתוב בריפו**, לא בצ'אט ולא בזיכרון.

- **גרסה**: 2.2.0 (Task 5 — Live Gate, Keyless Anchor Readiness & Production Hardening)
- **שכבת אבטחה**: auth (hash+cookie חתום) · rate-limit · AuditEvent · live-gate · תור-חתימה keyless · backup/restore/cleanup מאומתים · bun audit = 0
- **מוטו**: אנחנו מנצחים את הבלוקצ'יין
- **מצבי פעולה**: dry-run (ברירת-מחדל) / safe / live (דורש אישור-כפול) / maintenance — ר' runbook
- **מצב עגינה ציבורית (נכון ל-2026-09-07)**:
  - STEEM ✅ עוגן — רפרנס חלקי `3452e62bc3bf5b…dee9ee1003` (custom_json `saos.weave.v1`)
  - BLURT ✅ עוגן — רפרנס חלקי `50a857ccaf49bd…5c4c3e6a9c` (חתימה קנונית ידנית)
  - HIVE ⏳ gated — rc-floor(0.6%<8%) — המתנה כנה, לא מבוימת
  - TRON 🚧 transit — root נישא בתוך stateRoot דרך רכבת tronbridge היומית
- **מצב חתימה בסנדבוקס**: `advisory-mode` — אין מפתחות חתימה; הפלטפורמה מחשבת שורשים ותוכניות ומדווחת בכנות. שידור אמיתי דורש שחזור כספת.

## מפת הקבצים

| קובץ | תוכן |
|---|---|
| [architecture.md](./architecture.md) | מטרת המערכת, רכיבים, זרימה, תלויות, נקודות כשל, אימות ואבטחה, מצבי עבודה |
| [api.md](./api.md) | כל 13 ה-endpoints: method, קלט, פלט, שגיאות, דוגמאות, סטטוס, 401/403/429 |
| [database.md](./database.md) | סכמה, טבלאות, אינדקסים, אילוצים, גיבוי ושחזור, נקודות תורפה |
| [testing.md](./testing.md) | איך מריצים בדיקות, תוצאות אחרונות, מה לא מכוסה |
| [security.md](./security.md) | מודל איומים, סודות, גבולות אמת, מה מוגן ומה לא |
| [runbook.md](./runbook.md) | הרצה, משתני סביבה, בריאות, תקלות נפוצות, תחזוקה |
| [decisions.md](./decisions.md) | החלטות הנדסיות: מה, למה, חלופות, סיכון, תועלת |
| [next-steps.md](./next-steps.md) | תוכנית העבודה מסודרת בעדיפויות עם סטטוס |
| [deployment.md](./deployment.md) | פריסה מחוץ לסנדבוקס: סביבה, משתנים, מצבים, אסור-בלי-אישור |
| [../worklog.md](../worklog.md) | יומן עבודה חי — append-only, חובה לכל סוכן |

## פקודות בסיס

```bash
bun run dev        # שרת פיתוח (פורט 3000)
bun run check      # lint + typecheck + test (45 בדיקות API) + verify (8 פעימות מקבילות)
bun run backup     # גיבוי מאומת (integrity+counts+manifest)
bun run restore    # שחזור מאומת — dry-run ברירת-מחדל, --yes לביצוע
bun run cleanup    # רטנשן — dry-run ברירת-מחדל, --yes דורש גיבוי <24h
```

## חוקי ברזל של הפרויקט

1. **API לעולם לא מחזיר 500** — שגיאה היא נתון: `{"ok":false,"error":"..."}` עם HTTP 200. יוצאי-מכחול (Task 5): 401/403/429 **רק** לשכבת האבטחה, תמיד עם body JSON.
2. **כנות מעל הכול** — אין txid מבוים. סטטוס שלא הושלם מסומן `pending`/`gated`/`transit` עם סיבה מפורשת.
3. **JSON קנוני בלי float** — כל דיג'סט בפלטפורמה עובר דרך `canonicalize` (מספרים שלמים בלבד, מיון מפתחות).
4. **שגיאה = throw, לא השתקה** — הקרנל fail-closed; אסור שידרדר בשקט.
5. **כתיבה אטומית** — כל seal רץ בטרנזקציה אחת מאחורי mutex + retry; height מונוטוני ללא דילוגים או כפילויות (מוכח ב-8 פעימות מקבילות).
6. **אין דרך מקרית ל-live** — נדרשים שני דגלים עצמאיים: `SAOS_MODE=live` + `SAOS_LIVE_CONFIRM=YES` + live-gate נקי (0 blockers).
7. **חוק-הזהב של החתימה** — המערכת מייצרת SignRequest; החתימה מחוץ למערכת; חוזר רק txid ציבורי. מפתח פרטי לא נכנס, לא נשמר ולא נשלח — במבנה, לא בנוהל.
8. **כל פעולה רגישה = הרשאה + ביקורת** — 401/403 בלי אישור; כל ניסיון (מוצלח או נדחה) נרשם ב-AuditEvent בלי חומר-מפתח.
9. **אין מחיקה בלי גיבוי מאומת** — cleanup מסרב בלי גיבוי <24h; restore מסרב לקובץ שעבר-שינוי (הוכח).
7. **סוף כל סבב**: check → commit → push → עדכון worklog.md → סיכום.
