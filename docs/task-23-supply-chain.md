# Task 23 — סריקת שרשרת-אספקה (Supply-Chain / Saboteur Sweep)

**תאריך**: 2026-09-08 · **מנדט**: הבעלים — "תמשיך יותר עמוד... רק צריך להיזהר שלא ייכנס לנו קוד זר של איזה חבלן מהרשת לרשת... כתוב לריפו"
**שיטה**: 3 סוכני-משנה מקבילים (23-b/23-c/23-d) + מתאם שהשלים את 23-a (steem) בעצמו לאחר תקלת max-turns. דיסציפלינה: **קריאה-סטטית בלבד — אף שורת קוד מה-repos לא רצתה** (כלל החבלן הוחל עלינו עצמנו), אפס הדפסת ערכי-סודות, כל קביעה עם file:line.
**סקירה**: 10 repos (clones ב-/tmp/agent-audit/, טריים מ-Task 21) · Saosmartwallet 1,362 קבצים נסרקו במלואם.

---

## פסק-דין ראשי

**אפס קוד-זר/חבלן נמצא באף ריפו.** שרשרת-האספקה נקייה:

| בדיקה | תוצאה |
|---|---|
| Typosquat בתלויות (1,057 שמות ב-lockfile של ה-wallet + כל ה-manifests) | **0 חשודים** |
| מקור tarballs (bun.lock wallet + platform) | 1,876/1,876 = registry.npmjs.com בלבד, sha512 על הכל |
| Lifecycle hooks (preinstall/postinstall/prepare) | **0** בכל ה-manifests |
| eval / new Function / remote-dynamic-import / obfuscation / .wasm/.node/מינified מחוץ ל-dist | **0** |
| Endpoints לא-מוכרים | רק RPC ציבוריים מוכרים של שרשראות (ראה F-7/F-9) |
| Git plumbing (remotes/hooks/workflows) | נקי — כל ה-remotes ל-roshpinacare-sys בלבד, hooks לדוגמה, אין workflows עם exfil |

Sdk = **ריפו ריק** (0 קומיטים) — אין מה לסרוק; ייסרק ב-push הראשון.

---

## ממצאים (היגיינה/עיצוב — לא חבלן)

### 🔴 CRITICAL — החלטת בעלים (הפריט השמור שלי)
**`saos-sovereign-platform/scripts/anchor-sovereign-mnemonic.ts` = חומר-מפתח בצורת-קוד, ב-repo פרטי.**
ניתוח מבני עיוור (אפס הדפסת תוכן):
- קומיט יחיד **היום**: `3653ce5` "SAOS v16.0.0 — SOVEREIGN KEY: owner's key anchored, flowed, enlisted"
- 205 שורות קוד (51 consts, 104 `;`, 8 חצים, 0 imports) — **סקריפט**, לא קובץ-מפתח גולמי
- `const phrase` בשורה 31 — RHS בן 35 תווים **שאינו מתחיל במרכאות** → הביטוי נטען/מורכב בזמן-ריצה, לא literal ישיר
- **11 מילים ייחודיות באותיות-קטנות מפוזרות בשורות-קוד** (21, 23, 24, 27, 46, 51, 53, 98, 118) — אף אחת לא בהערות, אף אחת לא placeholder, אפס התאמה לוקטורי-בדיקה קנוניים (test/abandon/hardhat) — תבנית עקבית עם **פיזור/שברור מילות-צירוף בתוך הקוד**
- 32 literals נושאי-ספרות (שמות-חשבון/נתיבים)
- **נקודה-עיוורת של ה-guardian**: ה-blacklist שלו מבוסס-נתיב (`agent/fleet_keys.enc`, `agent/keys/`, `.enc`) — קובץ ב-`scripts/` לא נופל באף כלל → לעולם לא יסומן
- **אין גיבוי ב-vault-recovery** — העותקים היחידים: ה-repo המקומי + GitHub (פרטי)

**המלצה לבעלים** (מיישר-קו עם הודעת הקומיט של ה-platform עצמו "history rewrite pending operator"): קריאה אישית של הקובץ (שניות) → אם חי: העברה למעטפת (תבנית fleet_keys.enc) + stub שטוען מ-env + כתיבת-היסטוריה משותפת עם F-1. **אנחנו לא נוגעים — סדר-יום קיים: המפתחות בידי הבעלים.**

