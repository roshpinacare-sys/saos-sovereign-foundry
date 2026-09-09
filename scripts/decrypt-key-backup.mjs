#!/usr/bin/env node
/**
 * Decrypt a SAOS-KEY-BACKUP-1 file produced by external-signer /keys/backup.
 *
 * Usage:
 *   node scripts/decrypt-key-backup.mjs <backup-file.enc> [--out recovered-keys.json] [--pass-env VAR]
 *
 * - The passphrase is never printed; prefer --pass-env so it never lands in shell history.
 * - The decrypted keys are written to --out (default ./recovered-keys.json) with 0600.
 * - Works offline: scrypt(N=16384,r=8,p=1) + AES-256-GCM, standard node crypto only.
 */
import { readFileSync, writeFileSync, chmodSync } from "fs";
import { scryptSync, createDecipheriv } from "crypto";
import { createInterface } from "readline";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/decrypt-key-backup.mjs <backup-file.enc> [--out recovered-keys.json] [--pass-env VAR]");
  process.exit(1);
}
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const outPath = argOf("--out", "recovered-keys.json");
const passEnv = argOf("--pass-env", null);

const env = JSON.parse(readFileSync(file, "utf8"));
if (env?.cipher !== "aes-256-gcm" || env?.kdf !== "scrypt" || env?.v !== 1) {
  console.error("unknown backup format (expected SAOS-KEY-BACKUP-1 v1)");
  process.exit(1);
}

let passphrase = passEnv ? process.env[passEnv] : null;
if (!passphrase) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  passphrase = await new Promise((res) => rl.question("backup passphrase: ", res));
  rl.close();
  console.error("(tip: use --pass-env VAR to avoid echoing the passphrase)");
}

try {
  const key = scryptSync(passphrase, Buffer.from(env.salt, "base64"), 32);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  const plain = Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()]).toString("utf8");
  JSON.parse(plain); // integrity: throws on wrong passphrase / corruption
  writeFileSync(outPath, plain);
  chmodSync(outPath, 0o600);
  console.log(`decrypted OK -> ${outPath} (mode 0600; keep it off shared machines, delete when done)`);
} catch {
  console.error("FAILED: wrong passphrase or corrupted file (GCM auth rejected)");
  process.exit(1);
}
