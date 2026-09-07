/**
 * Access control (שכבת-הרשאות) — Task 5, mission 1.
 *
 * Design (honest, minimal, fail-closed):
 *  - The operator sets SAOS_ADMIN_KEY_HASH = sha256(adminKey) (hex). The
 *    plaintext key NEVER lives in code, DB, logs or the repo (.env is
 *    gitignored). The app only ever sees the hash.
 *  - Login: POST /api/saos/auth {key} → sha256(key) compared to the stored
 *    hash (timing-safe). On success an HttpOnly SameSite=Strict session
 *    cookie is issued:  "<expMs>.<hmac>"  where hmac = HMAC-SHA256(
 *    sessionSecret, String(expMs)). The cookie is stateless and expiring.
 *  - Session secret: SAOS_SESSION_SECRET if set, else derived as
 *    sha256("saos-session:" + adminKeyHash) — no extra secret to manage,
 *    and the derived value is never persisted or printed.
 *  - FAIL-CLOSED: if SAOS_ADMIN_KEY_HASH is not configured, EVERY sensitive
 *    operation is refused (403 auth-unconfigured) — an unconfigured system
 *    can never silently behave as an open one.
 *  - Alternative transport: `Authorization: Bearer <key>` is accepted and
 *    verified by the same hash comparison (for scripts/curl).
 *
 * HTTP status discipline (Task 5 amendment to the "errors are data" rule):
 *   500 is still never returned; 401/403/429 are now allowed — reserved
 *   exclusively for the security layer (auth / rate-limit), body is always
 *   JSON {ok:false, error}.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "saos_session";
export const SESSION_TTL_MS = Number(process.env.SAOS_SESSION_TTL_H ?? 12) * 3_600_000;

export type ActorLabel = "anonymous" | "bearer" | "cookie" | "unconfigured";

export interface AuthResult {
  ok: boolean;
  /** true when the operator has configured SAOS_ADMIN_KEY_HASH */
  authConfigured: boolean;
  authenticated: boolean;
  actor: ActorLabel;
  /** short non-reversible label for the audit log (never key material) */
  actorRef: string;
  /** HTTP status to return when ok=false: 401 (no/invalid credentials) or 403 (misconfigured) */
  status: 401 | 403;
  error?: string;
}

export function adminKeyHash(): string | null {
  const raw = (process.env.SAOS_ADMIN_KEY_HASH ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

export function authConfigured(): boolean {
  return adminKeyHash() !== null;
}

function sessionSecret(): string {
  const explicit = (process.env.SAOS_SESSION_SECRET ?? "").trim();
  if (explicit.length >= 16) return explicit;
  return createHash("sha256").update(`saos-session:${adminKeyHash() ?? "none"}`).digest("hex");
}

/** constant-time hex comparison — both sides must be equal length */
export function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** coarse, correlation-only ip fingerprint — never the raw address in the audit log */
export function ipHashOf(req: Request): string | null {
  const ip = clientIpOf(req);
  return ip ? createHash("sha256").update(ip).digest("hex").slice(0, 16) : null;
}

export function clientIpOf(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() ?? null;
}

function signExpiry(expMs: number): string {
  return createHmac("sha256", sessionSecret()).update(String(expMs)).digest("hex");
}

function cookieActorRef(cookie: string): string {
  return `cookie:${sha256Hex(cookie).slice(0, 8)}`;
}

/** verify the session cookie value "<expMs>.<hmac>" */
function validCookie(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return false;
  const expStr = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  if (!/^\d{10,16}$/.test(expStr) || !/^[0-9a-f]{64}$/.test(mac)) return false;
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || exp < Date.now()) return false;
  return safeHexEqual(mac, signExpiry(exp));
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/**
 * The single gate for every sensitive operation.
 * Verifies, in order: configuration → session cookie → bearer key.
 */
export function requireAuth(req: Request): AuthResult {
  const hash = adminKeyHash();
  if (!hash) {
    return {
      ok: false,
      authConfigured: false,
      authenticated: false,
      actor: "unconfigured",
      actorRef: "unconfigured",
      status: 403,
      error: "auth-unconfigured: SAOS_ADMIN_KEY_HASH לא הוגדר — פעולה רגישה נדחית (fail-closed)"
    };
  }

  const cookie = readCookie(req, SESSION_COOKIE);
  if (validCookie(cookie)) {
    return {
      ok: true,
      authConfigured: true,
      authenticated: true,
      actor: "cookie",
      actorRef: cookieActorRef(cookie!),
      status: 401
    };
  }

  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const presented = authz.slice(7).trim();
    const presentedHash = sha256Hex(presented);
    if (safeHexEqual(presentedHash, hash)) {
      return {
        ok: true,
        authConfigured: true,
        authenticated: true,
        actor: "bearer",
        actorRef: `bearer:${presentedHash.slice(0, 8)}`,
        status: 401
      };
    }
    return {
      ok: false,
      authConfigured: true,
      authenticated: false,
      actor: "bearer",
      actorRef: `bearer:${presentedHash.slice(0, 8)}`,
      status: 401,
      error: "auth-required: מפתח לא תקף"
    };
  }

  if (cookie) {
    return {
      ok: false,
      authConfigured: true,
      authenticated: false,
      actor: "cookie",
      actorRef: cookieActorRef(cookie),
      status: 401,
      error: "auth-required: הפעילות פגה או לא תקפה — התחבר מחדש"
    };
  }

  return {
    ok: false,
    authConfigured: true,
    authenticated: false,
    actor: "anonymous",
    actorRef: "anonymous",
    status: 401,
    error: "auth-required: פעולה רגישה דורשת התחברות (cookie או Bearer key)"
  };
}

/** issue a session cookie value + expiry for a verified login */
export function issueSession(): { value: string; maxAgeSec: number } {
  const exp = Date.now() + SESSION_TTL_MS;
  return { value: `${exp}.${signExpiry(exp)}`, maxAgeSec: Math.floor(SESSION_TTL_MS / 1000) };
}

/** verify a presented plaintext login key against the configured hash */
export function verifyLoginKey(key: string): boolean {
  const hash = adminKeyHash();
  if (!hash) return false;
  return safeHexEqual(sha256Hex(key.trim()), hash);
}

/** audit trail — every sensitive attempt lands here (allowed or denied) */
export async function audit(entry: {
  kind: string;
  actor: string;
  action: string;
  allowed: boolean;
  req: Request;
  detail?: string;
}): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        kind: entry.kind,
        actor: entry.actor,
        action: entry.action,
        allowed: entry.allowed,
        ipHash: ipHashOf(entry.req),
        detail: entry.detail ?? null
      }
    });
  } catch {
    // auditing must never crash the request path — surfaced via /audit counts
  }
}
