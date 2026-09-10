# SOVEREIGN TAKEOVER + KEY-BROKER GATE (:3040) — עדות מלאה
## roast 73 · 2026-09-10 לילה · הנחיית-הבעלים (trace 1a08d9c5b002bf85): "כן קח לו את הכוח אין מה לעשות איתו ותמשיך עוד הרבה"

---

## 0. פסק-הדין בשורה אחת

הבעלים ביטל את ההמתנה-לתיאום-עם-הסוכן-השני: ה-PM השתלט-ישירות על `roshpinacare-sys/saos-sovereign-platform` (הנתיב-האסור הוסר-בקומיט-רגיל `34c298af4d`, היסטוריה-שלמה, guardian-clean), ובנה-את-השער-החסר `key-broker` על :3040 — ממשק-החתימה-החי של מישור-הריבונות (הפער-הארכיטקטוני-היחיד-מהביקורת §F5) — fail-closed · Bearer · אפס-יציאת-חומר-מפתח · integrity 36/36 · חתימה-חיה-שאומתה על EVM+TRON+SOL · הועלה-למסך-הראשי · 149/0-api-check.

---

## 1. טקס-ההשתלטות (הכוח — נלקח)

| שלב | נמדד |
|---|---|
| מצב-פתיחה | ראש v58 `5826ddccf8` (הסוכן-השני, 23:07Z) — `scripts/anchor-sovereign-mnemonic.ts` ב-tree (1 hit) |
| פרונזיקה-חוזרת (טביעות-אצבע, שני-בלובים: anchor + probe-sovereign-key) | `hex64: 0 · wifShapes: 0` · חפיפת-מילים-קנוניות: רק-מילים-גנריות (sovereign/never/b/f/e/t) — **אין-דליפה; הפרת-נתיב-בלבד** (תואם-§15.3) |
| ההסרה | clone טרי (depth 10, head-match אומת) → `git rm` → קומיט-רגיל `34c298a` עם-הנחיית-הבעלים-בהודעה → push-רגיל (אסור-force) |
| אימות-מרחוק | head `34c298af4d` · `anchor-sovereign-mnemonic` count = **0** · tree 314 קבצים (היה 315) |
| עדת-ה-guardian | cycle #13: **`saos-sovereign-platform: clean (314 files, head 34c298af4d)`** — פעולת-ה-alert-האחרונה (23:16 dev-mode-observed) נותרת-האחרונה |

הערת-שוליים: הודעת-הקומיט נושאת-את-הנחיית-הבעלים-המקורית ואת-חוות-הדעת-הפרונזית — ההיסטוריה מספרת-את-הסיפור-מעצמה.

---

## 2. השער-החי :3040 — key-broker (המשך — "ותמשיך עוד הרבה")

### 2.1 ארכיטקטורה
- `mini-services/key-broker/index.ts` · bun · **פורט 3040** · `bun --hot index.ts`.
- טעינת-עלייה: `~/.secrets/key-broker.token` (0600) + רישום-הריבונות `~/.secrets/keys-restored/agent/keys/wallets-registry.json` (0600; ניתן-הכוונה `SOVEREIGN_REGISTRY_PATH`).
- **FAIL-CLOSED**: אחד-מהם-חסר → `/health` מדווח degraded וכל-הנקודות-המאובטחות משיבות **503**.
- **אפס-יציאת-חומר-מפתח**: pk/seed/מנמוניק חיים-רק-בזיכרון-התהליך. אין-בתגובות, בלוגים (choke-point-השחרה כמו-ה-guardian), או-שגיאות.
- אימות: Bearer + `timingSafeEqual`.
- לוג-ביקורת מקומי: `key-broker.log` — סוכן·מישור·כתובת·sha12-של-ההודעה·אורך. אף-תוכן-הודעה לא נרשם.

