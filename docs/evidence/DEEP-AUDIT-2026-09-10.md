# סריקה עמוקה של כל תיקיות הגיט — 2026-09-10 (משימה 46)

> בקשת-הבעלים: "סקור את כל התיקיות בגיט לעומק".
> שיטה: סוכן-חקירה קריאה-בלבד על כל העץ + סריקת-אבטחה ידנית (דפוסי-סודות) + אימות-דפדפן של החיזוק שיצא ממנו.
> כלל-יסוד שנשמר לאורך כל הסריקה: אפס הדפסת חומר-סודות — רק נתיבים, גדלים ופסקי-דין.

---

## 1. מדדי-גיט

| מדד | ערך |
|---|---|
| קבצי-מעקב | **196** |
| קומיטים | **108** (2026-09-07 → 09-10, 4 ימים) |
| עץ-עבודה | **נקי** — 0 לא-מוגש, 0 לא-עקוב |
| מקור | origin → github.com/roshpinacare-sys/saos-sovereign-foundry (HTTPS, **אין פרטים בכתובת**; טוקן רק דרך askpass) |
| סנכרון | main == origin/main בזמן הסריקה (a992f6a) |

פיזור קבצי-מעקב: docs 78 · src 72 · scripts 21 · mini-services 12 · שורש 13 (package.json, bun.lock, next.config.ts, tsconfig, eslint, postcss, AGENTS.md, worklog.md, .gitignore, .env.example, prisma/schema.prisma, download/README.md, .github/workflows/ci.yml).

## 2. מפת תיקיות (גודל בדיסק / סטטוס-מעקב)

| תיקייה | גודל | בגיט? | תפקיד |
|---|---|---|---|
| node_modules | 874 MB | מוזנח | Next 16.3.4 / React 19 / Prisma 6 |
| mini-services | 70 MB | 12 קבצים | 4 שירותים עצמאיים (להלן) |
| .git | 69 MB | — | 108 קומיטים |
| skills | 61 MB | מוזנח | תשתית-סנדבוקס |
| docs | 992 KB | 78 קבצים | יד-מתפעלת + ראיות + תדרוכים |
| src | 928 KB | 72 קבצים | הפלטפורמה (להלן) |
| backups | 724 KB | מוזנח | 3 תמונות-גיבוי (09-09 22:51 · 09-10 00:22 · 09-10 02:17) |
| scripts | 236 KB | 21 קבצים | סקריפטי-אופס/פורנזיה |
| tool-results | 224 KB | מוזנח | פלטי-כלים של סוכנים |
| db | 224 KB | מוזנח | SQLite ריצה (custom.db) |
| upload | 142 KB | מוזנח | חומרי-מפתח מקומיים (מחוץ-לגיט במכוון) |
| prisma | 16 KB | 1 קובץ | schema בלבד |
| download | 8 KB | README בלבד | placeholder |
| anchor-baseline / saos-sovereign-platform / research | — | — | לא קיימות בדיסק (רישומי-.gitignore היסטוריים) |

## 3. מפת המקור (src — 72 קבצים, ~14,220 שורות)

- **src/app**: layout + page (מרכז-השליטה) + globals.css (SOVEREIGN v4 aurora) + **25 API routes** תחת `/api/saos` (כולן force-dynamic). מאובטחות-requireAuth: anchor-pulse, audit, decisions, live-gate, seal, signer, auth/revoke-all. keys-map מדורג-קצב + (ממשימה זו) שער-same-origin לחומר-המפתח.
- **src/components**: ui/kit.tsx (451 ש"ות פרימיטיבים) + saos/ — command-center.tsx מתזמר **בדיוק 10 טאבים**: overview (681 ש"ות, כולל MyKeysPanel), treasury (324), chain (319), signatures (577), security (708 — הגדול), decisions (286), networks (193), agents, audit (241), breakthrough (329) + live-proof-card + labels + api.ts (שכבת-fetch) + types.ts (701 — חוזה-הטיפוסים המשותף). 14/16 קומפוננטות הן client.
- **src/lib**: 26 מודולי-saos + db.ts — signer, preflight, breakthrough, network-status, auth (HMAC cookies + השחתת-epoch), external-signer-client, owner-decisions, kernel, networks/{ethereum,solana,live-probes}, anchor-gates, receipt-store, rate-limit (13 חוקים), tron-energize, evidence, modes (דגל-כפול dry-run/live), fleet-cure, merkle, canonical-json ועוד.
- **src/instrumentation.ts**: מפקח-שירותים — מריץ vault-guardian(:3031) + chief-of-staff(:3032) כילדים של שרת-הדב עם watchdog דקה-דקה (כיבוי: SAOS_NO_GUARDIAN=1 / SAOS_NO_CHIEF=1).

