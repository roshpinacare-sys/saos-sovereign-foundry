# מרכז-החיבור — המפה האחת (Task 64, 2026-09-10)

> **המסמך הזה הוא המקום-היחיד שצריך.** כל דבר שהמערכת מחזיקה — מפה, מצב, נתיב, וסגירה-בצעד-אחד.
> אין בו שום חומר-סוד — נתיבים, ספירות ופסקי-דין בלבד.
> המקבילה-החיה על-המסך: **סקירה → "המפתחות שלי" → מרכז-החיבור** (`/api/saos/keys-map`).
> עדכון-אחרון: 2026-09-10 20:00 UTC (Task 64 "חייב לחבר הכל").

---

## 1. מצב-החיבור החי (נמדד, לא נטען)

| רכיב | מצב | איך מודדים |
|---|---|---|
| כספת (חותם חיצוני :3033) | **16/16 סלוטים מאומתים-חי · 0 סטיות · 0 שגיאות** | `GET :3033/keys/verify-live` (Bearer `~/.secrets/external-signer-token`) |
| headcorner | **12/12** — STEEM+HIVE+BLURT × owner/active/posting/memo | `GET :3033/keys/status` (v2.4.2 — התצוגה מציגה גם memo) |
| tov | **4/4 BLURT** (owner/active/posting/memo) | אותו-status — `fleet[0].networks.BLURT` |
| מפקח-שירותים | **4/4 חיים** — vault-guardian:3031 · chief-of-staff:3032 · external-signer:3033 · fleet-cure:3034 | `supervisorStatus()` — מוצג חי במסך |
| עגינות-שרשרת | BLURT + STEEM עגונות ומאומתות-על-השרשרת; HIVE בחלון-RC | `GET /api/saos/live-proof` · `/verify-chain` |
| מסד-נתונים | ok — 15 חותמות · 303 קבלות · השרשרת 0-forks | `GET /api/saos/live-proof` |

## 2. מפת-הסודות (נתיבים בלבד — מה מחזיק מה)

