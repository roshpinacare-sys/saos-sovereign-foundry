#!/usr/bin/env bun
/**
 * backup — verified, evidence-grade backup (Task 5, mission 5).
 *
 *   bun scripts/backup.mjs
 *
 * What it does:
 *   1. consistent online snapshot via SQLite `VACUUM INTO` (safe while the dev
 *      server is running — no locks left behind, no stopped server needed)
 *   2. manifest.json: git commit, versions, per-file sha256+size, DB row counts,
 *      and the explicit EXCLUSIONS list (secrets never enter backups)
 *   3. verification: opens the snapshot with a second Prisma client,
 *      runs PRAGMA integrity_check and compares row counts to the manifest
 *   4. OpLog entry op=backup (the live-gate's backup-verified check reads it)
 *   5. retention: keeps the newest KEEP_BACKUPS (default 10), deletes older dirs
 *
 * NEVER included: .env, upload/, research/, node_modules, keys, tokens.
 */

import { createHash } from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const BACKUPS_DIR = path.join(ROOT, "backups");
const KEEP_BACKUPS = Number(process.env.SAOS_BACKUP_KEEP ?? 10);

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });

async function main() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(BACKUPS_DIR, `backup-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  // Task 43: resolve the DB path from the DATABASE the environment actually
  // uses (via the engine itself), not a hardcoded filename — CI runs on
  // db/ci.db, the sovereign box on db/custom.db. PRAGMA database_list names
  // the exact file Prisma opened, so the backup always snapshots the truth.
  let dbPath = path.join(ROOT, "db", "custom.db");
  {
    const probe = new PrismaClient();
    try {
      const rows = await probe.$queryRawUnsafe("PRAGMA database_list");
      const mainFile = Array.isArray(rows) ? rows.find((r) => r.name === "main")?.file : null;
      if (mainFile) dbPath = mainFile;
    } catch { /* fall back to the historical default */ }
    await probe.$disconnect();
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ database not found: ${dbPath}`);
    process.exit(1);
  }

  // 1. consistent snapshot
  const snapPath = path.join(dir, "db.sqlite3");
  const main = new PrismaClient();
  try {
    await main.$executeRawUnsafe(`VACUUM INTO '${snapPath}'`);
  } catch (e) {
    console.error("❌ VACUUM INTO failed:", e.message);
    await main.$disconnect();
    process.exit(1);
  }

  // 2. counts + non-sensitive configs + manifest
  const counts = {};
  for (const m of ["sealRecord", "sealLeaf", "anchorTx", "evidenceReceipt", "energyPlan", "economySnapshot", "researchFinding", "opLog", "auditEvent", "pendingSignature"]) {
    counts[m] = await main[m].count();
  }

  const configFiles = ["package.json", "prisma/schema.prisma", ".env.example"];
  for (const f of configFiles) {
    if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(dir, path.basename(f)));
  }

  let gitCommit = "unknown";
  try { gitCommit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { /* not a git checkout */ }

  const files = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    files.push({ name: f, sha256: await sha256File(full), bytes: fs.statSync(full).size });
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    kind: "saos-backup-v1",
    gitCommit,
    versions: { node: process.version, prisma: "6.x", platform: `${process.platform}-${process.arch}` },
    counts,
    files,
    exclusions: [".env (secrets)", "upload/ (tokens)", "research/ (66MB dumps)", "node_modules/", "keys — by design there are none in the system"]
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // 3. verify the snapshot: integrity + counts must match the live DB
  const snap = new PrismaClient({ datasources: { db: { url: `file:${snapPath}` } } });
  let verified = false;
  let integrity = "unknown";
  let countsMatch = false;
  let chainProof = { ok: false, receipts: 0, digestErrors: 0, linkErrors: 0, sealsChecked: 0, sealErrors: 0 };
  try {
    const ic = await snap.$queryRawUnsafe("PRAGMA integrity_check");
    integrity = Array.isArray(ic) && ic[0]?.integrity_check ? ic[0].integrity_check : String(ic);
    countsMatch = true;
    for (const m of Object.keys(counts)) {
      const c = await snap[m].count();
      if (c !== counts[m]) { countsMatch = false; console.error(`  count mismatch ${m}: live=${counts[m]} snapshot=${c}`); }
    }

    // 3b. roast 53 — verify the EVIDENCE CHAIN inside the snapshot itself.
    // "counts match" proves the copy is faithful to the live DB; it does NOT
    // prove the backed-up chain is intact. A backup whose receipt chain is
    // broken (or whose top seal's leaves no longer rebuild the anchored
    // root) must never wear the "verified" stamp. Same discipline as
    // /api/saos/verify-chain, executed against the snapshot.
    const { verifyChainDag } = await import("../src/lib/saos/evidence");
    const { buildMerkleTree } = await import("../src/lib/saos/merkle");
    const snapReceipts = await snap.evidenceReceipt.findMany({ orderBy: { createdAt: "asc" } });
    const dag = await verifyChainDag(
      snapReceipts.map((r) => ({
        kind: r.kind,
        at: (r.at ?? r.createdAt).toISOString(),
        payload: JSON.parse(r.payload),
        prevDigest: r.prevDigest,
        digest: r.digest
      }))
    );
    chainProof.receipts = snapReceipts.length;
    chainProof.digestErrors = dag.digestErrors.length;
    chainProof.linkErrors = dag.linkErrors.length;

    const snapSeals = await snap.sealRecord.findMany({ orderBy: { height: "desc" }, include: { leaves: true } });
    chainProof.sealsChecked = snapSeals.length;
    for (const seal of snapSeals) {
      const leaves = [...seal.leaves].sort((a, b) => a.index - b.index).map((l) => l.digest);
      const dup = leaves.length - new Set(leaves).size;
      const tree = await buildMerkleTree(leaves);
      if (leaves.length !== seal.leavesCount || dup > 0 || tree.root !== seal.root) {
        chainProof.sealErrors += 1;
        console.error(`  seal height=${seal.height}: chain-proof failed in snapshot`);
      }
    }
    chainProof.ok = dag.digestErrors.length === 0 && dag.linkErrors.length === 0 && chainProof.sealErrors === 0 && snapSeals.length > 0;

    verified = integrity === "ok" && countsMatch && chainProof.ok;
  } catch (e) {
    integrity = `error: ${e.message}`;
  }
  await snap.$disconnect();

  // 4. OpLog record — the live-gate backup check reads this
  await main.opLog.create({
    data: {
      op: "backup",
      detail: `backup-${stamp} verified=${verified} integrity=${integrity} chain=${chainProof.ok ? "ok" : "BROKEN"} seals=${counts.sealRecord} receipts=${counts.evidenceReceipt}`
    }
  });
  await main.$disconnect();

  // 5. retention — keep newest KEEP_BACKUPS
  const dirs = fs.readdirSync(BACKUPS_DIR).filter((d) => d.startsWith("backup-")).sort().reverse();
  const removed = [];
  for (const d of dirs.slice(KEEP_BACKUPS)) {
    fs.rmSync(path.join(BACKUPS_DIR, d), { recursive: true, force: true });
    removed.push(d);
  }

  console.log(`\nbackup → ${dir}`);
  console.log(`   snapshot: db.sqlite3 (${(fs.statSync(snapPath).size / 1024).toFixed(1)} KB)`);
  console.log(`   integrity: ${integrity} · counts-match: ${countsMatch ? "yes" : "NO"}`);
  console.log(`   chain-proof: ${chainProof.ok ? "ok" : "BROKEN"} — receipts=${chainProof.receipts} digestErrors=${chainProof.digestErrors} linkErrors=${chainProof.linkErrors} seals=${chainProof.sealsChecked} sealErrors=${chainProof.sealErrors}`);
  console.log(`   counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`   git: ${gitCommit.slice(0, 12)}`);
  if (removed.length) console.log(`   retention: removed ${removed.join(", ")}`);
  console.log(verified ? "\n✅ backup verified" : "\n❌ backup FAILED verification — do not trust it");
  process.exit(verified ? 0 : 1);
}

main().catch((e) => { console.error("backup crashed:", e.message); process.exit(1); });
