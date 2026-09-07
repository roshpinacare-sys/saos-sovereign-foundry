/**
 * backfill-receipt-at — one-time digest-proven recovery of the forge `at`
 * timestamp for legacy EvidenceReceipt rows (written before the `at` column
 * existed). Not data fitting: a candidate timestamp is accepted ONLY when the
 * recomputed sha256 canonical digest equals the stored digest — the hash is
 * the proof. Rows that cannot be recovered are left null and reported.
 *
 * Run once:  bun scripts/backfill-receipt-at.ts
 * Idempotent: rows that already have `at` are skipped.
 */
import { PrismaClient } from "@prisma/client";
import { canonicalDigest } from "../src/lib/saos/canonical-json";

const db = new PrismaClient();
const WINDOW_MS = 10_000; // forge happens at most ~seconds before the row insert

async function main() {
  const rows = await db.evidenceReceipt.findMany({ orderBy: { createdAt: "asc" } });
  let recovered = 0, failed = 0, skipped = 0;

  for (const [i, r] of rows.entries()) {
    if (r.at !== null) { skipped++; continue; }
    const payload = JSON.parse(r.payload);
    const rowMs = r.createdAt.getTime();
    let found: number | null = null;
    for (let ms = rowMs; ms >= rowMs - WINDOW_MS; ms--) {
      const at = new Date(ms).toISOString();
      const digest = await canonicalDigest({ kind: r.kind, at, payload, prevDigest: r.prevDigest });
      if (digest === r.digest) { found = ms; break; }
    }
    if (found !== null) {
      await db.evidenceReceipt.update({ where: { id: r.id }, data: { at: new Date(found) } });
      recovered++;
      console.log(`  ✅ [${i}] ${r.kind} → at=${new Date(found).toISOString()} (digest-proven)`);
    } else {
      failed++;
      console.log(`  ❌ [${i}] ${r.kind} digest=${r.digest.slice(0, 16)}… — no candidate in window matched (left null)`);
    }
  }
  console.log(`\nbackfill: recovered=${recovered} failed=${failed} skipped(already-set)=${skipped} total=${rows.length}`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("backfill crashed:", e); process.exit(1); });
