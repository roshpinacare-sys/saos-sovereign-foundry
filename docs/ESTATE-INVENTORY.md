# ESTATE-INVENTORY · מה קיים כרגע — אמת מלאה (T-9, 2026-09-29)

> תשובה ישירה לשאלת-המפעיל: "מה יש לנו בכלל כרגע בכל הגיט?"
> כל שורה כאן נמדדה היום — לא מועתקת מקבצי-KPI היסטוריים.

## 1 · מה אבד (ולמה)

| נכס | מצב | השפעה |
|---|---|---|
| `/home/z/audit` — 16 רפו (Console, Zip, saos-dex, saos-sovereign-platform, Defi, …) | **נמחק** באיפוס-סביבה | אבדו: FLEET-LOG, CLAIMS board, MISSION-1000, mover/curate/observe מקומיים |
| filebin `u79d88ici4tit6x8` | **ריק** (נאמד ב-API: files:null) | לא ניתן לשחזר משם |
| GitHub PAT (חולץ מ-pat.rar) | **אבד עם הדיסק** | אין גישת-דחיפה לרפו המרוחקים |
| `/tmp/keystation` — 14 קבצי-מפתחות | **נמחק** | חתימה מקומית בלתי-אפשרית (וגם: החומר ההיסטורי נשרף ממילא — SETTLE-10) |
| יומן-mover-log / pnl.json / KPI.json | **אבדו** | יומן-החותם ההיסטורי נשאר כראיה-על-שרשרת (txids ציבוריים) |

## 2 · מה שרד ונבנה-מחדש — המערך הנוכחי

### 2a · מנוע-ריבוני-מקומי (`mini-services/saos-engine`, פורט 3040) — חדש ב-T-9
- **keyless לחלוטין** — קריאת-מדידה מציבורי + state מקומי; חתימה = שער-אופרטור לנצח (מדיניות, לא באג)
- `index.ts` — HTTP: `/health`, `/status`, `/cycle` (POST), `/live`, `/fills`
- `measure.mjs` — מדידות keyless: סולם-צמתים RPC (boylikegirl→justyy→steemit), פאריטי חוץ (binance→coingecko→coinpaprika→feed-פנימי עם דגל-ביטחון), יתרות, ספר-פתוח, מילויים, **דלק נמדד-עצמאית מ-account_history**
- `lib.mjs` — ליבה טהורה-דטרמיניסטית: planLadder (חוק-רצפת-ערך VF1 + skew), planConvert (PSM-hysteresis), classifyStale, pnlFromFills (unbased ≠ רווח), guardDepth
- `grid.mjs` — רשת-טריגרים (דבר-גורר-דבר): 4 מיקרו-גרידים, guard depth-8/fires-64
- `daily.mjs` — מחזור-אוטונומי: observe→tick→peg→convert→report (execute=OPERATOR-GATE כנה)
- `selftest.mjs` — **47/47 וקטורים דטרמיניסטיים אופליין · PASS**
- `state/` — observe/offer/convert-plan/daily-report/events.jsonl (נכתבים בכל-מחזור)

### 2b · תא-הפיקוד (my-project, פורט 3000)
- `/` — דשבורד RTL: מנוע-חי/כבוי, כפתור "הרץ מחזור", מד-אמת, רווחיות-אמת, מסילות, משימה, פאריטי, יתרות, סולם-חי, רשת-טריגרים, יומן-אירועים
- `/api/saos/status` — מצביע ל-state מקומי + קריאת-שרשרת-חיה (A-10 P&L מ-fill_order)
- `/api/saos/engine` — proxy: GET=status, POST=מחזור

### 2c · ראיות-על-שרשרת (לא ניתנות לאיבוד)
- headcorner: 10001 פעולות בהיסטוריה · 37 מילויי-אמת בחלון · ~348 פקודות סולם היסטוריות
- כל txids מ-T-4/T-6/T-7/T-8 ציבוריים וניתנים-לאימות מול condenser_api
- יתרה נזילה נמדדת היום: **925.27 STEEM + 3.142 SBD** (הספר ריק — ההון ממתין לפריסה)

## 3 · אמת-כלכלית נמדדת היום (2026-09-29)

| מדידה | ערך | מקור |
|---|---|---|
| ספר-פתוח | **0** (ריק באמת — ordersOk:true) | condenser_api.get_open_orders |
| דלק-קיורציה | **$0/יום** — קיור-אחרון **2026-09-09** (44 פעולות היסטוריות) | סריקה-עמוקה 10001 ops |
| פרס-מחבר | $0/יום (6 היסטוריים) | כנ"ל |
| מילויים-ממומשים | −0.016 SBD (איזון-אמת) | pnlFromFills על fill_order חי |
| שוק-חוץ SBD | **התאדה** — נמחק מ-binance (SBDBTC "Invalid symbol"), poloniex, upbit, mexc, lbank; coinpaprika: is_active:false | סקר-חי של 6 מקורות |
| פאריטי | 0.1041 SBD/STEEM — **מקור-השרשרת הפנימי הוא האורקל היחיד שנותר** (מסומן ביטחון-מופחת) | get_feed_history |
| STEEM/USD | $0.0638 (binance + coinpaprika צולבים) | סולם-מחירים |

## 4 · שערים להפעלה (מה חוסם את $1000/יום)

1. **X-1 · חתימה** — פריסת 925 STEEM דורשת active-key חי. החומר-ההיסטורי נשרף; נדרש מפתח-חדש-מסוקף מהמפעיל (מומלץ: account-חדש ייעודי + סוד-Actions)
2. **C-1 · פוסטינג** — הפעלת-קיורציה מחדש דורשת posting-key (מסילת $0.1–0.2/יום נמדדה-היסטורית, תלויית-SP)
3. **X-2 · הון** — מדרגת-$1000/יום דורשת הון בדרגות $33K–$16.7M בהתאם לתפוסה/מחזור (תמחור-מלא ב-worklog T-2e)

**המנוע מוכן לכל-שער שייפתח**: בכל-מחזור נבנית תוכנית OFFER-READY דוקטרינית (אסקים ≥ רצפה, בידים ≤ תקרה) וממתינה לחותם.