### 🟠 HIGH
| # | ממצא | ראיה |
|---|---|---|
| F-1 | טוקן GitHub + `.env` + ledger-db בהיסטוריה-עמוקה של platform (untracked ב-HEAD; הודעת-קומיט מאשרת: "history rewrite pending operator") | `5bb5ef1` show: `D .env`, `D db/custom.db`, `D upload/Roshcaregt.txt` |
| F-2 | `fleet_keys.enc` (29,089B) + `.env` אטומים בתוך ZIP מקומט ב-Project-files | `unzip -l "steem-main (1).zip"` |
| F-3 | **DEX: 9 נתיבי-POST משני-מצב ללא שום auth** (הוכחה מלאה מטה) + bind לכל-הממשקים | matrix למטה; `package.json:7,9` אין `-H` |
| F-4 | **steem: he_sell/he_unstake — ברירת-מחדל חיה, `--dry` opt-in** (הוכח מחדש, file:line) | `he_sell.cjs:41`, `he_unstake.cjs:39`, broadcast אמיתי `he_sell.cjs:134` |
| F-5 | טוקן היה ב-`.git/config` של **כל 10 ה-clones** (http.extraHeader מ-Task 21) — מקומי בלבד, מעולם לא נדחף | **תוקן במשימה זו**: scrub 10/10, נותרו 0 |

### 🟡 MEDIUM / 🔵 LOW
| # | ממצא | ראיה | חומרה |
|---|---|---|---|
| F-6 | pass-beside-ciphertext: ה-passphrase של fleet_keys יושב בקובץ אח/י (`fleet_keys.meta.json`) | platform `vault-seal.ts:56-58` | MED |
| F-7 | 13 RPC ציבוריים hardcoded ב-platform (publicnode/drpc/mevblocker/llamarpc/trongrid/hive trio) — שירותים מוכרים, ללא קרדנשלים | `eth-sol-live.ts:34-36` ועוד | LOW |
| F-8 | `eth.rpc.blxrbdn.com` כברירת-מחדל לנתיב ETH ב-DEX — ככל-הנראה bloXroute, נדרש אישור בעלים | saos-dex `.env.example:19` | MED |
| F-9 | jumpper: נודי witness קהילתיים (`api.developer.witnesses.lol`, `steem.61bts.com`) — קריאה-בלבד, התנהגות-כנה בכשל | `graphene.py:255-256` | LOW |
| F-10 | audit-package של ה-DEX שחוק: `FIDELITY.diff` טוען byte-identical אך 8 מודולים שונים (prod חדש יותר, benign) | `audit-package/FIDELITY.diff:5-7` | MED |
| F-11 | ארטיפקטים ב-git: `db/custom.db` (מפתחות מוצפנים-hash בלבד, 5 שורות), 13 `.pyc`, `dev.pid`, tool-results | wallet | LOW |
| F-12 | exec route ב-steem: **0 auth** אך whitelist-gated (16 סקריפטים, כולל on-chain: harden/escrow/anchor/registry/kv/genesis/factory) + cooldown. **he_sell/he_unstake אינם ברשימה** | `exec/route.ts:38-140`, POST `:331` | MED |

---

## הוכחות P0 (file:line, מדויק)

**DEX — מטריצת auth מלאה** (אין `src/middleware.ts`; grep authorization/bearer/cookie/session ב-src = 0):
order `:7`→submitOp `:24-31` · swap `:18`→`:27-32` · pool `:7`→`:18-31` · cancel `:7` (בדיקת-בעלות = השוואת-מחרוזת `:14`) · wrap `:7`→`:17-22` · faucet `:7`→`:8` · **reset `:7`→מחיקה ל-genesis `:8`** · arena `:12`→`:14` · settle `:64`→mint_fuel `:79` — **כולם: אין auth**.
מרגיע: כסף-מדומה; שערי-broadcast אמיתיים env-gated (`relay-eth.ts:142`, `relay-sol.ts:110`); אבל מה שקורה ב-ledger עוגן לשרשראות ציבוריות.

**steem daemons — live-default**:
```
he_sell.cjs:41    const DRY = process.argv.includes('--dry');
he_sell.cjs:134   await rpcV4(HIVE_RPC, {... 'condenser_api.broadcast_transaction', params:[signed], ...});
he_unstake.cjs:39 const DRY = process.argv.includes('--dry');
```

---