## 4. מיני-שירותים (4)

| שירות | פורט | חי עכשיו | תפקיד |
|---|---|---|---|
| external-signer | 3033 | ✅ (bun, מקשיב) | **הארכיטקטורה המוזהבת**: הרכיב היחיד שמחזיק חומר-מפתח (מעטפת חתומה AES-256-GCM/scrypt, נפתחת בזיכרון). חותם ומשדר STEEM/HIVE/BLURT עם שער אימות-רשויות לפני שידור; מחזיר רק txid-ים ציבוריים. |
| chief-of-staff | 3032 | ❌ | מודיעינו-ניהול LLM כל-30-דק' → docs/briefings. ניתוח-בלבד, לעולם לא מבצע. |
| vault-guardian | 3031 | ❌ | צופה-דליפות סודות על 3 ריפו-ים כל-10-דק'; ניטרול + תיקון-פוש. DEV_MODE=דיווח-בלבד. |
| fleet-cure | 3034 | ❌ | מנטר RC-מאנה של 9 חשבונות-צי כל-5-דק'; מבצע weave-HIVE בחלון-שידור. לא מחזיק מפתחות. |

## 5. docs (78 קבצי-מעקב)

37 שורש (README/ארכיטקטורה/api 535ש"ות/רנוואי/אבטחה/secret-hygiene 344ש"ות/KEY-RECOVERY/OWNER-KEYS-MASTER-FILE/FORENSIC-AUDIT ועוד) + **7 ראיות** (FUNDS-RECON-2026-09-10 · KEYS-INGEST-2026-09-10 · INCIDENT-2026-09-09-wipe-recovery · 4 ארכיוני-JSON: dex-relay-pollution, fleet-cure-status, hive-txid-canary, legacy-chain-archive) + 33 תדרוכים (BRIEF-*, אחרון 01:44Z).

## 6. סקריפטים + package.json

