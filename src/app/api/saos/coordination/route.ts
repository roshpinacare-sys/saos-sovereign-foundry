import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R231 · cockpit → engine coordination-center proxy (127.0.0.1:3040).
 * GET  → engine /coordination (schedule + power board + engagement matrix
 *        + trend topics) — all public chain reads, no secrets here either.
 * POST → operator actions: {action:"refresh"} | {action:"publish"}
 *        publish = broadcast the coordination manifest on-chain
 *        (saos.fleet.coordination.v1 custom_json, posting authority, no
 *        funds move) — the actual "תנסה לתאם איתם" hand to the second signer.
 */
const ENGINE_HTTP = "http://127.0.0.1:3040";

export async function GET() {
  try {
    const r = await fetch(`${ENGINE_HTTP}/coordination`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, engine: "down", hint: "mini-services/saos-engine not running", error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  let action = "refresh";
  try {
    const b = await req.json();
    if (b && ["publish", "refresh", "dry-run"].includes(b.action)) action = b.action;
  } catch { /* default refresh */ }
  /* R233 · dry-run = engine /execute {dry:true} — preflight plan, zero signing */
  const path = action === "publish" ? "/coordination/publish" : action === "dry-run" ? "/execute" : "/coordination/refresh";
  try {
    const r = await fetch(`${ENGINE_HTTP}${path}`, {
      method: "POST",
      headers: action === "dry-run" ? { "Content-Type": "application/json" } : undefined,
      body: action === "dry-run" ? JSON.stringify({ dry: true }) : undefined,
      signal: AbortSignal.timeout(110_000),
    });
    const j = await r.json();
    return NextResponse.json({ action, ...j }, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, action, engine: "down", error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
