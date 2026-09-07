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
 * A restore that fails verification NEVER touches any database.
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
    return { ok: countsMatch, reason: countsMatch ? "verified" : "counts mismatch", manifest, actual };
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
  if (v.manifest) {
    console.log(`   backup of commit: ${v.manifest.gitCommit?.slice(0, 12)} @ ${v.manifest.createdAt}`);
    console.log(`   counts: ${Object.entries(v.actual ?? v.manifest.counts).map(([k, x]) => `${k}=${x}`).join(" ")}`);
  }

  if (!v.ok) { console.error("\n❌ restore aborted — verification failed; nothing was touched"); process.exit(1); }

  const snapPath = path.join(abs, "db.sqlite3");
  const liveDb = path.join(ROOT, "db", "custom.db");

  if (target) {
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.copyFileSync(snapPath, path.resolve(target));
    console.log(`\n✅ drill complete — snapshot copied to ${path.resolve(target)} (live db untouched)`);
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
