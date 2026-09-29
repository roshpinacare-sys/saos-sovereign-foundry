import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

import { audit, requireAuth } from "@/lib/saos/auth";
import { coarseError } from "@/lib/saos/api-errors";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/verify-live — Task 32: on-demand FULL live-connection check.
 *
 * Asks the external signer (:3033) to re-derive EVERY loaded key slot and
 * compare it against the CURRENT on-chain authority (STEEM+HIVE ×
 * owner/active/posting/memo). This is the "הכל מחובר?" button — the same
 * check the drift monitor runs automatically every 10 minutes.
 *
 * Public data only: counts + public keys; no key material ever returned.
 */

const SIGNER_URL = process.env.SAOS_SIGNER_URL ?? "http://127.0.0.1:3033";

function signerToken(): string {
  try {
    return readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "external-signer-token"), "utf8").trim();
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const rl = enforceRateLimit("verify-live", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited: המתן רגע", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  // 2026-09-29 security gate (audit fix): this endpoint triggers a full
  // vault re-derivation against live authorities (90s window) — it is a
  // costly, oracle-grade operation and must not be anonymous. The panel
  // already sends the session cookie; scripts can use Bearer.
  const ar = await requireAuth(req);
  if (!ar.ok) {
    await audit({ kind: "verify-live", actor: ar.actor, action: "POST /verify-live", allowed: false, req, detail: "denied: " + (ar.error ?? "auth") });
    return NextResponse.json({ ok: false, error: ar.error ?? "auth-required" }, { status: ar.status });
  }
  const token = signerToken();
  if (!token) return NextResponse.json({ ok: false, error: "signer-token-unavailable (fail-closed)" }, { status: 503 });

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 90_000);
  try {
    const res = await fetch(`${SIGNER_URL}/keys/verify-live`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      signal: ctl.signal
    });
    const body = await res.json().catch(() => ({ ok: false, error: "signer returned non-JSON" }));
    await audit({
      kind: "verify-live",
      actor: "owner-panel",
      action: "POST /verify-live",
      allowed: Boolean((body as { ok?: boolean })?.ok),
      req,
      detail: JSON.stringify({ okSlots: (body as { ok?: number })?.ok, drift: (body as { drift?: number })?.drift }).slice(0, 200)
    });
    return NextResponse.json(body, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `signer-unreachable: ${coarseError(e, "internal error withheld")}` }, { status: 502 });
  } finally {
    clearTimeout(t);
  }
}
