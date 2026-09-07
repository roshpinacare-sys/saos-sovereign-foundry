import { NextResponse } from "next/server";
import { SESSION_COOKIE, audit, requireAuth, revokeAllSessions } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * /api/saos/auth/revoke-all — global session revocation (Task 11, part ג).
 *
 * POST — AUTH REQUIRED (admin match: session cookie OR Bearer key).
 *   Rotates the session epoch (SessionControl table): every session cookie
 *   issued before this call becomes invalid INSTANTLY — including the
 *   caller's own. The mechanism stores no secret material (only a random
 *   epoch hex) and no session list. Bearer-key requests are unaffected by
 *   design: revocation kills sessions, not the admin key.
 *
 *   Always audited (kind=auth-revoke-all). Rate-limited 4/min.
 *   Response clears the caller's cookie; re-login is required afterwards.
 *
 * There is no GET/DELETE here — revocation is a deliberate, confirmed,
 * audited POST only.
 */
export async function POST(req: Request) {
  const rl = enforceRateLimit("auth-revoke", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: נסיונות רבים מדי — נסה שוב בעוד מספר שניות", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const auth = await requireAuth(req);
  if (!auth.ok) {
    await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "POST /auth/revoke-all", allowed: false, req, detail: auth.error });
    return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
  }

  try {
    await revokeAllSessions(auth.actorRef, "owner-initiated global session revocation");
    await audit({ kind: "auth-revoke-all", actor: auth.actorRef, action: "POST /auth/revoke-all", allowed: true, req, detail: "session epoch rotated — כל הסשנים הפעילים בוטלו (כולל המבקש)" });

    const res = NextResponse.json({
      ok: true,
      revokedAt: new Date().toISOString(),
      note:
        "כל הסשנים נותקו — בוצע באמצעות רוטציית epoch של הסשן (ללא אחסון רשימת סשנים וללא חומר-סוד). נדרשת התחברות מחדש; מפתח Bearer אינו מושפע (עיצוב מכוון)."
    });
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "revoke-all failed" }, { status: 200 });
  }
}
