# FLEET-LANES — רישום מסלולי הכתיבה בצי (R229)

**מטרה**: למנוע דריסות בין סוכנים מקבילים. כל סוכן לשוכן למסלול ייחודי משלו ואסור לו לגעת במסלול של אחר.
**רקע**: ביקורת R228 מצאה 4 משפחות דריסות — כולל אותו פרומפט לשני סוכנים שהנחית שניהם על שמות ענף זהים.

## מסלולי העבודה (lane registry)

| מסלול | ריפו @ ענף | בעלים | סוג תנועה |
|---|---|---|---|
| **זה אני (W1)** | `roshpinacare-sys/saos-sovereign-foundry` @ `cockpit-zai` | סוכן Z.ai (המושב הנוכחי) | קסטודיאן + סבבים, דרך השער FF-only |
| סוכן מקביל | `roshpinacare-sys/steem` @ `saos-cockpit` | סוכן אחר (אותו ממשק, סנדבוקס נפרד) | לא שלי — אסור לדחוף |
| עולם הבוטים | `foundry@main` + `steem@main` | `foundry-selftest[bot]` + `saos-sovereign-ci` | אוטומציה בלבד — אסור לדחוף |
| עולם היסטורי | `foundry@security/audit-2026-09-28`, `steem@security/audit-2026-09-28` | ארכיון ביקורת | קריאה בלבד |

## ריפואי-לוויין (אורגנים חיים של גופים אחרים — קריאה בלבד מהמושב הזה)

`Zip` (weave-core) · `Console` · `Domain` · `saos-dex` · `saos-control-center` · `saos-sovereign-platform` · `Defi` · `Adsmarket` · `Sdk` · `Saosmartwallet` · `saos-jummper` · `roshpina` · `Project-files` · `anchor-baseline`

**עדות R228**: עבודה זהה נדחפת לשני ריפואים במקביל (Maker-API v1 ל-saos-dex + saos-control-center בפער דקה; canary ל-Zip + Domain). המסלול הזה לא נוגע בהם.

## חוקי המסלול

1. **שם ענף = זהות סוכן.** אסור להשתמש בשמות גנריים (`saos-cockpit`, `main`, `master`) — שם גנרי הוא מגנט-התנגשות. השם שלי: `cockpit-zai`.
2. **לפני דחיפה ראשונה לריפו חדש**: בדוק בקובץ זה שהמסלול פנוי; אחרי הדחיפה — רשום את עצמך כאן.
3. **אסור force-push בשום מסלול** (חוק SOVEREIGN-WRITER-LAW — FF בלבד, לנצח).
4. **מיזוג בין היסטוריות לא-קשורות** (main מול cockpit-zai) אסור בלי החלטה מפורשת של האופרטור — merge-base שלהן ריק.
5. **מעבר בעלים**: רק בפקודת אופרטור + עדכון טבלה זו + ערך worklog.

## שינויי R229 (ביצוע)

- ענף העבודה שלי שונה: `saos-cockpit` → **`cockpit-zai`** (מקומי + foundry).
- `scripts/sovereign-push.sh` TARGET + `scripts/divergence-check.sh` עודכנו לשם החדש.
- הענף הגנרי `saos-cockpit` נמחק מ-foundry (היה עותק זהה של הרינומו — המקור לבלבול עתידי).
- `steem` נשאר כ-remote גיבוי-קריאה בלבד (lineage/recovery), אף דחיפה אליו.
