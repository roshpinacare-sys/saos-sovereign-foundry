import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  audit,
  authConfigured,
  issueSession,
  ipHashOf,
  requireAuth,
  verifyLoginKey
} from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * /api/saos/auth — session login for sensitive operations (Task 5, mission 1).
 *
 * POST    {key}                → HttpOnly signed session cookie (12h default)
 * GET                          → {authConfigured, authenticated, actor} — no secret material
 * DELETE                       → logout (clears the cookie), audited
 *
 * Status discipline: 401 (bad/missing key), 403 (auth unconfigured) —
 * body always JSON {ok:false, error}. Rate-limited 8/min (brute-force guard).
 * Global revocation: POST /api/saos/auth/revoke-all (Task 11) rotates the
 * session epoch — every cookie issued before it becomes invalid instantly.
 */

export async function POST(req: Request) {
  const rl = enforceRateLimit("auth", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: נסיונות רבים מדי — נסה שוב בעוד מספר שניות", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let key = "";
  try {
    const body = (await req.json()) as { key?: unknown };
    key = typeof body.key === "string" ? body.key : "";
  } catch {
    key = "";
  }

  if (!authConfigured()) {
    await audit({ kind: "auth-login-failed", actor: "unconfigured", action: "POST /auth", allowed: false, req, detail: "auth-unconfigured" });
    return NextResponse.json(
      { ok: false, error: "auth-unconfigured: SAOS_ADMIN_KEY_HASH לא הוגדר על השרת — אין למי להתחבר (fail-closed)" },
      { status: 403 }
    );
  }

  if (!key) {
    await audit({ kind: "auth-login-failed", actor: "anonymous", action: "POST /auth", allowed: false, req, detail: "missing key" });
    return NextResponse.json({ ok: false, error: "auth-required: חסר key" }, { status: 401 });
  }

  if (!verifyLoginKey(key)) {
    // key material is never logged — only the coarse ip fingerprint
    await audit({ kind: "auth-login-failed", actor: "anonymous", action: "POST /auth", allowed: false, req, detail: "key mismatch" });
    return NextResponse.json({ ok: false, error: "auth-denied: מפתח שגוי" }, { status: 401 });
  }

  const session = await issueSession();
  await audit({ kind: "auth-login", actor: "cookie", action: "POST /auth", allowed: true, req });
  const res = NextResponse.json({ ok: true, authenticated: true, sessionTtlSec: session.maxAgeSec });
  res.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "strict",
    secure: false, // sandbox serves plain HTTP; set true behind HTTPS in real deployment (docs/deployment.md)
    path: "/",
    maxAge: session.maxAgeSec
  });
  return res;
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("auth", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  const auth = await requireAuth(req);
  return NextResponse.json({
    ok: true,
    authConfigured: auth.authConfigured,
    authenticated: auth.ok,
    actor: auth.ok ? auth.actor : "anonymous",
    ipHash: ipHashOf(req)
  });
}

export async function DELETE(req: Request) {
  const rl = enforceRateLimit("auth", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  const auth = await requireAuth(req);
  await audit({ kind: "auth-logout", actor: auth.actorRef, action: "DELETE /auth", allowed: true, req });
  const res = NextResponse.json({ ok: true, authenticated: false });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
