import { existsSync, readFileSync, statSync } from "fs";
import { NextResponse } from "next/server";
import path from "path";

import { audit, authConfigured, verifyLoginKey } from "@/lib/saos/auth";
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
    return { reachable: false, error: String((e as Error)?.message ?? e).slice(0, 120) };
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
  ["ריכוז 18.70 TRX (08-09)", "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn"],
  ["ארנק 2020 — 17.09 TRX יושב", "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU"],
  ["SOL יעד יציאה — 0.0239 SOL", "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj"],
  ["מממן חיצוני (מקור)", "TGUYnMLufLM19NoJcyWkaU32kVjQso2bpQ"]
];

export async function GET(req: Request) {
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

    // ── 3. key files (paths + sizes only, NEVER content) ──
    const files = [
      fileMeta(path.join(UPLOAD_DIR, "הדקור.txt"), "ערכת המפתחות האמיתית של headcorner (STEEM+HIVE) — הועלתה על ידי הבעלים"),
      fileMeta(path.join(UPLOAD_DIR, "בלורט.evm"), "מעטפת BLURT"),
      fileMeta(uploadPath, "עותק מפתח-אדמין (המיקום ההיסטורי של הבעלים)"),
      fileMeta(secretPath, "מפתח-אדמין — מחוץ לעץ הפרויקט (SH-7)"),
      fileMeta(path.join(SECRETS_DIR, "external-signer-token"), "טוקן אימות לחותם החיצוני :3033"),
      fileMeta(path.join(SECRETS_DIR, "fleet-envelope"), "מעטפת-הצי החתומה (WIF-ים — החומר עצמו לעולם לא נחשף)")
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
      { ok: false, error: `keys-map-failed: ${String((e as Error)?.message ?? e).slice(0, 160)}` },
      { status: 500 }
    );
  }
}
