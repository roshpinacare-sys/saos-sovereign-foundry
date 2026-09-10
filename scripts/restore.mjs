#!/usr/bin/env bun
/**
 * restore — verified restore with a safe default (Task 5, mission 5).
 *
 *   bun scripts/restore.mjs <backupDir>              # DRY-RUN: verify only, touches nothing
 *   bun scripts/restore.mjs <backupDir> --target X   # drill: restore INTO X (never the live db)
 *   bun scripts/restore.mjs <backupDir> --yes        # REAL restore over db/custom.db
 *                                                    #   (previous db is renamed .pre-restore-<ts>)
 *
 * Verification (always, in every mode):
 *   1. manifest.json exists and parses
 *   2. every file's sha256 matches the manifest
 *   3. PRAGMA integrity_check on the snapshot
 *   4. row counts match the manifest
 *   4b. (roast 59) EVIDENCE-CHAIN PROOF inside the snapshot itself —
 *       verifyChainDag over every receipt + merkle-root rebuild for every
 *       seal, the same discipline as backup.mjs (roast 53) and
 *       /api/saos/verify-chain. sha256+integrity+counts prove the COPY is
 *       faithful — not that the chain inside it is TRUE (LIVE-caught this
 *       round: a snapshot with a tampered receipt + re-signed manifest
 *       passed as "✅ pass" and would have resurrected a broken chain).
 * A restore that fails verification NEVER touches any database — in ANY
 * mode, including --yes.
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });

async function verifyBackup(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return { ok: false, reason: "manifest.json missing" };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const snapPath = path.join(dir, "db.sqlite3");
  if (!fs.existsSync(snapPath)) return { ok: false, reason: "db.sqlite3 missing" };

  for (const f of manifest.files ?? []) {
    const full = path.join(dir, f.name);
    if (!fs.existsSync(full)) return { ok: false, reason: `file missing: ${f.name}` };
    const digest = await sha256File(full);
    if (digest !== f.sha256) return { ok: false, reason: `sha256 mismatch: ${f.name}` };
  }

  const probe = new PrismaClient({ datasources: { db: { url: `file:${snapPath}` } } });
  try {
    const ic = await probe.$queryRawUnsafe("PRAGMA integrity_check");
    const integrity = Array.isArray(ic) && ic[0]?.integrity_check ? ic[0].integrity_check : String(ic);
    if (integrity !== "ok") return { ok: false, reason: `integrity=${integrity}`, manifest };

    let countsMatch = true;
    const actual = {};
    for (const [m, expected] of Object.entries(manifest.counts ?? {})) {
      const c = await probe[m].count();
      actual[m] = c;
      if (c !== expected) { countsMatch = false; console.error(`  count mismatch ${m}: manifest=${expected} snapshot=${c}`); }
    }

    // 4b. roast 59 — chain-proof INSIDE the snapshot (mirror of backup.mjs
    // step-3b). Counts match the manifest even when a receipt row was
    // tampered AFTER the fact; integrity_check validates file structure, not
    // chain truth. Live-caught: forked-chain snapshot passed as "✅ pass".
    const chainProof = { ok: false, receipts: 0, digestErrors: 0, linkErrors: 0, sealsChecked: 0, sealErrors: 0 };
    const { verifyChainDag } = await import("../src/lib/saos/evidence");
    const { buildMerkleTree } = await import("../src/lib/saos/merkle");
    const snapReceipts = await probe.evidenceReceipt.findMany({ orderBy: { createdAt: "asc" } });
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

    const snapSeals = await probe.sealRecord.findMany({ orderBy: { height: "desc" }, include: { leaves: true } });
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
    chainProof.ok =
      dag.digestErrors.length === 0 && dag.linkErrors.length === 0 && chainProof.sealErrors === 0 && snapSeals.length > 0;
    if (!chainProof.ok) {
      console.error(`  chain-proof: BROKEN — receipts=${chainProof.receipts} digestErrors=${chainProof.digestErrors} linkErrors=${chainProof.linkErrors} seals=${chainProof.sealsChecked} sealErrors=${chainProof.sealErrors}`);
    }

    const ok = countsMatch && chainProof.ok;
    return { ok, reason: !countsMatch ? "counts mismatch" : !chainProof.ok ? "chain=BROKEN" : "verified", manifest, actual, chainProof };
  } finally {
    await probe.$disconnect();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const yes = args.includes("--yes");
  const targetIdx = args.indexOf("--target");
  const target = targetIdx >= 0 ? args[targetIdx + 1] : null;

  if (!dir) {
    console.error("usage: bun scripts/restore.mjs <backupDir> [--target X] [--yes]");
    console.error("       default is DRY-RUN — verifies and touches nothing");
    process.exit(2);
  }
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) { console.error(`❌ backup dir not found: ${abs}`); process.exit(1); }

  console.log(`restore ${yes ? "--yes (REAL)" : "(dry-run)"} → ${abs}`);
  const v = await verifyBackup(abs);
  console.log(`   verification: ${v.ok ? "✅ pass" : `❌ ${v.reason}`}`);
  if (v.chainProof) {
    console.log(`   chain-proof: ${v.chainProof.ok ? "ok" : "BROKEN"} — receipts=${v.chainProof.receipts} digestErrors=${v.chainProof.digestErrors} linkErrors=${v.chainProof.linkErrors} seals=${v.chainProof.sealsChecked} sealErrors=${v.chainProof.sealErrors}`);
  }
  if (v.manifest) {
    console.log(`   backup of commit: ${v.manifest.gitCommit?.slice(0, 12)} @ ${v.manifest.createdAt}`);
    console.log(`   counts: ${Object.entries(v.actual ?? v.manifest.counts).map(([k, x]) => `${k}=${x}`).join(" ")}`);
  }

  if (!v.ok) { console.error("\n❌ restore aborted — verification failed (including chain-proof); nothing was touched"); process.exit(1); }

  const snapPath = path.join(abs, "db.sqlite3");
  const liveDb = path.join(ROOT, "db", "custom.db");

  if (target) {
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    // roast 59: the drill path is ALSO chain-proof gated — a drill that copies
    // a broken chain trains the operator on a lie
    fs.copyFileSync(snapPath, path.resolve(target));
    console.log(`\n✅ drill complete — snapshot copied to ${path.resolve(target)} (live db untouched, chain-proof verified)`);
    process.exit(0);
  }

  if (!yes) {
    console.log("\n(dry-run) verified — nothing restored. add --yes to restore over db/custom.db");
    process.exit(0);
  }

  if (fs.existsSync(liveDb)) {
    const keep = `${liveDb}.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    fs.renameSync(liveDb, keep);
    console.log(`   previous db kept as ${path.basename(keep)}`);
  }
  fs.copyFileSync(snapPath, liveDb);
  console.log("\n✅ restore complete — RESTART the dev server (bun run dev) and run bun run check");
}

main().catch((e) => { console.error("restore crashed:", e.message); process.exit(1); });
