import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

import { audit } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST/GET /api/saos/owner-keys — Task 29: the owner's key entry point.
 *
 * WHERE THE OWNER'S KEY IS CONNECTED (owner directive 2026-09-09: "אין לי איפה"):
 *   the control screen (Security tab) collects the STEEM/HIVE active key and
 *   this route forwards it — server-side, inside the environment — to the
 *   external signer (:3033, Bearer) which is the ONLY component that touches
 *   key material. Discipline:
 *     - the plaintext key lives in this request body for milliseconds, is
 *       NEVER logged, audited, cached or persisted anywhere;
 *     - the signer verifies the derived pubkey against the LIVE chain
 *       authority of the fleet accounts — a foreign/wrong key can never be
 *       written (self-protecting by construction: an attacker with the URL
 *       can only ever get honest "no-match" verdicts);
 *     - responses carry verdicts and PUBLIC keys only (derived/expected
 *       pubkeys are on-chain public data), never the WIF;
 *     - POST is rate-limited hard (6/min) + audited with verdicts only.
 */

const SIGNER_URL = process.env.SAOS_SIGNER_URL ?? "http://127.0.0.1:3033";
const NETWORKS = new Set(["STEEM", "HIVE"]);

function signerToken(): string {
  try {
    return readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "external-signer-token"), "utf8").trim();
  } catch {
    return "";
  }
}

async function signerFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const token = signerToken();
  if (!token) return NextResponse.json({ ok: false, error: "signer-token-unavailable (fail-closed)" }, { status: 503 });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    return await fetch(SIGNER_URL + pathname, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      signal: ctl.signal
    });
  } finally {
    clearTimeout(t);
  }
}

export async function GET(_req: Request) {
  try {
    const res = await signerFetch("/keys/status", { method: "GET" });
    const body = await res.json().catch(() => ({ ok: false, error: "signer returned non-JSON" }));
    return NextResponse.json(body, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `signer-unreachable: ${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const rl = enforceRateLimit("owner-keys", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: ניסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: { entries?: Array<{ network?: string; wif?: string; role?: string }>; network?: string; wif?: string; text?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }

  // v2.4.0 universal paste: the owner may paste ANY format — a multi-line key
  // file ("OWNER = 5K…"), a single WIF, a master password or a 64-hex seed.
  // The signer parses + verifies everything against the live chain.
  const text = typeof body?.text === "string" && body.text.trim().length > 0 ? body.text.slice(0, 8000) : null;
  if (text) {
    try {
      const res = await signerFetch("/keys/ingest", { method: "POST", body: JSON.stringify({ text }) });
      const verdict = await res.json().catch(() => ({ ok: false, error: "signer returned non-JSON" }));
      await audit({
        kind: "owner-keys-ingest",
        actor: "owner-panel",
        action: "POST /owner-keys (universal-paste)",
        allowed: Boolean((verdict as { ok?: boolean })?.ok),
        req,
        detail: JSON.stringify({ ingested: (verdict as { ingested?: unknown[] })?.ingested ?? [], refusedCount: ((verdict as { refused?: unknown[] })?.refused ?? []).length }).slice(0, 400)
      });
      return NextResponse.json(verdict);
    } catch (e) {
      return NextResponse.json({ ok: false, error: `signer-unreachable: ${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 502 });
    }
  }

  const rawEntries = Array.isArray(body.entries)
    ? body.entries.slice(0, 16)
    : body.wif
      ? [{ network: body.network, wif: body.wif }]
      : [];
  const entries = rawEntries
    .map((e) => ({ network: NETWORKS.has(String(e?.network)) ? String(e.network) : null, wif: typeof e?.wif === "string" ? e.wif.trim() : "" }))
    .filter((e): e is { network: string | null; wif: string } => e.wif.length >= 40 && e.wif.length <= 120);
  if (!entries.length) {
    return NextResponse.json({ ok: false, error: "אין מפתח תקין בבקשה — נדרש מפתח-פעיל (WIF) עבור STEEM או HIVE" }, { status: 400 });
  }

  try {
    const res = await signerFetch("/keys/ingest", { method: "POST", body: JSON.stringify({ entries }) });
    const verdict = await res.json().catch(() => ({ ok: false, error: "signer returned non-JSON" }));
    // audit: verdicts ONLY — the request body (the key) is never recorded
    await audit({
      kind: "owner-keys-ingest",
      actor: "owner-panel",
      action: "POST /owner-keys",
      allowed: Boolean((verdict as { ok?: boolean })?.ok),
      req,
      detail: JSON.stringify({ ingested: (verdict as { ingested?: unknown[] })?.ingested ?? [], refusedCount: ((verdict as { refused?: unknown[] })?.refused ?? []).length }).slice(0, 400)
    });
    return NextResponse.json(verdict);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `signer-unreachable: ${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 502 });
  }
}