## תיקונים שבוצעו במשימה זו
1. **Scrub קרדנשלים**: `http.extraHeader` הוסר מ-`.git/config` של כל 10 ה-clones (אימות: 0 נותרו). ערך-הטוקן לא נגע ולא הודפס; fetch/push עתידי דרך GIT_ASKPASS בלבד.
2. השלמת 23-a (steem) ע"י המתאם לאחר תקלת max-turns של הסוכן — הראיות למעלה.

## תור החלטות-בעלים (מעודכן)
1. **mnemonic.ts** — קריאה אישית → vault+stub+history-rewrite (אין גיבוי חלופי!)
2. fleet_keys היסטוריה-עמוקה (steem) + F-1 platform — כתיבת-היסטוריה אחת מתואמת
3. ZIPs ב-Project-files (F-2/F-3) — הסרת ZIPs/ניקוי
4. סבב-רוטציה של הטוקן (הבעלים) — ה-scrub מקומי כבר בוצע

## צעדי-P0 לסוכנים הבעלים (ללא התנגשות)
- **סוכן steem**: היפוך ברירת-מחדל ל-dry (`--live` opt-in) ב-he_sell/he_unstake ובכל he_*
- **סוכן dex**: middleware auth (signature/token) על כל POST + `-H 127.0.0.1` ב-dev/start; ורגנרציה של audit-package
- **סוכן platform**: לא לגעת ב-mnemonic.ts — החלטת בעלים; עד אז להוסיף אותו ל-blacklist ה-guardian (זכוכית-מגדלת, לא מחיקה)

## מה לא אומת ומדוע
- הרצת tests/bind אמיתי — אסור ע"פ כלל-החבלן (אף קוד לא רץ)
- תוקף registry-חי של חבילות — אין גישת-רשת בסריקה; מרוכך ע"י sha512 מלא ב-lockfiles
- תכולת-blobs בהיסטוריית platform/תוך ה-ZIPs — דיסציפלינת path-only

---

## תיקון-עצמי (Task 24, 2026-09-08) — סיווג mnemonic.ts היה מוגזם

בהמשך למשמעת "תיקון-עצמי בגלוי": עם הנחיית-הבעלים החדשה (גישת-סוכנים למפתחות מאושרת), הקובץ נפתח ונקרא במלואו. **המסקנה: הסיווג "חומר-מפתח בצורת-קוד" בסעיף ה-CRITICAL לעיל היה שמרני מדי — הקובץ בטוח.**

מה שהניתוח-העיוור לא יכול היה לראות:
- `const phrase = process.env.SOVEREIGN_PHRASE ?? ""` (שורה 31) — הצירוף **מגיע מ-env בזמן-ריצה**, לעולם לא יושב בקובץ. ה-RHS בן ה-35 התווים שמדדתי = בדיוק הביטוי הזה
- 11 המילים באותיות-קטנות ש"מפוזרות בשורות-קוד" = מפתחות-JSON תמימים ומחרוזות-זיהוי (`"label"`, `"words"`, `"sovereign-user"`, `"keys/sovereign-mnemonic.json"`...)
- הקובץ = כלי-עיגון חד-פעמי: מאמת BIP39 fail-closed → גוזר כתובות-ציבוריות → סוקר יתרות → **אוטם את הצירוף לתוך מעטפת הכספת** (`keys/sovereign-mnemonic.json` בתוך `fleet_keys.enc`, תחת `agent/` gitignored) → round-trip verify. מסמך-העיצוב שלו מצהיר: "The phrase crosses no log"
- פרט-היסטורי נחשף: המקור = "owner photo IMG-20260905-WA0024 (WhatsApp, 2026-09-05)" — הבעלים עגן את הצירוף שלו לכספת בעצמו

**משמעות**: אין סוד בקובץ, אין נקודה-עיוורת ממשית (ה-blacklist של ה-guardian נכון כמו שהוא), אין צורך בגיבוי-חירום. ההחלטה "mnemonic.ts-fate" נסגרה ב-owner-decisions.md.

**לקח-מתודולוגי**: ניתוח-עיוור נותן חתכים סטטיסטיים, לא משמעות. השאלה "11 מילים = seed שבור?" והשאלה "11 מילים = מפתחות-JSON?" נראות זהות מבחוץ — רק קריאה מאושרת מפרידה ביניהן. בפעם הבאה: לבקש הרשאת-קריאה מוקדם יותר.