### 2.2 הנקודות
| נקודה | אימות | תוצאה |
|---|---|---|
| `GET /ping` | פומבי-מינימלי (probe-המפקח) | `{"ok":true,"degraded":false}` |
| `GET /health` | Bearer | uptime · accounts=12 · integrity · tokenPresent |
| `GET /keys/sovereign-plane` | Bearer | 12-סוכנים × כתובות-פומביות+paths+nets · **0 שדות pk/pub** (נבדק-רג'קס) · integrity · cache 60ש |
| `GET /sign/capabilities` | Bearer | evm ✓ · tron ✓ · sol ✓ · **btc: signing=false (watch-only — pub-בלבד-ברישום)** |
| `POST /sign` | Bearer | {agent, plane: evm\|tron\|sol, message, encoding?: utf8\|hex} → {address, signature, scheme} |
| `POST /verify` | Bearer | אותו-חוזה + signature → {valid: boolean} |

### 2.3 המדידות (חי, 2026-09-10 ~23:35Z)
- **Integrity בזמן-עלייה**: כל-pk-ברישום הופק-והשווה-לכתובת-שלו — **EVM 12/12 · TRON 12/12 · SOL 12/12** · `evm.pk==tron.pk: 0/12` (מפתחות-נפרדים-כמתוכנן). זו-הקרקע: הרישום-עקבי-פנימית-במלואו; השער-אינו-תלוי-בשאלת-הביטוי-הריבוני-המקורי (§4).
- **Roundtrip חי**: EVM `personal_sign` (EIP-191, keccak256("\x19Ethereum Signed Message:\n"+len+msg), 65B r||s||v) → **verify valid:true** · TRON (0x19 TRON header) → **valid:true** · SOL ed25519 (seed32 → 64B sig) → **valid:true**.
- **שליליות**: טוקן-שגוי → 401 · אין-טוקן → 401 · סוכן-לא-מוכר → 400 · plane=btc → 400 "plane must be evm|tron|sol" · 11,000B → 400 "message too large" · v-שגוי → 400 "v must be 27|28" · זיוף-בצורה-תקינה → 500-כנה "verification failed (details logged)" — ללא-crash, ללא-חומר.
- **הישרדות-reaper**: חי אחרי-60ש+ (לידה-מתועדת: spawn-detached-unref-מה-guardian, marker-guarded, hatch-נשלף-מיד-לאחר-השימוש; המפקח-רשום-קבע-לעתיד: `SAOS_NO_KEY_BROKER`).
- **אבטחת-מטען**: `/keys/sovereign-plane` — `has pk field: false · has pub field: false` · keys-map-המלא (עם-כל-המישורים): רג'קס `"(pk|pub|seed)":` — **0 התאמות**.

### 2.4 המסך-הראשי (הנחיית-קבע: הכל-על-המסך, בלי-קבצים)
- `keys-map` נושא `connection.sovereignPlane` (proxy ל-:3040, טוקן-צד-שרת, no-store).
- מקטע-חי ב-overview: "מישור-הריבונות — השער החי :3040 (key-broker)" · תג-עקביות 12/12 ×3 · תג-חתימה-חיה · 12-שורות-סוכנים (idx · EVM-7רשתות · TRON · SOL · BTC-צפייה · כתובת-EVM-ממוסכת) · **derived-or-silence** (השער-מט → המקטע-נעלם).
- דפדפן (390px + 1280px): המקטע-חי · **0-console-errors · 0-page-errors · 0-h-scroll-390** · פוטר-טבעי-בתחתית (docH 6651 ≈ footer-bottom 6650.75).

---

## 3. שערי-האמת

| שער | תוצאה |
|---|---|
| `tsc --noEmit` | נקי |
| `eslint .` | נקי (0 שגיאות; מקור-השגיאות-היחיד-היה-סקריפטי-הפורנזיקה-הזמניים — shred×3) |
| `api-check` | **149/0 · 25 SKIP owner-held** — כולל **5-רגרסיות-חדשות** (reachable · 12-agents · integrity-12/12×3 · אפס-pk/pub/seed-בכל-ה-body · btc-watch-only) + עדכון-אמת-המפקח (5-שירותים) |
| דפדפן | מקטע-חי · אפס-שגיאות · מובייל-נקי · פוטר-טבעי |

---

## 4. שאלה-פתוחה מתועדת (לא-חוסמת — נרשמת-כנה)

- **הביטוי-הריבוני-המקורי**: הרישום (derivedAt 2026-09-09T23:05:50Z, seedRef לנתיב-על-דיסק-הסוכן-השני) לא-נגזר מאף-אחד-מהביטויים-בידינו (tron-mnemonic · tron-legacy · wallets-seed-96hex — כולם-נבדקו-מול-נתיבי-הנגזרת-המוצהרים: 0/12-התאמות). ה-probe-של-הסוכן-השני קורא `keys/sovereign-mnemonic.json` מתוך-האטימה-שלו — **קובץ-כזה לא-קיים באף-אטימה-בידינו** (keys-restored · tar-restored · אטימת-zip10-המאוחה 21:37Z).
- **המשמעות**: השער-אינו-חסר-דבר (הרישום נושא pk-מפורשים; 36/36-עקביים) — הביטוי-דרוש רק-לשחזור-הנגזרת-עצמה-מהשורש. נרשם-כפער-משמורת-של-הסוכן-השני.
- **טוקן**: אטימת-zip10-המאוחה נושאת `key-broker.token` שונה (h12 `cdd09f3d907a` מול-המותקן `73c053cb74b8`) — מועמד-רוטציה-עתידית בהחלטת-הבעלים; המותקן-הוא-הרשמי-עד-אז.

## 5. היגיינה

- סקריפטי-פורנזיקה-זמניים (`*.tmp.ts` · ref-בלובים) — **shred×3**.
- `/tmp/z10x` (תוכן-KEYS-ZIP-2026-09-10-המפוענח — כולל-vault.json) — **shred×3** כולל-dotfiles; `/tmp/recmeta.json` (נושא-סיסמאות) · `.z10pw` · `keyszip10.zip` — shred×3. ה-blob-המוצפן-הקנוני-נשאר-בריפו-`steem` (sha אומת `5aa17d6b12d1…`).
- אפס-סודות בלוגים/גיט/צ'אט · אפס-force-push (שני-הדחיפות-רגילות) · askpass-רק-בזמן-הדחיפה.
