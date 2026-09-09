import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

import { audit } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST/GET /api/saos/agent-bridge — Task 32: גשר-סוכנים (agent attachment API).
 *
 * The owner can attach ANY agent (in any chat) via API: the agent receives a
 * shared capability token from the owner (x-agent-token header), and can:
 *   - kind=message  → post a text message into the owner's live feed
 *   - kind=action   → request a whitelisted READ-ONLY action which is executed
 *                     immediately and its PUBLIC result returned + recorded
 *
 * Whitelisted actions (read-only, no key material, verify-then-report only):
 *   keys-status | verify-live | health
 *
 * Discipline:
 *   - the capability token lives ONLY in ~/.secrets/agent-bridge-token (0600);
 *     it is never committed, never logged, and rotatable by deleting the file;
 *   - messages are length-capped plain text; NO secret may pass through
 *     (agents are instructed to push keys ONLY through the encrypted-backup
 *     path — the bridge is for coordination, never for key transit);
 *   - rate-limited hard (10/min) + audited.
 */

const SIGNER_URL = process.env.SAOS_SIGNER_URL ?? "http://127.0.0.1:3033";
const ACTIONS = new Set(["keys-status", "verify-live", "health"]);
const MAX_CONTENT = 4000;
const MAX_AGENT = 64;

function bridgeToken(): string {
  try {
    return readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "agent-bridge-token"), "utf8").trim();
  } catch {
    return "";
  }
}

function signerToken(): string {
  try {
    return readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "external-signer-token"), "utf8").trim();
  } catch {
    return "";
  }
}

async function signerFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const token = signerToken();
  if (!token) throw new Error("signer-token-unavailable (fail-closed)");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
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

async function executeAction(action: string): Promise<{ ok: boolean; result: unknown }> {
  try {
    if (action === "keys-status") {
      const res = await signerFetch("/keys/status", { method: "GET" });
      return { ok: res.ok, result: await res.json() };
    }
    if (action === "verify-live") {
      const res = await signerFetch("/keys/verify-live", { method: "POST" });
      return { ok: res.ok, result: await res.json() };
    }
    if (action === "health") {
      const res = await signerFetch("/health", { method: "GET" });
      return { ok: res.ok, result: await res.json() };
    }
    return { ok: false, result: { error: "action-not-whitelisted" } };
  } catch (e) {
    return { ok: false, result: { error: `action-failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` } };
  }
}

// ── GET: the owner's live feed (latest messages + counters) ──────────────────
export async function GET() {
  try {
    const [messages, total, fresh] = await Promise.all([
      db.agentMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.agentMessage.count(),
      db.agentMessage.count({ where: { status: "new" } })
    ]);
    return NextResponse.json({ ok: true, messages, total, fresh });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `bridge-read-failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 502 });
  }
}

// ── PATCH: owner marks a message read (ack) ──────────────────────────────────
export async function PATCH(req: Request) {
  let body: { id?: string; status?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }
  const id = String(body?.id ?? "").trim();
  const status = body?.status === "ack" ? "ack" : null;
  if (!id || !status) return NextResponse.json({ ok: false, error: "missing id/status" }, { status: 400 });
  try {
    const row = await db.agentMessage.update({ where: { id }, data: { status } });
    return NextResponse.json({ ok: true, id: row.id, status: row.status });
  } catch {
    return NextResponse.json({ ok: false, error: "message not found" }, { status: 404 });
  }
}

// ── POST: an attached agent writes / requests ────────────────────────────────
export async function POST(req: Request) {
  const rl = enforceRateLimit("agent-bridge", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const expected = bridgeToken();
  if (!expected) {
    return NextResponse.json({ ok: false, error: "bridge-token-unavailable (owner must generate it first)" }, { status: 503 });
  }
  const provided = String(req.headers.get("x-agent-token") ?? "").trim();
  if (provided !== expected) {
    await audit({ kind: "agent-bridge-denied", actor: "agent", action: "POST /agent-bridge (bad token)", allowed: false, req, detail: null });
    return NextResponse.json({ ok: false, error: "unauthorized: חסר או שגוי x-agent-token (בקש מהבעלים)" }, { status: 401 });
  }

  let body: { agent?: string; kind?: string; content?: string; meta?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }

  const agent = String(body?.agent ?? "unknown-agent").trim().slice(0, MAX_AGENT) || "unknown-agent";
  const kind = body?.kind === "action" ? "action" : "message";
  const content = String(body?.content ?? "").trim().slice(0, MAX_CONTENT);
  const meta = body?.meta ? String(body.meta).slice(0, 500) : null;
  if (!content) {
    return NextResponse.json({ ok: false, error: "missing content" }, { status: 400 });
  }

  if (kind === "action") {
    const action = content.toLowerCase().replace(/\s+/g, "-");
    if (!ACTIONS.has(action)) {
      const row = await db.agentMessage.create({
        data: { agent, kind, content: content.slice(0, MAX_CONTENT), status: "refused", result: "action-not-whitelisted (read-only allow-list: keys-status | verify-live | health)", meta }
      });
      return NextResponse.json({ ok: false, id: row.id, status: "refused", error: "action-not-whitelisted (read-only allow-list: keys-status | verify-live | health)" }, { status: 400 });
    }
    const exec = await executeAction(action);
    const resultJson = JSON.stringify(exec.result).slice(0, 4000);
    const row = await db.agentMessage.create({
      data: { agent, kind, content: action, status: exec.ok ? "executed" : "refused", result: resultJson, meta }
    });
    await audit({ kind: "agent-bridge-action", actor: `agent:${agent.slice(0, 24)}`, action: `POST /agent-bridge ${action}`, allowed: exec.ok, req, detail: null });
    return NextResponse.json({ ok: exec.ok, id: row.id, status: row.status, result: exec.result });
  }

  const row = await db.agentMessage.create({
    data: { agent, kind, content, status: "new", meta }
  });
  await audit({ kind: "agent-bridge-message", actor: `agent:${agent.slice(0, 24)}`, action: "POST /agent-bridge message", allowed: true, req, detail: `${content.length} chars` });
  return NextResponse.json({ ok: true, id: row.id, status: row.status, note: "ההודעה נכנסה לפיד של הבעלים במסך-הבקרה (טאב סוכנים)" });
}
