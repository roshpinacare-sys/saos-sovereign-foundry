# SAOS Sovereign Foundry v2 — תיעוד הנדסי

> מפתח-התיעוד. כל קובץ כאן נכתב לפי עקרון אחד: **מה שחשוב — כתוב בריפו**, לא בצ'אט ולא בזיכרון.

- **גרסה**: 2.4.x (roast 63 — עדכון-אמת: ספירות/מצבים מול ראיות-חיות)
- **שכבת אבטחה**: auth (hash+cookie חתום) · rate-limit (כל ה-routes, לרבות owner-keys-GET roast 63) · AuditEvent · live-gate · תור-חתימה keyless · backup/restore/cleanup מאומתים · bun audit = 0
- **מוטו**: אנחנו מנצחים את הבלוקצ'יין
- **מצבי פעולה**: dry-run (ברירת-מחדל) / safe / live (דורש אישור-כפול) / maintenance — ר' runbook. **מ-Task 26/47: live עם חותם-חיצוני מחובר (:3033) ועגינות-חיות** — ההגבלה: custom_json בלבד, ללא העברות-נכסים
- **מצב עגינה ציבורית (נכון ל-roast 63, 2026-09-10)**:
  - STEEM ✅ עגינות-חיות מרובות — custom_json `saos.weave.v1`, txid מאומת חי (ר' docs/evidence/ANCHOR-PULSE-2026-09-10.md)
  - BLURT ✅ עגינות-חיות מרובות — חתום headcorner (מפתח-הבעלים) ואומת על mainnet (rpc.beblurt.com)
  - HIVE ⏳ gated — rc-floor; סלוטי-הצי אינם טעונים במעטפת-הנוכחית (תוקן-תיעוד Task 59 — הטענה "9/9" הייתה מ-09-09); weave ממתין גם-לסלוטים וגם לחלון-RC (ר' fleet-cure + KEYS-VAULT-LEDGER)
  - TRON 🚧 transit — root נישא בתוך stateRoot דרך רכבת tronbridge היומית
- **מצב חתימה בסנדבוקס**: `live-external-signer` — החותם-החיצוני (:3033) מחזיק מעטפת מוצפנת מאומתת; האפליקציה מקבלת txid ציבורי בלבד (Task 26, הנחיית-בעלים); headcorner 12/12 סלוטים (כולל BLURT owner — Task 59) + tov 4/4 BLURT (תחייה 09-10); מצב-חי-תמיד: `docs/KEYS-VAULT-LEDGER-2026-09-10.md`

## מפת הקבצים

| קובץ | תוכן |
|---|---|
| [architecture.md](./architecture.md) | מטרת המערכת, רכיבים, זרימה, תלויות, נקודות כשל, אימות ואבטחה, מצבי עבודה |
| [ui.md](./ui.md) (חדש Task 10) | מרכז השליטה: 7 מסכים, רכיבים, מצבי שגיאה/ריק/חסום, מקורות נתונים, נגישות, RTL |
| [api.md](./api.md) | ה-endpoints המתועדים בפירוט (25 בפועל — roast 63 הוסיף סעיף מפה-מרוכזת ל-7 המשטחים הכספיים שלא תועדו) |
| [database.md](./database.md) | סכמה, טבלאות, אינדקסים, אילוצים, גיבוי ושחזור, נקודות תורפה |
| [testing.md](./testing.md) | איך מריצים בדיקות, תוצאות אחרונות, מה לא מכוסה |
| [security.md](./security.md) | מודל איומים, סודות, גבולות אמת, מה מוגן ומה לא |
| [live-proof.md](./live-proof.md) (חדש Task 13) | הוכחת-חיים מתועדת: 3 רמות, evidence חי לכל רשת, עמדת safe-live, מה לא נעשה |
| [live-runbook.md](./live-runbook.md) (חדש Task 13) | סולם-המצבים, הפעלת safe-live, כללי מותר/אסור במצב חי, תקלות מוכרות |
| [BREAKTHROUGH.md](./BREAKTHROUGH.md) (חדש Task 14) | המסמך המרכזי של פריצת-הדרך: השעון האטומי המבוזר — בעיה, פתרון, חדשנות, הוכחה חיה, benchmarks, שימושים |
| [breakthrough-comparison.md](./breakthrough-comparison.md) (חדש Task 14) | השוואה מפורטת מול התעשייה: מתודולוגיה, מה נמדד חי מול מה ערך-עזר, מקורות |
| [technological-audit.md](./technological-audit.md) (חדש Task 14) | אודיט קוד (code archaeology): מה ייחודי/סטנדרטי/נחות — DAG סובל-פיצולים, גבול-אמת encoded, שעון אטומי |
| [runbook.md](./runbook.md) | הרצה, משתני סביבה, בריאות, תקלות נפוצות, תחזוקה |
| [decisions.md](./decisions.md) | החלטות הנדסיות: מה, למה, חלופות, סיכון, תועלת |
| [next-steps.md](./next-steps.md) | תוכנית העבודה מסודרת בעדיפויות עם סטטוס |
| [deployment.md](./deployment.md) | פריסה מחוץ לסנדבוקס: סביבה, משתנים, מצבים, אסור-בלי-אישור |
| [../worklog.md](../worklog.md) | יומן עבודה חי — append-only, חובה לכל סוכן |

## פקודות בסיס

```bash
bun run dev        # שרת פיתוח (פורט 3000)
bun run check      # lint + typecheck + test (136+ assertions API; 177 כשמריצים מאומת-מפתח-בעלים) + verify (8 פעימות מקבילות)
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

---

## מפת מסמכים — עדכון Task 6

| מסמך | תוכן |
|---|---|
| **secret-hygiene.md** (Task 6, עודכן Task 11) | סריקת-סודות, מרשם SH-1..SH-7, כלל hash-בלבד, נוהל רוטציה |
| **owner-decisions.md** (חדש Task 11) | חוזה ההחלטות, כלי-הסגירה, SH-7, הכללים הקבועים |
| **first-anchor-runbook.md** (חדש Task 11) | תנאי-פתיחה, בחירת רשת, 10 שלבי עוגן, אסורים, מוכנות חיה |
| **anchor-preflight.md** (חדש Task 6) | חוזה ה-endpoint, 10 הבדיקות, תוצאה חיה, תהליך העוגן-הראשון (5 שלבים) |
| **external-signer.md** (חדש Task 6) | רישום החותמים, מחזור-החיים המלא, אימות-txid הציבורי, אזהרת-כספת |

## Task 12 — מסמכים חדשים

- **`docs/multi-agent-map.md`** — מיפוי זהיר של תיקיות סוכנים אחרים בסביבת העבודה ושל 8 ריפואי הבעלים ב-GitHub (מטא-דאטה בלבד; כללי קריאה מוצהרים; שני ממצאי-אזהרה מסומנים).
- **`docs/cross-agent-findings.md`** — מסקנות הנדסיות: מה נמצא/שווה/מסוכן; **כלום לא הועתק** — הרחבת ETH/SOL נעשתה native.
- **`docs/ethereum-solana-integration.md`** — התכנון המלא של שילוב אתריום+סולנה ב-dry-run: מודולים, כובלי RPC-safety, חוזה API, UI, בדיקות, מה לא נעשה בכוונה.