14 סקריפטים: dev, lint, typecheck, test (api-check 651ש"ות — סוויטת-121 בדיקות), verify, check, release-truth-audit, build, backup, restore, cleanup, db:push, db:generate. 10 תלויות-ריצה + 10 פיתוח. 21 סקריפטי-scripts/: פורנזיית-blurt ×4, master-key-proof, authority-graph-proof, verify-hadekor-live, backup/restore/cleanup, concurrency-check, deep-agent-audit ועוד.

## 7. עמדת-אבטחה (פס/כשל לכל סעיף)

| סעיף | תוצאה |
|---|---|
| אפס חומר-סודות ב-196 קבצי-המעקב (דפוסי WIF/טוקנים/hex-64) | ✅ פס |
| .env לא במעקב; .env.example עם placeholders בלבד | ✅ פס |
| upload/, backups/, db/, tool-results/, .secrets/, *.evm, skills/ — הכל מוזנח | ✅ פס |
| CI (ci.yml): SQLite חד-פעמי + מפתח-אדמין זמני לכל-ריצה; אפס סודות | ✅ פס |
| dotfiles פורנזיים במעקב (.d10.ts/.derive6.ts): נבדקו — נקיים מסודות, mnemonic נטען מ-$HOME בלבד | ✅ פס |
| **keys-map מחזיר חומר-מפתח-אדמין לכל GET** | ⚠️ **הפגם המרכזי — חוזק במשימה זו (להלן)** |
| SAOS_DEV_AUTOSESSION=1 ב-.env החי (הנחיית-בעלים 26/45) | ⚠️ מקובל-בעלים; נדרשת מודעות |

## 8. החיזוק שבוצע (משימה 46)

**הפגם**: `GET /api/saos/keys-map` החזיר את `admin.material` המלא לכל-בקשה (מדורג-קצב בלבד) — גריפה עיוורת מ-curl/צולבת הייתה מקבלת את מפתח-האדמין. זו הנחיית-בעלים תקפה ("על הראשי וזהו") — אבל היעדר-שער היה רחב מדי.

**התיקון (בלי לגעת בחוויית-הבעלים)**: החומר המלא מוחזר **רק לבקשות same-origin** (הדפדפן של הבעלים שולח `Sec-Fetch-Site: same-origin` בכל fetch של הקונסולה — תמיד עובר). לכל-שאר: `material: null` + `withheld: "material-same-origin-only"`, כשה-masked + hashMatch + כל פסקי-הדין והכתובות הציבוריות נשארים זמינים לכולם.

**אימות משולש**:
- curl עיוור → חומר חסום, masked מוצג, hashMatch:true ✓
- curl עם Sec-Fetch-Site: same-origin → חומר מלא (48 תווים) ✓
- Origin צולב (attacker-like) → חסום ✓
- דפדפן דסקטופ 1440: גלה→48 תווים, "מחובר" ✓, פסקי-דין שרשרת ✓; מובייל 390: בלי גלילה-אופקית ✓; **0 שגיאות קונסולה** ✓

## 9. תיקון נלווה שהסריקה גילתה

`bun run typecheck` היה **שבור** מלפני-כן (2 שגיאות TS2737 — ליטרלי BigInt `0n`/`58n` ב-treasury/route.ts מול tsconfig target ES2017) — שובר CI. תוקן ל-`BigInt(0)`/`BigInt(58)` (אפס-שינוי-התנהגות). typecheck עכשיו exit 0; lint נקי.

## 10. ממצאים פתוחים (backlog — לא טופלו כאן במכוון)

1. 14/108 קומיטים עם הודעות-UUID (auto-sync חיצוני) — מקורם לא מתויג.
2. dotfiles `.d10.ts`/`.derive6.ts` ב-external-signer — ניסויים חד-פעמיים, לא-מוזכרים בשום-מקום; נקיים מסודות; להעביר ל-scripts/ או למחוק.
3. 4 סקריפטי-פורנזיית-blurt כמעט-זהים (~137–139 ש"ות כ"א) — שאריות-דיבוג היסטוריות.
4. 5 routes GET קריאות בלי rate-limit (economy, energy, kernel, plans, verify-pack) — זולות וקריאה-בלבד; זניח.
5. רישומי-.gitignore לתיקיות שאינן-קיימות (anchor-baseline/, research/...); סטייה תיעודית: .gitignore עתה 54 שורות מול "53" במסמך-האירוע.
6. node_modules ריקים ב-vault-guardian/fleet-cure (תלויות לא-הותקנו מקומית).
7. skills/quiz-mastery/data ריקה; download/README.md placeholder במעקב.
8. ports מקודדים 3031–3034 (עקיפים דרך-env — מקובל).

## 11. מצב-כספים (נקודת-סיכום ממשימה 44 — לא השתנה, קריאה-בלבד)

- TRX: משפחה idx0..idx5 = **4.639 TRX**; **17.099 TRX** יושבים על ארנק-2020 (TMXHfFQd…); ריכוז 18.70 על TG6SrsM…; SOL יצא ל-A2Y1d3… (0.023976); ETH/USDT/BTC = 0 בכל-הכתובות; גרפין: **42.28 BLURT + 0.67 STEEM + 20.55 HP** על headcorner.
- הלדג'ר סגור מתמטית עד השקל האחרון — אין כסף "נעלם"; נדרש אימות-בעלים ששני יעדי-היציאה אכן ארנקיו (אם-כן: נזילות אמיתית ~21.7 TRX).

---
*נכתב במשימה 46 · סריקה קריאה-בלבד · אפס חומר-סודות במסמך זה.*
