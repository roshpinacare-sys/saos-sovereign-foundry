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
 * /api/saos/decisions — owner decisions registry + recorded statuses (Task 10,
 * closure tooling — Task 11).
 *
 * GET (public, read-only):
 *   The registry is compiled from the project documentation (owner-decisions.ts
 *   — every entry cites its source doc). Recorded statuses (who decided what,
 *   when + public note) are merged from the DB, and each decision carries its
 *   auditTrail (decision-update AuditEvents, actor = non-reversible label).
 *   Spec field names (Task 11): id, title, category, severity, status,
 *   defaultSafeAction, requiredOwnerAction, timeEstimate, updatedAt.
 *
 * POST {key, status, note?} — AUTH REQUIRED + audited (kind=decision-update).
 *   Records the owner's decision for ONE registry key. The registry content
 *   itself is never editable here — only its recorded status. This endpoint is
 *   bookkeeping: it does not change modes, does not broadcast, does not fund,
 *   does not anchor.
 *
 * Statuses: open | decided-default | decided-custom | needs-resource |
 *           resolved-external | deferred | rejected
 */

function isDecisionStatus(v: unknown): v is DecisionStatus {
  return typeof v === "string" && (DECISION_STATUSES as readonly string[]).includes(v);
}

/** parse the audit detail format "<key> → <status> note=..." (our own stable format) */
function parseDecisionDetail(detail: string, key: string): { status: string; note: string | null } | null {
  if (!detail.startsWith(`${key} `) && !detail.startsWith(`${key}→`)) return null;
  const rest = detail.slice(key.length).replace(/^\s*→\s*/, "").trim();
  const noteIdx = rest.indexOf(" note=");
  if (noteIdx >= 0) return { status: rest.slice(0, noteIdx).trim(), note: rest.slice(noteIdx + 6).trim() || null };
  return { status: rest.trim(), note: null };
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("decisions", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const [recorded, auditEvents] = await Promise.all([
      db.decisionRecord.findMany(),
      db.auditEvent.findMany({ where: { kind: "decision-update" }, orderBy: { createdAt: "desc" }, take: 300 })
    ]);
    const byKey = new Map(recorded.map((r) => [r.key, r]));
    const decisions = OWNER_DECISIONS.map((d) => {
      const rec = byKey.get(d.key);
      const trail = auditEvents
        .filter((ev) => parseDecisionDetail(ev.detail ?? "", d.key) !== null)
        .map((ev) => ({ at: ev.createdAt.toISOString(), actor: ev.actor, detail: ev.detail ?? "" }));
      return {
        // registry fields (doc-compiled)
        ...d,
        // spec-named aliases (Task 11 contract)
        id: d.key,
        title: d.name,
        defaultSafeAction: d.safeDefault,
        requiredOwnerAction: d.requiredAction,
        timeEstimate: d.time,
        // recorded state
        recordedStatus: rec?.status ?? "open",
        status: rec?.status ?? "open",
        note: rec?.note ?? null,
        decidedAt: rec?.updatedAt ?? null,
        updatedAt: rec?.updatedAt ?? null,
        auditTrail: trail
      };
    });
    const openCritical = decisions.filter((d) => d.recordedStatus === "open" && d.critical).length;
    const openAll = decisions.filter((d) => d.recordedStatus === "open").length;
    return NextResponse.json({
      ok: true,
      counts: {
        total: decisions.length,
        open: openAll,
        openCritical,
        decided: decisions.length - openAll,
        needsResource: decisions.filter((d) => d.recordedStatus === "needs-resource").length
      },
      decisions,
      sourceNote: "הרישום נערך מתוך תיעוד המערכת (docs/*) — זהו תוכן תיעודי, לא נתון חי; הסטטוסים שהוקלטו נשמרים ב-DB עם היסטוריית ביקורת"
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
    const auth = await requireAuth(req);
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
        id: decision.key,
        name: decision.name,
        recordedStatus: saved.status,
        status: saved.status,
        note: saved.note,
        decidedAt: saved.updatedAt,
        updatedAt: saved.updatedAt
      },
      note: "ההחלטה הוקלטה (רישום סטטוס בלבד — לא משנה מצב ריצה, לא מבצעת פעולה חיצונית, לא מבצעת עוגן)"
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "decisions write failed" }, { status: 200 });
  }
}
