import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import {
  DECISION_STATUSES,
  OWNER_DECISIONS,
  type DecisionStatus
} from "@/lib/saos/owner-decisions";

export const dynamic = "force-dynamic";

/**
 * /api/saos/decisions — owner decisions registry + recorded statuses (Task 10).
 *
 * GET (public, read-only):
 *   The registry is compiled from the project documentation (owner-decisions.ts
 *   — every entry cites its source doc). Recorded statuses (who decided what,
 *   when + public note) are merged from the DB.
 *
 * POST {key, status, note?} — AUTH REQUIRED + audited (kind=decision-update).
 *   Records the owner's decision for ONE registry key. The registry content
 *   itself is never editable here — only its recorded status. This endpoint is
 *   bookkeeping: it does not change modes, does not broadcast, does not fund.
 *
 * Statuses: open | decided-default | decided-custom | deferred
 */
function isDecisionStatus(v: unknown): v is DecisionStatus {
  return typeof v === "string" && (DECISION_STATUSES as readonly string[]).includes(v);
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("decisions", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const recorded = await db.decisionRecord.findMany();
    const byKey = new Map(recorded.map((r) => [r.key, r]));
    const decisions = OWNER_DECISIONS.map((d) => {
      const rec = byKey.get(d.key);
      return {
        ...d,
        recordedStatus: rec?.status ?? "open",
        note: rec?.note ?? null,
        decidedAt: rec?.updatedAt ?? null
      };
    });
    const openCritical = decisions.filter((d) => d.recordedStatus === "open" && d.critical).length;
    const openAll = decisions.filter((d) => d.recordedStatus === "open").length;
    return NextResponse.json({
      ok: true,
      counts: { total: decisions.length, open: openAll, openCritical, decided: decisions.length - openAll },
      decisions,
      sourceNote: "הרישום נערך מתוך תיעוד המערכת (docs/*) — זהו תוכן תיעודי, לא נתון חי; הסטטוסים שהוקלטו נשמרים ב-DB"
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "decisions read failed" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const rl = enforceRateLimit("decisions", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const auth = requireAuth(req);
    if (!auth.ok) {
      await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "POST /decisions", allowed: false, req, detail: auth.error });
      return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
    }

    let body: { key?: unknown; status?: unknown; note?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // handled below by validation
    }

    const key = typeof body.key === "string" ? body.key : null;
    const decision = OWNER_DECISIONS.find((d) => d.key === key);
    if (!decision) {
      return NextResponse.json({ ok: false, error: "key required — one of the registry keys (GET /api/saos/decisions)" }, { status: 200 });
    }
    if (!isDecisionStatus(body.status)) {
      return NextResponse.json({ ok: false, error: `status required: ${DECISION_STATUSES.join(" | ")}` }, { status: 200 });
    }
    const note =
      typeof body.note === "string" && body.note.trim().length > 0 ? body.note.trim().slice(0, 300) : null;

    const saved = await db.decisionRecord.upsert({
      where: { key: decision.key },
      create: { key: decision.key, status: body.status, note },
      update: { status: body.status, note }
    });

    await audit({ kind: "decision-update", actor: auth.actorRef, action: "POST /decisions", allowed: true, req, detail: `${decision.key} → ${saved.status}${note ? ` note=${note.slice(0, 60)}` : ""}` });

    return NextResponse.json({
      ok: true,
      decision: {
        key: decision.key,
        name: decision.name,
        recordedStatus: saved.status,
        note: saved.note,
        decidedAt: saved.updatedAt
      },
      note: "ההחלטה הוקלטה (רישום סטטוס בלבד — לא משנה מצב ריצה, לא מבצעת פעולה חיצונית)"
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "decisions write failed" }, { status: 200 });
  }
}
