#!/usr/bin/env node
/*
 * fleet_vault.cjs — SAOS-FLEET-VAULT-1 open/seal helper (Task 37 regeneration).
 *
 * Contract (must match mini-services/external-signer openSeal()/seal):
 *   fleet_keys.enc      = MAGIC + hex( salt[16] | iv[12] | tag[16] | ct )  (hex wrapped at 64 cols)
 *   fleet_keys.meta.json = { pass, sealedAt, generator?, format } — pass lives in meta (dir is 0700)
 *   key                  = scrypt(pass, salt, 32); AES-256-GCM
 *   plaintext bundle     = { files: { ".env": string, "keys/vault.json": string }, sealedAt }
 *
 * CLI:
 *   fleet_vault.cjs --open   → decrypts .enc, materializes .env + keys/vault.json (0600)
 *   fleet_vault.cjs --seal   → re-encrypts .env + keys/vault.json into .enc (same pass, new salt/iv)
 *
 * This file contains NO secret material — it is a tool, safe to keep in the repo.
 * The secrets live only inside the encrypted envelope and the 0700 directory.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAGIC = "SAOS-FLEET-VAULT-1";
const dir = __dirname;
const encP = path.join(dir, "fleet_keys.enc");
const metaP = path.join(dir, "fleet_keys.meta.json");

function openBundle() {
  const raw = fs.readFileSync(encP, "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");
  const meta = JSON.parse(fs.readFileSync(metaP, "utf8"));
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = crypto.scryptSync(meta.pass, salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}

function sealBundle(bundle) {
  const meta = JSON.parse(fs.readFileSync(metaP, "utf8"));
  if (!meta || typeof meta.pass !== "string" || !meta.pass.length) throw new Error("meta.pass missing — cannot seal");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(meta.pass, salt, 32);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(bundle), "utf8"), c.final()]);
  const payload = Buffer.concat([salt, iv, c.getAuthTag(), ct]);
  const encText = MAGIC + payload.toString("hex").replace(/(.{64})/g, "$1\n");
  const newMeta = { ...meta, sealedAt: bundle.sealedAt, generator: "fleet_vault.cjs (task37 regeneration)" };
  fs.writeFileSync(encP, encText, { mode: 0o600 });
  fs.writeFileSync(metaP, JSON.stringify(newMeta, null, 1), { mode: 0o600 });
  fs.chmodSync(encP, 0o600);
  fs.chmodSync(metaP, 0o600);
}

const arg = process.argv[2];
if (arg === "--open") {
  const bundle = openBundle();
  fs.mkdirSync(path.join(dir, "keys"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".env"), bundle.files[".env"] ?? "", { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "keys", "vault.json"), bundle.files["keys/vault.json"] ?? "{}", { mode: 0o600 });
  fs.chmodSync(path.join(dir, ".env"), 0o600);
  fs.chmodSync(path.join(dir, "keys", "vault.json"), 0o600);
  console.log("OPENED sealedAt=" + (bundle.sealedAt ?? "?"));
  process.exit(0);
}
if (arg === "--seal") {
  const envText = fs.readFileSync(path.join(dir, ".env"), "utf8");
  const vaultPath = path.join(dir, "keys", "vault.json");
  const vaultText = fs.readFileSync(vaultPath, "utf8");
  JSON.parse(vaultText); // fail-closed on corrupt vault json
  const bundle = { files: { ".env": envText, "keys/vault.json": vaultText }, sealedAt: new Date().toISOString() };
  sealBundle(bundle);
  console.log("SEALED sealedAt=" + bundle.sealedAt);
  process.exit(0);
}
console.error("usage: fleet_vault.cjs --open|--seal");
process.exit(2);
