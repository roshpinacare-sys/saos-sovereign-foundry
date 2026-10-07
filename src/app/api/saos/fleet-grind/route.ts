import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R236 · cockpit → engine fleet-grind proxy (127.0.0.1:3040/fleet-grind).
 * The profit pipeline truth: the fleet grind (1 vote + 1 engage per keyed
 * account, staggered windows) + the publisher rail (queued drafts → posts).
 * All verdicts and txids — no secrets here.
 */
const ENGINE_HTTP = "http://127.0.0.1:3040";

export async function GET() {
  try {
    const r = await fetch(`${ENGINE_HTTP}/fleet-grind`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, engine: "down", hint: "mini-services/saos-engine not running", error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
