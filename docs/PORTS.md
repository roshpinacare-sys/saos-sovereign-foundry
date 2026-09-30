# PORTS — רישום-הפורטים הקנוני של האקוסיסטם (2026-09-29, Task 7-b)

**כלל-אב**: אין-שירות-חדש בלי רישום-כאן. פורט-כפול = פריט-CI הבא
(מועמד ל-`ecosystem-drift-guard` ב-Domain — כמו שה-3005/3042 נתפסו ידנית,
הדורות-הבאים ייתפסו אוטומטית). כל-שורה נבדקה ב-grep על הקוד-החי (לא על
תיעוד); תאריך-הבדיקה: 2026-09-29.

## הטבלה-הקנונית

| פורט | שירות | ריפו | מקור-אמת בקוד | הערות |
|---|---|---|---|---|
| **3000** | web — saos-sovereign-platform (האם) | saos-sovereign-platform | `package.json` → `next dev -p 3000` | הממשק-הראשי; Caddyfile: הכל 403 (Task-5) |
| **3100** | web — saos-sovereign-foundry (שער-הרשת) | saos-sovereign-foundry | `package.json` → `next dev -p 3100` | **תוקן 2026-09-30 (Task 10)**: חי בפועל על :3100 — הרישום הקודם "3000" היה מיושן מול-החי; package.json + api-check/concurrency BASE + בדיקות-הבריאות של rotation-keeper/chief-of-staff/fleet-cure יושרו כולם ל-:3100 באותו-commit |
| **3003** | relay-service (ריליי-סוכנים) | saos-control-center | `mini-services/relay-service` + `scripts/boot-all.ts` | emit-מושתת על 3004 |
| **3004** | relay-emit (סלוט-הפליטה של הריליי) | saos-control-center | `mini-services/revenue-governor/index.ts` → `RELAY_EMIT :3004/emit` | ⚠️ כנגד-ה-heart-service למטה — כפילות-פוטנציאלית בין-מכונות, להכריע ב-CI |
| **3004** | heart-service (פעימת-הלב, twin) | Saosmartwallet (Zip) | `mini-services/heart-service/index.ts:119` → `HEART_PORT ?? 3004` | נפוץ-טעות-שיוך: **אינו ב-steem** — steem מכיל רק את key-broker הפרוש |
| **3005** | keeper / SHOMER (השגחה-הדדית + גיבויים) | saos-sovereign-platform | `src/lib/saos/supervisor-node.ts:72` → `port: 3005` | **היה-בעיה**: revenue-governor של control-center ישב-כאן והתנגש — הועתק ל-3042 (Task 7-b) |
| **3010** | dex-daemon (דמון-הדקס, THE-MICRORAIL) | saos-control-center | `mini-services/dex-daemon/package.json` → `next dev -p 3010 -H 127.0.0.1` | strict-port guard (R17-c·F3) — מסרב-לעלות על-3010 תפוסה |
| **3031** | vault-guardian | saos-sovereign-foundry | `mini-services/vault-guardian/index.ts:32` → `const PORT = 3031` | כספת-המשמר |
| **3032** | chief-of-staff | saos-sovereign-foundry | `mini-services/chief-of-staff/index.ts:30` → `const PORT = 3032` | ראש-המטה |
| **3033** | external-signer (כספת-החתימה AES-256-GCM) | saos-sovereign-foundry | `mini-services/external-signer/index.ts:60` → `SIGNER_PORT ?? 3033` | **הרכיב-היחיד** שנוגע-בחומר-מפתח; Bearer |
| **3034** | fleet-cure | saos-sovereign-foundry | `mini-services/fleet-cure/index.ts:34` → `FLEET_CURE_PORT ?? 3034` | ריפוי-צי |
| **3035** | rotation-keeper (מחזיק-הרוטציה הקבועה) | saos-sovereign-foundry | `mini-services/rotation-keeper/index.ts:40` → `const PORT = 3035` | 5 beats קבועים; kill-switch `SAOS_NO_ROTATION=1` |
| **3040** | key-broker (EVM/TRON/SOL/BTC) — **קנוני** | saos-sovereign-foundry | `mini-services/key-broker/index.ts:32` → `const PORT = 3040` | העותק-ב-steem (`steem/mini-services/key-broker`) מסומן **DEPRECATED — do not start** (אותו-פורט, md5 שונה — סכנת-הרצה-כפולה) |
| **3042** | revenue-governor (המושל-הכלכלי) | saos-control-center | `mini-services/revenue-governor/index.ts:40` → `const PORT = 3042` | **הועבר מ-3005** ב-2026-09-29 (Task 7-b) — התנגשות-עם keeper/SHOMER של הפלטפורמה; כל-הפניות בריפו עודכנו (watchdog/boot-all/revenue-route) |
| **TBD** | dex-daemon (סטאב) — נקודת-החלטה | saos-dex | `saos-dex` = stub `package.json` בלבד (נתיבי-`/home/z/my-project` מוצקים) | אין-קוד-שרת בריפו → אין-פורט לאמת; הפורט-הפעיל כרגע 3010 דרך control-center |

## כללי-ממשל (governance rules)

1. **רישום-חובה**: כל-שירות-חדש (mini-service/daemon) חייב שורה-כאן באותו-PR
   שמוסיף את הקוד — פורט-ללא-רישום = טענה-בלי-ראיה (באג-לפי-מוסכמת-ה-API).
2. **איסור-כפילות**: אותו-פורט על **אותה-מכונה** אסור; כפילות **בין-מכונות**
   מסומנת ⚠️ ונדרשת-החלטה-מתועדת. כפילויות = פריט-ה-CI הבא ב-`ecosystem-drift-guard`.
3. **מקור-אמת**: כל-שורה מציינת קובץ+שורה שאפשר לגרופ; תיעוד-לא-תואם-קוד →
   הקוד-צודק והתיעוד מתוקן-מיד (או להפך, ב-commit ייעודי).
4. **סדר-התייחסות**: שינוי-פורט = עדכון-כל-הקוראים באותו-commit (הלקח-מ-3005→3042:
   watchdog, boot-all, מסלולי-API ו-package.json הוזנחו-פעם-אחת — לא-שוב).
