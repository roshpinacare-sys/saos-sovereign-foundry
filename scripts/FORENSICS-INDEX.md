# מפתח סקריפטי-הפורנזיה (scripts/) — משימה 47

> כל הסקריפטים כאן קריאה-בלבד לגבי הכספת: אסור להם להדפיס חומר-סודות; הם מתעדים פסקי-דין בלבד.
> סטטוס: ארכיון-חקירה היסטורי — לא חלק מריצת-הייצור.

## אשכול בלורט (4 סקריפטים כמעט-תאומים — שאריות-דיבוג מסודרות)
| סקריפט | שורות | תפקיד |
|---|---|---|
| blurt-scheme-forensics.cjs | ~137 | אבחון סכימת-חתימה/רשת של BLURT (שלב 1) |
| blurt-scheme-forensics2.cjs | ~139 | המשך — וריאציה עם נתיבי-גזירה מתוקנים |
| blurt-sign-diag.cjs | ~139 | אבחון חתימה ישיר (txid לא-מותאם — השורש שתוקן במשימה 35b) |
| blurt-sign-diag2.cjs | ~137 | וריאציית-אימות לאחר התיקון |

## אימות-מפתחות מול-חי
| סקריפט | תפקיד |
|---|---|
| verify-hadekor-live.cjs | מאמת את ערכת upload/הדקור.txt מול הרשויות-החיות של headcorner (STEEM/HIVE) — פסקי-דין בלבד |
| master-key-proof.cjs | הוכחת-גזירה ממפתח-האב (ללא חשיפת חומר) |
| authority-graph-proof.cjs | גרף-הרשויות של החשבון מול השרשרת |
| p-key-connect-test.cjs | בדיקת-התקשרות מפתח-P (הסיסמה שנראית כ-WIF) |

## כלי-אופס/תשתית
| סקריפט | תפקיד |
|---|---|
| api-check.mjs | סוויטת-198 הטענות (bun run test; Task 10 2026-09-30: 191 report() + 7 envReport() call-sites — הרישום הישן "121" היה קפוא) |
| concurrency-check.mjs | בדיקת-מקביליות (bun run verify) |
| release-truth-audit.mjs | סקר-אמת-שחרור |
| backup.mjs / restore.mjs / cleanup.mjs | גיבוי/שחזור/ניקוי (bun run backup/restore/cleanup) |
| deep-agent-audit.cjs | סקירת-סוכנים עמוקה |
| build-vault-task36.cjs | בניית-כספת (משימה 36) |
| fleet-vault-template.cjs | תבנית-כספת צי |
| decrypt-key-backup.mjs | פענוח-גיבוי מפתח (נתיב מקומי בלבד) |
| classify-upload.cjs | סיווג קבצי-upload — לעולם לא מדפיס חומר גולמי |
| org-wide-sweep.cjs | סריקת-ארגון רחבה |
| backfill-receipt-at.ts | מילוי-אחורה של קבלות-ראיות |

## dotfiles ב-external-signer
`.d10.ts` / `.derive6.ts` — ניסויי-גזירה ROT1 חד-פעמיים (משימה 30); נקיים-סודות, לא-מיובאים ע"י אף-קוד; הוחלפו בבליעת-המפתות-האמיתיים (משימה 43); נשמרו כהיסטוריית-חקירה עם כותרת-הסבר בראשם.
