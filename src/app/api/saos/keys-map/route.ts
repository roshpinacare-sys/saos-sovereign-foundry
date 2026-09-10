import { existsSync, readFileSync, statSync } from "fs";
import { NextResponse } from "next/server";
import path from "path";

import { audit, authConfigured, verifyLoginKey } from "@/lib/saos/auth";
import { coarseError } from "@/lib/saos/api-errors";
import { ensureSupervisor } from "@/lib/saos/supervisor-bridge";
import { supervisorStatus } from "@/instrumentation-node";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/keys-map — Task 45: "כל מפתח כמו שצריך מסודר" על המסך הראשי.
 *
 * OWNER DIRECTIVE 2026-09-10 ("אני לא רוצה על הקובץ אני רוצה על הראשי וזהו
 * או כל מפתח כמו שצריך מסודר"): the owner is done being pointed at files.
 * Every key the system holds is surfaced HERE, organized, on the main screen:
 *
 *   - admin key      — material IS returned (explicit owner directive). It is
 *                      app-synthetic, gates only this console, and is rotateable
 *                      (POST /auth/revoke-all + re-issue). hash-verified live.
 *                      OWNER DIRECTIVE 2026-09-10 (2nd): private environment,
 *                      single operator — material is returned unconditionally,
 *                      NO same-origin gate ("תשאיר גם ככה, לא צריך להקשות עליי").
 *                      The Task-46 gate was reverted at the owner's request.
 *   - chain keys     — verdicts + PUBLIC keys only (STEEM/HIVE/BLURT slots from
 *                      the external signer). WIF material NEVER passes here.
 *   - wallets        — PUBLIC addresses only (same constants as the treasury
 *                      route, cross-checked against docs/FORENSIC-AUDIT.md and
 *                      the Task-44 on-chain recon).
 *   - key files      — existence + byte size only, never content.
 *
 * Discipline: no-store, rate-limited, audited WITHOUT any secret material,
 * and the response is never cached anywhere.
 */

const HOME = process.env.HOME ?? "/home/z";
const SECRETS_DIR = path.join(HOME, ".secrets");
const UPLOAD_DIR = path.join(process.cwd(), "upload");

function readTrim(p: string): string | null {
  try {
    return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
  } catch {
    return null;
  }
}

function fileMeta(p: string, note: string): { path: string; exists: boolean; bytes: number; note: string } {
  try {
    const st = existsSync(p) ? statSync(p) : null;
    return { path: p, exists: Boolean(st), bytes: st && st.isFile() ? st.size : 0, note };
  } catch {
    return { path: p, exists: false, bytes: 0, note };
  }
}

function maskOf(material: string | null): string | null {
  if (!material) return null;
  return `${material.slice(0, 6)}••••••••  (${material.length} תווים)`;
}

// ── signer passthrough (verdicts + public keys only) ─────────────────────────
function signerToken(): string {
  return readTrim(path.join(SECRETS_DIR, "external-signer-token")) ?? "";
}

async function signerStatus(): Promise<{ reachable: boolean; error?: string; body?: Record<string, unknown> }> {
  const token = signerToken();
  if (!token) return { reachable: false, error: "signer-token-unavailable" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const url = process.env.SAOS_EXTERNAL_SIGNER_URL ?? "http://127.0.0.1:3033";
    const res = await fetch(`${url.replace(/\/$/, "")}/keys/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ctl.signal,
      cache: "no-store"
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body) return { reachable: false, error: `signer HTTP ${res.status}` };
    return { reachable: true, body };
  } catch (e) {
    return { reachable: false, error: coarseError(e, "signer-status-failed") };
  } finally {
    clearTimeout(t);
  }
}

// ── roast-66: the STEEM plane (steemit) — live-measured, never frozen ────────
// The owner caught the plane being invisible ("לכולם חסר steemit"). It now
// travels from the signer's live probe (existence + balances + divergence +
// held-WIF-vs-live-authority verdicts, public data only) into the map + gaps.
interface SteemPlaneRow {
  name: string;
  exists: boolean;
  created?: string;
  liquid?: string;
  sbd?: string;
  hp?: string;
  divergence?: Record<string, string | null>;
  roles?: Record<string, { held: number; match: boolean | null }>;
}
async function signerSteemPlane(): Promise<{ reachable: boolean; error?: string; body?: Record<string, unknown> }> {
  const token = signerToken();
  if (!token) return { reachable: false, error: "signer-token-unavailable" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const url = process.env.SAOS_EXTERNAL_SIGNER_URL ?? "http://127.0.0.1:3033";
    const res = await fetch(`${url.replace(/\/$/, "")}/keys/steem-plane`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ctl.signal,
      cache: "no-store"
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body) return { reachable: false, error: `signer HTTP ${res.status}` };
    return { reachable: true, body };
  } catch (e) {
    return { reachable: false, error: coarseError(e, "steem-plane-failed") };
  } finally {
    clearTimeout(t);
  }
}

// ── public wallet addresses (source of truth: treasury route + Task-44 recon) ─
const TRON_FAMILY: Array<[string, string]> = [
  ["משפחה idx0 (ראשי)", "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr"],
  ["משפחה idx1", "TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4"],
  ["משפחה idx2", "TNd4aFZk1YUeP9uzUWCefJyadjCxZXBoBg"],
  ["משפחה idx3", "TDuyQNSm2XbVKNgdKgjCyHfxkzXAmo2YXG"],
  ["משפחה idx4", "TSJw2GYkmcsYNjALFaNYxySkgGfkvBD8sP"],
  ["משפחה idx5", "TLhp6hhm7RgB7xFsSTAatuWyEWpScVbJ4U"]
];
const TRON_FORENSIC = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const ETH_ADDRESSES: Array<[string, string]> = [
  ["ETH חדש #1", "0x7b7869d126fa1ecc19a3426d07be8186225a2c31"],
  ["ETH חדש #2", "0xe05e7988bac84c58b0a076816627a01aee270eb8"],
  ["ETH כספת #1", "0x2767e8146c11bad1d9b0784f11325375195c1b0f"],
  ["ETH כספת #2", "0x94f4cb4fc0c50d742a583576b2cb1d14fa55dd99"]
];
const SOL_FORENSIC = "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL";
const OUTFLOWS: Array<[string, string]> = [
  // roast 63: labels used to embed aging balances ("18.70 TRX (08-09)") — they
  // already aged once (17.09→18.10) violating the "no number may age silently"
  // promise. Labels now carry PLACE/PURPOSE only; live numbers come from the
  // treasury probe in the same payload.
  ["ריכוז משפחת-TRX (יעד ריכוז)", "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn"],
  ["ארנק 2020 — יעד הישיבה", "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU"],
  ["SOL יעד יציאה", "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj"],
  ["מממן חיצוני (מקור)", "TGUYnMLufLM19NoJcyWkaU32kVjQso2bpQ"]
];

export async function GET(req: Request) {
  // Task 62: מעיר את מפקח-השירותים בתוך תהליך-ה-Next (פעם-אחת, בטוח-לכפילות)
  ensureSupervisor();
  const GEN = "v4-gen-marker"; void GEN;
  const rl = enforceRateLimit("keys-map", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: ניסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    // ── 1. admin key (owner directive: ON THE MAIN SCREEN, no gate — private env) ──
    const secretPath = path.join(SECRETS_DIR, "saos-admin-key");
    const uploadPath = path.join(UPLOAD_DIR, "saos-admin-key.txt");
    const material = readTrim(secretPath) ?? readTrim(uploadPath);
    const hashMatch = material ? verifyLoginKey(material) : null;

    // ── 2. chain keys via signer (verdicts + public data only) ──
    const signer = await signerStatus();
    const signerBody = signer.body ?? {};
    // roast-66: the STEEM plane — measured in parallel with the vault status
    const plane = await signerSteemPlane();
    const planeBody = (plane.body ?? {}) as {
      measuredAt?: string;
      steemPerMvest?: number;
      accounts?: SteemPlaneRow[];
      summary?: { onSteem?: number; accountsTotal?: number; probed?: number; matchedRoles?: number; accountsWithMatch?: number; totalLiquid?: number; totalSbd?: number; totalHp?: number; invalidHeld?: number };
    };

    // ── 3. key files (paths + sizes only, NEVER content) ──
    const files = [
      fileMeta(uploadPath, "עותק מפתח-אדמין (המיקום ההיסטורי של הבעלים)"),
      fileMeta(path.join(UPLOAD_DIR, "photo_2026-09-10_01-12-28.jpg"), "הצירוף-מהתמונה (mnemonic) — מקור-הנגזרת של משפחת-הארנקים · עותק-המערכת היחיד — לא למחוק"),
      fileMeta(path.join(UPLOAD_DIR, "negen-space.html"), "דף-עיצוב (מרחב-סגנונות) — חומר-עזר, ללא מפתחות"),
      fileMeta(path.join(SECRETS_DIR, "external-signer-token"), "טוקן אימות לחותם החיצוני :3033"),
      fileMeta(path.join(SECRETS_DIR, "fleet-envelope"), "מעטפת-הכספת החתומה (WIF-ים — החומר עצמו לעולם לא נחשף)"),
      fileMeta(path.join(process.cwd(), "backups", "key-backup-headcorner-20260910.enc"), "גיבוי מוצפן טרי של מצב-הכספת בערב 10-09 (כולל הצי שחזר) — סיסמה נמסרה בצ'אט בלבד"),
      fileMeta(path.join(process.cwd(), "backups", "key-backup-headcorner-20260909.enc"), "גיבוי מוצפן עידן-הצי (09-09) — עתה משני לכספת החיה; סיסמה אצל הבעלים בצ'אט"),
      fileMeta("/tmp/my-project/backups/key-backup-headcorner-20260909.enc", "עותק-שרד של גיבוי 09-09 (זהה md5)")
    ];

    // ── 4. Task 64 מרכז-החיבור: חיים + פערים-פתוחים + חומר-בעלים ──
    const svcs = await supervisorStatus();
    const vaultSummary = ((signerBody.drift as { summary?: { ok?: number; drift?: number; unmatched?: number; errors?: number } } | undefined)?.summary) ?? null;
    const fleetAccountsWithKeys = Array.isArray(signerBody.fleet)
      ? (signerBody.fleet as Array<{ networks?: Record<string, unknown> }>).filter((f) => f.networks && Object.keys(f.networks).length > 0).length
      : 0;

    const oldBackup = files[6]; void oldBackup; // kept: the 09-09 era-backup stays listed in files; the fleet gap is no longer tied to it
    // v5: the fleet gap is now DERIVED from the live vault — a gap only exists
    // while vault account names hold no keys. Frozen claims ("9 accounts
    // waiting") went stale the moment the fleet's master passwords arrived
    // (Task 65: 12 accounts, 92 slots, 0 drift) — derived-or-silence, never
    // frozen text (roast-63/64 discipline).
    const vaultNames = Array.isArray(signerBody.vaultAccountNames) ? (signerBody.vaultAccountNames as string[]) : [];
    const withKeys = new Set<string>([
      ...(typeof signerBody.main === "object" && signerBody.main && (signerBody.main as { account?: string }).account ? [(signerBody.main as { account: string }).account] : []),
      ...(Array.isArray(signerBody.fleet) ? (signerBody.fleet as Array<{ username?: string }>).map((f) => f.username ?? "") : [])
    ].filter(Boolean));
    const emptyVaultAccounts = vaultNames.filter((n) => !withKeys.has(n));
    const fleetAllConnected = emptyVaultAccounts.length === 0 && withKeys.size > 0;

    // ── roast-66: the STEEM-plane gap is DERIVED from the live probe ──
    // Before this round the plane was invisible; now: any account that EXISTS on
    // steemit but holds NO matching WIF for even one role is an open, closable
    // gap. If a later ingest connects an account, this entry heals itself —
    // derived-or-silence, never frozen text.
    const planeAccounts = plane.reachable ? (planeBody.accounts ?? []) : [];
    const planeSummary = plane.reachable ? (planeBody.summary ?? null) : null;
    const planeMissing = planeAccounts.filter(
      (r) => r.exists && Object.values(r.roles ?? {}).some((s) => s.match !== true)
    );
    const ynetRow = planeAccounts.find((r) => r.name === "ynet");
    const ynetUnchanged = ynetRow?.divergence ? Object.values(ynetRow.divergence).every((v) => v === "same") : false;
    const openGaps0 = fleetAllConnected
      ? [
          {
            id: "tov-rot1",
            title: "tov-STEEM/HIVE — יתום-ROT1 (נכסים זעירים, לא חוסם דבר)",
            detail: "המפתחות סובבו חיצונית (SETTLE-10) והסיד של עץ-ROT1 לא נמצא. יתרה ציבורית: 0.449 STEEM + ווסטינג-זעיר. לא חוסם שום צינור. tov-BLURT חי ומאומת (4/4).",
            oneStep: "אם סיד-ROT1 (64-hex) ימצא אי-פעם — הדבקה אחת במסך-אבטחה → כל-העץ נגזר ונאומת אוטומטית.",
            state: "blocked-external" as const
          }
        ]
      : [
          {
            id: "fleet-slots",
            title: `סלוטי-צי — ${emptyVaultAccounts.length} חשבונות בכספת בלי מפתחות`,
            detail: `חשבונות-כספת ללא חומר: ${emptyVaultAccounts.join(" · ") || "—"}. שאר-הכספת חיה ומאומתת.`,
            oneStep: "הדבקת סיסמת-אב/WIF במסך-אבטחה → החותם מאמת מול רשויות-חיות וכותב fail-closed.",
            state: "waiting-owner" as const
          },
          {
            id: "tov-rot1",
            title: "tov-STEEM/HIVE — יתום-ROT1 (נכסים זעירים, לא חוסם דבר)",
            detail: "המפתחות סובבו חיצונית (SETTLE-10) והסיד של עץ-ROT1 לא נמצא. יתרה ציבורית: 0.449 STEEM + ווסטינג-זעיר. לא חוסם שום צינור.",
            oneStep: "אם סיד-ROT1 (64-hex) ימצא אי-פעם — הדבקה אחת במסך-אבטחה → כל-העץ נגזר ונאומת אוטומטית.",
            state: "blocked-external" as const
          }
        ];
    if (planeSummary && planeMissing.length > 0) {
      openGaps0.push({
        id: "steem-plane",
        title: `מישור-STEEM (steemit) — ${planeMissing.length} חשבונות קיימים-על-השרשרת בלי מפתח-תואם`,
        detail: `נמדד-חי ${planeBody.measuredAt?.slice(0, 16) ?? ""}: כל ${planeSummary.accountsTotal ?? planeAccounts.length} החשבונות קיימים ב-steemit (נוצרו 2018, לפני-הפיצול) עם יתרות אמיתיות — סה"כ ${planeSummary.totalLiquid ?? "?"} STEEM + ${planeSummary.totalSbd ?? "?"} SBD + ${planeSummary.totalHp ?? "?"} HP. רשויות-ה-STEEM שלהם סובבו חיצונית אחרי-2018 (סיסמאות-הצ'אט תואמות HIVE/BLURT — לא STEEM, ${planeSummary.probed ?? 0} WIF-ים נבדקו). מחוברים כרגע: ${planeSummary.accountsWithMatch ?? 0}.${ynetUnchanged ? " יוצא-מן-הכלל: ynet — רשויות-ה-STEEM שלו זהות ל-HIVE (לא סובבו מאז-2018); הסיסמה-המקורית שלו תחבר את שתי-השרשראות בבת-אחת." : ""}`,
        oneStep: "שני-מסלולים: (1) סיסמת-הגיבוי 09-09 (אצל הבעלים, צ'אט 09-09) — גיבוי-עידן-הצי שב-backups מחזיק את מפתחות-ה-STEEM של הצי מאז-שנבנה; (2) הדבקת מפתח/סיסמת-STEEM נוכחית לכל חשבון במסך-אבטחה → verify-then-write fail-closed.",
        state: "waiting-owner" as const
      });
    }
    const openGaps = openGaps0;

    const ownerMaterial = [
      { path: "upload/הד.txt", role: "ייצוא-צ'אט 2018 (Haran Titi) — 13 סיסמאות-אב של הצי והראשי", disposition: "נקלט 10-09 ערב: 84 התאמות-חי על 12 חשבונות (הצי חזר!) → גיבוי-טרי → הושמד shred — הנגזרות חיות בכספת ובגיבוי", exists: false },
      { path: "upload/הדקור.txt", role: "ערכת STEEM/HIVE של headcorner", disposition: "הושמד 10-09 (shred ×3, פריצדנט-32) — 8/8 נבלעו ומאומתים-חי", exists: false },
      { path: "upload/בלורט.evm", role: "סיסמת-אב BLURT של headcorner", disposition: "הושמד 10-09 — הוכח מקומית שהוא שכפול-מדויק של סיסמת-headcorner בהד.txt (אותו מפתח-ציבורי נגזר)", exists: false },
      { path: "upload/photo_2026-09-10_01-12-28.jpg", role: "צירוף-מילים (מקור משפחת-TRON והארנקים)", disposition: "נשמר — עותק-המערכת היחיד של הנגזרת; נגזר ונמפה במלואו (FUNDS-RECON)", exists: true },
      { path: "upload/saos-admin-key.txt", role: "עותק מפתח-אדמין", disposition: "נשמר — המיקום ההיסטורי שהבעלים מכיר (hash מאומת)", exists: true },
      { path: "upload/negen-space.html", role: "דף-עיצוב", disposition: "נשמר — חומר-עזר, ללא מפתחות", exists: true }
    ];

    const res = NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        directive: "הבעלים 2026-09-10: כל המפתחות על המסך הראשי, מסודרים — בלי לחפש קבצים",
        admin: {
          configured: authConfigured(),
          material: material, // מפתח-אדמין בלבד (מלאכותי, ניתן לרוטציה) — הנחיית בעלים: סביבה פרטית, ללא שער
          masked: maskOf(material),
          hashMatch,
          source: readTrim(secretPath) ? "out-of-tree (~/.secrets)" : material ? "upload copy" : null
        },
        login: {
          devAutoSession: (process.env.SAOS_DEV_AUTOSESSION ?? "").trim() === "1",
          hint: "כניסה: מפתח-אדמין · מפתח-אב STEEM/HIVE · סיסמת BLURT"
        },
        chainKeys: signer.reachable
          ? {
              reachable: true,
              sealedAt: signerBody.sealedAt ?? null,
              account: (signerBody.main as { account?: string } | undefined)?.account ?? "headcorner",
              networks: signerBody.main ? (signerBody.main as { networks?: unknown }).networks : null,
              fleet: signerBody.fleet ?? []
            }
          : { reachable: false, error: signer.error ?? "signer-unreachable" },
        connection: {
          vault: {
            reachable: signer.reachable,
            version: (signerBody.version as string | undefined) ?? null,
            summary: vaultSummary,
            sealedAt: (signerBody.sealedAt as string | undefined) ?? null,
            fleetAccountsWithKeys,
            vaultAccountCount: vaultNames.length,
            fleetAllConnected
          },
          services: svcs.map((s) => ({ name: s.name, port: s.port, alive: s.alive, disabled: s.disabled })),
          steemPlane: plane.reachable
            ? {
                reachable: true,
                measuredAt: planeBody.measuredAt ?? null,
                steemPerMvest: planeBody.steemPerMvest ?? null,
                summary: planeSummary,
                accounts: planeAccounts
              }
            : { reachable: false, error: plane.error ?? "steem-plane-unreachable" }
        },
        openGaps,
        material: ownerMaterial,
        wallets: {
          derivation: "נגזרים מצירוף-התמונה של הבעלים · TRON משפחה m/44'/195'/0'/0/i (idx0..idx5) · חומר-מפתח פרטי לעולם לא מוצג כאן",
          tron: [...TRON_FAMILY.map(([label, address]) => ({ label, address })), { label: "כתובת פורנזית (TYVw…)", address: TRON_FORENSIC }],
          eth: ETH_ADDRESSES.map(([label, address]) => ({ label, address })),
          sol: [{ label: "כתובת פורנזית (9knf…)", address: SOL_FORENSIC }],
          outflows: OUTFLOWS.map(([label, address]) => ({ label, address }))
        },
        files
      },
      { headers: { "cache-control": "no-store" } }
    );

    // audit WITHOUT any secret material — verdict shapes only
    await audit({
      kind: "keys-map-read",
      actor: "panel",
      action: "GET /keys-map",
      allowed: true,
      req,
      detail: JSON.stringify({ hashMatch, signerReachable: signer.reachable })
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `keys-map-failed: ${coarseError(e, "internal error withheld")}` },
      { status: 500 }
    );
  }
}