| נתיב | מה זה | מצב |
|---|---|---|
| `~/.secrets/fleet-envelope/` | **הכספת-החיה** — המעטפת האטומה (.env ראשי + keys/vault.json + fleet_keys.enc חתום) | 700 · המקור הקנוני |
| `backups/key-backup-headcorner-20260910.enc` | **גיבוי-טרי** של כל 16 הסלוטים החיים (כל-3-המישורים, v2.4.1) — round-trip אומת | 0600 · gitignored · **סיסמה נמסרה בצ'אט 10-09** |
| `backups/key-backup-headcorner-20260909.enc` | גיבוי עידן-הצי: **10 חשבונות-צי × STEEM/HIVE (active/posting/owner) + headcorner** — החומר-היחיד שמכיל את מפתחות-הצי | 0600 · gitignored · שוחזר מהיסטוריית-הגיט (Task 64) · **סיסמה אצל הבעלים (צ'אט 09-09)** |
| `~/.secrets/saos-admin-key` (+ עותק `upload/saos-admin-key.txt`) | מפתח-האדמין של הקונסולה | hash-מאומת חי מול `SAOS_ADMIN_KEY_HASH` |
| `~/.secrets/external-signer-token` | טוקן-Bearer לחותם :3033 | 0600 |
| `upload/Roshcaregt.txt` | טוקן-דחיפה לגיטהאב (askpass) | gitignored · לעולם לא בצ'אט |
| `upload/photo_2026-09-10_01-12-28.jpg` | **צירוף-המילים (mnemonic)** — מקור-הנגזרת של משפחת-ארנקי TRON + ETH/BTC/SOL | נשמר — עותק-המערכת היחיד. **לא למחוק** |
| `upload/negen-space.html` | דף-עיצוב ("מרחב-סגנונות") | חומר-עזר, ללא מפתחות |

## 3. חומר-הבעלים — מה חובר ומה נאטם

| קובץ | מה היה | גורל |
|---|---|---|
| `upload/הד.txt` | סיסמאות-אב headcorner+tov | **הושמד (shred ×3) 10-09** — 8/8 התאמות-חי נכתבו לכספת; אישור-הבעלים נתקבל ("בדקתי זה מתאים") |
| `upload/הדקור.txt` | ערכת STEEM/HIVE של headcorner | **הושמד (shred ×3) 10-09** (פריצדנט-32) — 8/8 נבלעו ומאומתים-חי |
| `upload/בלורט.evm` | סיסמת-אב BLURT של headcorner | **הושמד 10-09** — הוכח מקומית (גזירת-מפתח-ציבורי) שהוא **שכפול-מדויק** של סיסמת-headcorner בהד.txt |
| התמונה | mnemonic | נשמר וממופה — כל-הנגזרות אומתו (FUNDS-RECON) |

## 4. פערים-פתוחים — והסגירה-בצעד-אחד של כל אחד

1. **סלוטי-הצי (9 חשבונות HIVE)** — `waiting-owner`
   - המפתחות **קיימים** בתוך `backups/key-backup-headcorner-20260909.enc` (נבלעו ואומתו-חי 18/18 בעבר).
   - **הסגירה**: הבעלים מדביק את סיסמת-הגיבוי מהצ'אט של 09-09 ("keys-rescue") → `node scripts/decrypt-key-backup.mjs backups/key-backup-headcorner-20260909.enc --pass-env SAOS_BP --out /tmp/fleet.json` → הזרקה דרך מסך-אבטחה או `POST :3033/keys/ingest` → הצי חי. שום דבר אחר לא נדרש.
2. **tov-STEEM/HIVE** — `blocked-external`
   - יתום-ROT1: המפתחות סובבו חיצונית (SETTLE-10) והסיד לא נמצא. נכסים זעירים (0.449 STEEM), לא חוסם שום צינור.
   - **הסגירה (רק אם הסיד ימצא)**: הדבקה אחת של סיד-ROT1 (64-hex) במסך-אבטחה → כל-העץ נגזר ומאומת אוטומטית.

## 5. הליכים-סטנדרטיים (שלא יהיה צורך לחפש שוב)

- **התחברות לקונסולה**: מפתח-אדמין (על-המסך) · מפתח-אב STEEM/HIVE · סיסמת BLURT — או כניסה-אוטומטית ב-dev.
- **הזרקת מפתח**: מסך-אבטחה → "מפתח-בעלים" (כל פורמט — WIF/סיסמת-אב/סיד) → verify-then-write fail-closed מול רשויות-חיות.
- **בדיקת-כספת מלאה**: `curl -H "Authorization: Bearer $(cat ~/.secrets/external-signer-token)" localhost:3033/keys/verify-live`.
- **גיבוי-מפתחות טרי**: `POST :3033/keys/backup` (Bearer, body `{"passphrase":"…"}`) → כותבים את `file` ל-`backups/key-backup-<תאריך>.enc` (0600) → round-trip עם `scripts/decrypt-key-backup.mjs --pass-env`. הסיסמה — **לצ'אט בלבד, לעולם לא לקובץ**.
- **דחיפה לגיטהאב**: askpass מ-`upload/Roshcaregt.txt` (ראה worklog), `git push origin main`, אימות `git ls-remote origin main`. אף-כוח-גיטהאב לעולם לא בצ'אט.
- **שחזור-אסון**: סדר-ההתאוששות = מעטפה חיה → גיבוי-טרי (10-09) → גיבוי 09-09 → סיד/סיסמאות אצל הבעלים. מסמך-האם: `docs/KEY-RECOVERY.md`.

## 6. מסמכי-אם (הרשויות)

| נושא | המסמך |
|---|---|
| פנקס-מפתחות-וכספת (המטריצה המלאה) | `docs/KEYS-VAULT-LEDGER-2026-09-10.md` |
| מצב-כל-המשתמשים + חוזה-מפתחות | `docs/OWNER-KEYS-MASTER-FILE.md` |
| פורנזיקת-השחזור | `docs/KEY-RECOVERY.md` |
| נתיבי-גישה-למפתחות (מבצעי) | `docs/keys-access.md` |
| פרומפט-חילוץ לכל-סוכן | `docs/PROMPT-FOR-ALL-AGENTS.md` |
| ראיות-הזרקה/כספים | `docs/evidence/KEYS-INGEST-2026-09-10.md` · `docs/evidence/FUNDS-RECON-2026-09-10.md` |
| נהלי-בטיחות-מפתחות (חוזה §13) | `docs/security.md` · `docs/secret-hygiene.md` |

---

*Task 64 — הנחיית-הבעלים "חייב לחבר הכל הכל… ולאטום שנוכל לגשת להכל בלי בעיה וללא צורך עוד פעם בחיפוש ואיתור".*
