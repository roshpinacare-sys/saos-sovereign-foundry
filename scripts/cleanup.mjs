#!/usr/bin/env bun
/**
 * cleanup — retention policy executor (Task 5, mission 6).
 *
 *   bun scripts/cleanup.mjs           # DRY-RUN: report what WOULD be deleted
 *   bun scripts/cleanup.mjs --yes     # execute deletions (audited in OpLog)
 *
 * Retention policy (docs/database.md §retention):
 *   KEEP FOREVER (protected — the script refuses to touch them):
 *     SealRecord, SealLeaf, AnchorTx, EvidenceReceipt, ResearchFinding, AuditEvent
 *   PRUNABLE:
 *     OpLog              older than 90 days (youngest 1000 rows always kept)
 *     EnergyPlan         older than 180 days
 *     EconomySnapshot    older than 180 days (youngest 100 rows always kept)
 *     PendingSignature   expired more than 30 days ago
 *     backups/           older than the newest SAOS_BACKUP_KEEP (handled by backup.mjs)
 *
 * SAFETY: refuses to run with --yes unless a VERIFIED backup exists (OpLog op=backup,
 * verified, younger than 24h). No backup → no deletion. Ever.
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const yes = process.argv.includes("--yes");
const D = (n) => new Date(Date.now() - n * 86_400_000);

const RETENTION = {
  opLog: { days: 90, keepYoungest: 1000 },
  energyPlan: { days: 180, keepYoungest: 0 },
  economySnapshot: { days: 180, keepYoungest: 100 },
  pendingSignature: { days: 30, keepYoungest: 0 } // measured from expiresAt
};

async function countPrunable(db) {
  const plan = {};

  // OpLog: age cut AND "keep youngest N" — the effective cut is the YOUNGER of the two
  const oplogAgeCut = D(RETENTION.opLog.days);
  const boundary = await db.opLog.findMany({
    orderBy: { createdAt: "desc" },
    skip: RETENTION.opLog.keepYoungest - 1,
    take: 1,
    select: { createdAt: true }
  });
  const keepCut = boundary[0]?.createdAt ?? null; // youngest row that may be deleted (protects the newest 1000)
  plan.opLogCut = keepCut && keepCut > oplogAgeCut ? keepCut : oplogAgeCut;
  plan.opLog = keepCut ? await db.opLog.count({ where: { createdAt: { lt: plan.opLogCut } } }) : 0;

  plan.energyPlan = await db.energyPlan.count({ where: { createdAt: { lt: D(RETENTION.energyPlan.days) } } });

  // EconomySnapshot: never prune the youngest 100
  const ecoBoundary = await db.economySnapshot.findMany({
    orderBy: { createdAt: "desc" },
    skip: RETENTION.economySnapshot.keepYoungest - 1,
    take: 1,
    select: { createdAt: true }
  });
  const ecoCut = ecoBoundary[0] ? (ecoBoundary[0].createdAt > D(RETENTION.economySnapshot.days) ? ecoBoundary[0].createdAt : D(RETENTION.economySnapshot.days)) : null;
  plan.economySnapshotCut = ecoCut;
  plan.economySnapshot = ecoCut ? await db.economySnapshot.count({ where: { createdAt: { lt: ecoCut } } }) : 0;

  plan.pendingSignature = await db.pendingSignature.count({ where: { expiresAt: { lt: D(RETENTION.pendingSignature.days) } } });

  const backupsDir = path.join(ROOT, "backups");
  plan.backupDirs = fs.existsSync(backupsDir)
    ? fs.readdirSync(backupsDir).filter((d) => d.startsWith("backup-")).length
    : 0;
  return plan;
}

async function main() {
  const db = new PrismaClient();

  // safety gate: verified backup within 24h is mandatory for --yes
  let backupOk = false;
  const lastBackup = await db.opLog.findFirst({ where: { op: "backup" }, orderBy: { createdAt: "desc" } });
  if (lastBackup && /verified=true/.test(lastBackup.detail ?? "") && Date.now() - lastBackup.createdAt.getTime() < 86_400_000) {
    backupOk = true;
  }

  const plan = await countPrunable(db);
  const total = plan.opLog + plan.energyPlan + plan.economySnapshot + plan.pendingSignature;

  console.log(`\ncleanup ${yes ? "--yes (REAL)" : "(dry-run)"} — retention plan:`);
  console.log(`   OpLog >${RETENTION.opLog.days}d (keep youngest ${RETENTION.opLog.keepYoungest}):   ${plan.opLog}`);
  console.log(`   EnergyPlan >${RETENTION.energyPlan.days}d:                     ${plan.energyPlan}`);
  console.log(`   EconomySnapshot >${RETENTION.economySnapshot.days}d (keep 100):       ${plan.economySnapshot}`);
  console.log(`   PendingSignature expired >${RETENTION.pendingSignature.days}d:    ${plan.pendingSignature}`);
  console.log(`   backups/ dirs present: ${plan.backupDirs}`);
  console.log(`   total prunable rows: ${total}`);
  console.log(`   protected (never touched): SealRecord, SealLeaf, AnchorTx, EvidenceReceipt, ResearchFinding, AuditEvent`);

  if (!yes) {
    console.log("\n(dry-run) nothing deleted. add --yes to execute (requires a verified backup <24h old).");
    await db.$disconnect();
    return;
  }

  if (!backupOk) {
    console.error("\n❌ refused: no VERIFIED backup younger than 24h — run `bun run backup` first (no backup → no deletion)");
    await db.$disconnect();
    process.exit(1);
  }
  if (total === 0) {
    console.log("\n✅ nothing to clean.");
    await db.$disconnect();
    return;
  }

  const deleted = {};
  if (plan.opLog > 0) deleted.opLog = (await db.opLog.deleteMany({ where: { createdAt: { lt: plan.opLogCut } } })).count;
  if (plan.energyPlan > 0) deleted.energyPlan = (await db.energyPlan.deleteMany({ where: { createdAt: { lt: D(RETENTION.energyPlan.days) } } })).count;
  if (plan.economySnapshot > 0) {
    const cut = plan.economySnapshotCut ?? D(RETENTION.economySnapshot.days);
    deleted.economySnapshot = (await db.economySnapshot.deleteMany({ where: { createdAt: { lt: cut } } })).count;
  }
  if (plan.pendingSignature > 0) deleted.pendingSignature = (await db.pendingSignature.deleteMany({ where: { expiresAt: { lt: D(RETENTION.pendingSignature.days) } } })).count;

  await db.opLog.create({
    data: { op: "cleanup", detail: `deleted=${JSON.stringify(deleted)} total=${total} backupVerified=true` }
  });

  console.log(`\n✅ cleanup executed: ${JSON.stringify(deleted)}`);
  await db.$disconnect();
}

main().catch((e) => { console.error("cleanup crashed:", e.message); process.exit(1); });
