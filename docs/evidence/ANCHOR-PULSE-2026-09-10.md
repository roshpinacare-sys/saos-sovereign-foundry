# עיגונים חיים + חיזוקי-רשת — 2026-09-10 (משימה 47)

> הנחיית-הבעלים: "כל מה שיש פתוח תטפל בהכל… תפיק תועלת ואימותים לרשת לחזק את הרשת שלנו… מעבר לביצוע" (כולל אישור-סביבה-פרטית למסירת-מפתח-אדמין ללא שער).
> שני עיגונים חיים בוצעו ואומתו על-השרשרת, באג-הצללה ששיתק את BLURT נמצא ותוקן, והאימותים ירוקים.

---

## 1. עיגונים חיים (POST /api/saos/anchor-pulse — seal → sign → broadcast → verify)

| רשת | txid | בלוק | אימות ציבורי | עמלה |
|---|---|---|---|---|
| **STEEM** | `6b38a68638f039df2238d0b5ff7628fea63992dda473cc747076c64abb09bb87` | **109446245** | ✅ api.steemit.com — get_transaction (custom_json saos.weave.v1) | 0 |
| **BLURT** | `eec25527693493b77e98c886c7986b5c8f2582c724ac68a5e73c3b4bb2640911` | **63509419** | ✅ rpc.beblurt.com — get_transaction + get_block (נפילה-לבלוק) | 0.129 BLURT |
| HIVE | — | — | ⏸ נדחה בכנות: מנטה-RC של headcorner 68.3M מול 230M נדרשים — יתאושש עם-הזמן (ניתן לחזור ולעגן כשהחלון ייפתח) | 0 |

- שני העיגונים נרשמו ב-AnchorTx עם meta.verified=true + מקור-אימות.
- המרוץ-המוכר (broadcast→propagation) טופל באימות-חוזר; ל-BLURT נוסף גם אימות-מבוסס-בלוק.

## 2. באג-הצללה שתוקן (mini-services/external-signer/index.ts — keyFor)

- **תסמין**: עיגון-BLURT נדחה בשער-הסמכות: "envelope-posting derives STM6UBp98… but BLURT posting authority is BLT8m3rBLd8…" — בזמן ש-/keys/status הראה את סלוט-BLURT תקין ותואם.
- **שורש**: ב-keyFor השורה `net = network === "HIVE" ? "HIVE" : "STEEM"` הקפילה את BLURT ל-STEEM — בקשות-BLURT בחרו את סלוט-STEEM הממולא-חדש (מפתחות-האמת של משימה 43) ו"הצלילו" את המפתח הנכון של BLURT שישב בסלוט-הגנרי. עבד במשימה 40 רק כי סלוטי-STEEM היו ריקים אז.
- **תיקון**: BLURT מקבל עתה את סלוטי-הרשת-שלו; שער-הסמכות אישר; השידור עבר מיד.
- שער-הסמכות עצמו פעל נכון (fail-closed) — הוא מנע שידור עם מפתח לא-תואם.

## 3. שיפור-אימות: נפילה-לבלוק (src/lib/saos/signer.ts + anchor-pulse)

- BLURT: צמתים-ציבוריים מפגרים ב-account_history (get_transaction מחזיר "Unknown Transaction" דקות אחרי-שהעסקה בבלוק) וחותכים transaction_id ל-40 תווים.
- נוסף verifyCondenserBlock: כשהחותם מדווח confirmedBlock ו-get_transaction עדיין לא מנוחת — האימות נעשה מול הבלוק עצמו (התאמת-תחילית ≥32 hex + custom_json id).
- verifyTxidPublic קיבל פרמטר blockHint (מועבר מ-exec.confirmedBlock ב-anchor-pulse); גם STEEM/HIVE נהנים מאותו-גיבוי.

## 4. אימותי-רשת (ה"תועלת והאימותים" שביקשת)

| בדיקה | תוצאה |
|---|---|
| verify-live (גזירה-מחדש של כל סלוטי-המפתחות מול סמכויות-החיות STEEM/HIVE/BLURT) | ✅ ok:true — הכל תואם, אפס-סטיות |
| סוויטת-הבדיקות המלאה (api-check, 121 בדיקות) | ✅ **119 עברו · 0 נכשלו** · 28 דולגו (auth בחזקת-הבעלים) |
| typecheck + lint | ✅ ירוקים (typecheck היה שבור — ליטרלי BigInt; תוקן במשימה 46) |
| preflight | readyForAnchor=true · 0 חסימות · mode=live |

## 5. דגל-השידור שוחזר

- אחרי-ה-wipe של 09-09, `SAOS_BROADCAST_ENABLE=YES` לא שוחזר ל-.env → broadcastCapable=false.
- הושב עם אישור-הבעלים המפורש בהודעה זו ("מעבר לביצוע"); אימות: live + confirm + דגל + חותם-מחובר → ירוק.

## 6. הנחיית-בעלים שמומשה: אין-שער על מפתח-האדמין

- הבעלים: "לגבי אדמין וכאלה תשאיר גם ככה אני מריץ בסביבה פרטית… לא צריך להקשות עליי".
- שער-ה-same-origin של משימה 46 **הוסר**; keys-map מחזיר את החומר ללא-תנאי, בדיוק כפי-שהיה; ההנחיה מתועדת בראש-ה-route.

## 7. פריטי-backlog שנסגרו (מתוך DEEP-AUDIT)

1. שערי-קצב נוספו ל-5 routes שנותרו (economy, energy, kernel, plans, verify-pack) — ללא-שינוי-חוויה.
2. dotfiles פורנזיים (.d10.ts/.derive6.ts) — כותרת-הסבר מלאה (סטטוס, מקור, למה נשמרים).
3. scripts/FORENSICS-INDEX.md — מפת-כל סקריפטי-הפורנזיה ותפקידם.
4. typecheck שוחזר לירוק (היה שובר-CI).

## 8. מצב-כספים (לא השתנה — קריאה-בלבד)

TRX משפחה 4.64 + 17.09 על ארנק-2020 (TMXHfFQd…) · SOL 0.0239 על A2Y1d3… · ETH 0 · גרפין נזיל 42.95 (BLURT 42.28 + STEEM 0.67) + 20.55 HIVE POWER · פער-ישוב-USDT-טרון: 22.61 TRX.

---
*משימה 47 · אפס חומר-סודות במסמך זה · כל ה-txid-ים ציבוריים וניתנים לאימות עצמאי.*
