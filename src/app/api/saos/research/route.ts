import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { persistenceAllowed } from "@/lib/saos/modes";
import { FINDINGS, SYNTHESIS } from "@/lib/saos/findings";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/research — the research verdict ledger (restored Task 10).
 *
 * The route was documented in docs/api.md §7 and asserted by api-check, but
 * its file never entered git history (previous working trees only). Restored
 * here EXACTLY per the documented contract:
 *   {ok, findings[10]{archive,rank,score,verdict,salvage[],evidence[]},
 *    synthesis{chosen,why[],roadmap[]}}
 *
 * Side effect (write-enabled modes only): idempotent upsert of every finding
 * into ResearchFinding — the DB mirror for audit. Read of the verdict itself
 * is served from the compiled constant (the source of truth), never the DB.
 */
export async function GET(req: Request) {
  const rl = enforceRateLimit("research", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    let persisted = false;
    if (persistenceAllowed()) {
      await db.$transaction(
        FINDINGS.map((f) =>
          db.researchFinding.upsert({
            where: { archive: f.archive },
            create: {
              archive: f.archive,
              rank: f.rank,
              score: f.score,
              verdict: f.verdict,
              salvage: JSON.stringify(f.salvage),
              evidence: JSON.stringify(f.evidence)
            },
            update: {
              rank: f.rank,
              score: f.score,
              verdict: f.verdict,
              salvage: JSON.stringify(f.salvage),
              evidence: JSON.stringify(f.evidence)
            }
          })
        )
      );
      persisted = true;
    }

    return NextResponse.json({
      ok: true,
      findings: FINDINGS.map((f) => ({
        archive: f.archive,
        rank: f.rank,
        score: f.score,
        verdict: f.verdict,
        salvage: f.salvage,
        evidence: f.evidence
      })),
      synthesis: SYNTHESIS,
      persisted,
      note: persisted
        ? "פסק-הדין משקף מול-DB עודכן (upsert idempotent) — המקור הוא הקוד המתועד, לא ה-DB"
        : "קריאה-בלבד (מצב ללא כתיבה) — לא בוצע משקף מול DB"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "research failed" },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}
