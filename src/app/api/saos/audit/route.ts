import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { coarseError } from "@/lib/saos/api-errors";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/audit — read the security audit trail (Task 5, mission 1).
 * AUTH REQUIRED — the audit log reveals operational patterns and is itself sensitive.
 * Output: recent events (no key material ever — actor/ipHash are non-reversible labels),
 * per-kind counts, and the count of denied attempts (failed logins, denied sensitives).
 */
export async function GET(req: Request) {
  const rl = enforceRateLimit("audit", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) {
      await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "GET /audit", allowed: false, req, detail: auth.error });
      return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
    }

    // roast 57: a non-numeric take ("6abc") used to hand Prisma a NaN and blow
    // the whole read with a RAW internal error leaked into the response
    // (LIVE-CAUGHT, paths included); a fractional take ("1.5") also risked the
    // same. Parse defensively: non-finite → default 50, then truncate+clamp.
    const rawTake = Number(new URL(req.url).searchParams.get("take") ?? 50);
    const take = Math.min(100, Math.max(1, Number.isFinite(rawTake) ? Math.trunc(rawTake) : 50));
    const [events, byKind, denied] = await Promise.all([
      db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take }),
      db.auditEvent.groupBy({ by: ["kind"], _count: { _all: true } }),
      db.auditEvent.count({ where: { allowed: false } })
    ]);

    return NextResponse.json({
      ok: true,
      counts: { total: byKind.reduce((acc, k) => acc + k._count._all, 0), denied, byKind: byKind.map((k) => ({ kind: k.kind, count: k._count._all })) },
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        actor: e.actor,
        action: e.action,
        allowed: e.allowed,
        ipHash: e.ipHash,
        detail: e.detail,
        createdAt: e.createdAt
      }))
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: coarseError(e, "audit-read-failed") }, { status: 200 });
  }
}
