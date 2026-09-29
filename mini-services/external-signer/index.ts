/**
 * external-signer (:3033) — Task 26 (STEEM weave) + Task 27 (HIVE conversion rail).
 * =============================================================================
 * The golden architecture (docs/external-signer.md): the foundry SYSTEM never
 * holds keys — the signer is a SEPARATE process, outside the system boundary.
 * This service:
 *   - opens the sealed fleet envelope (SAOS-FLEET-VAULT-1, AES-256-GCM/scrypt)
 *     in memory at boot; keys NEVER leave this process, never logged, never
 *     served by any endpoint;
 *   - GET  /health (Bearer) → public inventory only: account NAMES, networks,
 *     authority-verification counts — what the foundry needs for status;
 *   - POST /sign    (Bearer) → signs the foundry's prepared payload and
 *     broadcasts it, returning ONLY the public {txid}. Keys never cross.
 *
 * Task 27 additions (owner directive: "use the DEX to convert, obtain HIVE"):
 *   - network "HIVE" (chain_id beeab0de…, node api.hive.blog);
 *   - ACTIVE-level ops with a mandatory AUTHORITY-VERIFICATION GATE: every WIF
 *     is derived to its public key and checked against the LIVE chain authority
 *     BEFORE any broadcast — mismatch ⇒ 403, nothing is sent (the Task-26
 *     "Missing Posting Authority" class of failure is now caught pre-flight);
 *   - allowlisted ops only: transfer_to_vesting (power-up), transfer,
 *     claim_rewards, HE market-sell / hivepegged-withdraw (custom_json on
 *     id ssc-mainnet-hive, active authority), posting custom_json (weave);
 *
 * Task 29 additions (owner directive 2026-09-09: "אין לי איפה לחבר את המפתח"):
 *   - POST /keys/ingest (Bearer) — the OWNER pastes their STEEM/HIVE active
 *     key INTO THE CONTROL SCREEN (never through chat/logs); the signer is the
 *     single verifier: derives the pubkey, checks it against the LIVE chain
 *     authority of the fleet accounts, and accepts ONLY a live match (a wrong
 *     or foreign key can never be written — self-protecting by construction);
 *   - accepted keys land in the runtime layout (.env suffixed vars +
 *     keys/vault.json), the envelope is re-sealed (fleet_vault --seal) and
 *     STATE hot-reloads — no process restart, no secret ever echoed/logged;
 *   - GET /keys/status (Bearer) — public data only: loaded booleans, derived
 *     pubkeys (on-chain public), live-match verdicts. Never any WIF;
 *   - network-aware main keys: STEEM_ACTIVE_WIF / HIVE_ACTIVE_WIF (suffixed)
 *     are preferred over the legacy generic ACTIVE_WIF — two chains, usually
 *     two different keys (the Task-27 403 root cause, fixed at the source).
 *   - hard amount bound (default ≤ 50 HIVE/op, env SIGNER_MAX_OP_HIVE).
 *
 * Task 26-c addition (fleet RC cure): delegate_vesting_shares — fleet accounts
 * delegate owned VESTS to the main account (headcorner) to raise its max_rc and
 * RC-regeneration rate. Hard bounds: delegatee MUST be the main account; amount
 * ≤ 80% of the delegator's OWNED vests (vesting_shares − delegated_vesting_shares);
 * authority + RC gates apply like every active op. Reversible by design.
 *
 * Iron rules mirrored from AGENTS.md: zero secret values in logs/responses;
 * fail-closed when the envelope or token is missing; loud audit lines with
 * public data only (requestId/network/txid/account-name).
 *
 * Owner authority: keys-access directive 2026-09-08 + "convert and obtain HIVE"
 * (2026-09-08). DEV-phase environment, private repos, owned accounts only.
 */

import Bun from "bun";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, appendFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import path from "path";

const PORT = Number(process.env.SIGNER_PORT ?? 3033);
const MAGIC = "SAOS-FLEET-VAULT-1";
const LOG = path.join(import.meta.dir, "signer.log");
const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000";
const HIVE_RPC = process.env.HIVE_RPC ?? "https://api.hive.blog";
const STEEM_RPC = process.env.STEEM_RPC ?? "https://api.steemit.com";
// Task 36: BLURT joins as a first-class network — chain_id captured LIVE
// 2026-09-09 (database_api.get_version @ rpc.beblurt.com, blockchain_version 0.9.0);
// custom_json scope only (asset ops stay STEEM/HIVE — the steem@0.7.10 asset
// serializer garbage-bug class applies to the BLURT symbol too).
const BLURT_CHAIN_ID = "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";
const BLURT_RPC = process.env.BLURT_RPC ?? "https://rpc.beblurt.com";
// Task 39: order rotated live-first (2026-09-09 probes: beblurt + saboin alive,
// rpc.blurt.world / btsd.io / coruscant.io dead — kept as last-resort fallbacks)
const BLURT_NODES = [BLURT_RPC, "https://blurt-rpc.saboin.com", "https://rpc.blurt.world"].filter((v, i, a) => a.indexOf(v) === i);
const NET_PREFIX = { STEEM: "STM", HIVE: "STM", BLURT: "BLT" };
const MAX_OP_HIVE = Number(process.env.SIGNER_MAX_OP_HIVE ?? 50);
// roast 72: ONE version truth. Before this, four surfaces lied differently
// (/health 2.5.2-task38 · /keys/steem-plane + /keys/status 2.4.5 ·
// backup-export 2.4.1 · startup log 2.5.4-roast64) — Task-71's bump was
// partial. Every surface now serves this single constant.
const SIGNER_VERSION = "2.5.7";
const AUTH_CACHE_TTL_MS = 10 * 60_000;
/** token resolution: env → ~/.secrets/external-signer-token (secrets never in trees) */
function resolveToken() {
  const env = (process.env.SIGNER_TOKEN ?? "").trim();
  if (env) return env;
  try {
    return readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "external-signer-token"), "utf8").trim();
  } catch {
    return "";
  }
}
const TOKEN = resolveToken();

// ── roast 54: /sign idempotency ledger ───────────────────────────────────────
// requestId → { at, pending | null, status, response }. pending = a promise
// the FIRST execution resolves when its response is cached; concurrent
// duplicates await it instead of broadcasting a second signed tx.
type SignCacheEntry = {
  at: number;
  pending: Promise<void> | null;
  status: number;
  response: Record<string, unknown>;
};
const signCache = new Map<string, SignCacheEntry>();
const SIGN_CACHE_TTL_MS = 60 * 60_000; // 1h — long past any transport-retry window
const SIGN_CACHE_CAP = 500;

function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${String(msg)}`;
  try { appendFileSync(LOG, line + "\n"); } catch {}
  console.log(line);
}

function tokenOk(req) {
  if (!TOKEN) return false;
  const authz = req.headers.get("authorization") ?? "";
  if (!authz.toLowerCase().startsWith("bearer ")) return false;
  const a = createHash("sha256").update(authz.slice(7).trim()).digest();
  const b = createHash("sha256").update(TOKEN).digest();
  return timingSafeEqual(a, b);
}

// ── envelope resolution: env dir → steem clone → newest guardian backup ──────
function resolveEnvelopeDir() {
  const candidates = [];
  if (process.env.FLEET_KEYS_DIR) candidates.push(process.env.FLEET_KEYS_DIR);
  // roast 61: the deliberate local envelope home was never in the search list —
  // after the /tmp clone is wiped and before any guardian backup exists, the
  // sealed envelope sitting at ~/.secrets/fleet-envelope was invisible and the
  // signer booted fail-closed with "seal-unavailable" while the envelope
  // existed on disk (caught live this round).
  candidates.push(path.join(process.env.HOME ?? "/home/z", ".secrets", "fleet-envelope"));
  candidates.push("/tmp/agent-audit/steem/agent");
  const rec = path.join(process.env.HOME ?? "/home/z", ".secrets", "vault-recovery");
  try {
    const dirs = readdirSync(rec)
      .filter((d) => d.startsWith("guardian-"))
      .sort()
      .reverse();
    for (const d of dirs) candidates.push(path.join(rec, d));
  } catch {}
  for (const dir of candidates) {
    if (existsEnc(dir)) return dir;
  }
  return null;
}
function existsEnc(dir) {
  const enc = existsSync(path.join(dir, "fleet_keys.enc"))
    ? "fleet_keys.enc"
    : existsSync(path.join(dir, "agent__fleet_keys.enc"))
      ? "agent__fleet_keys.enc"
      : null;
  if (!enc) return false;
  const meta = enc === "fleet_keys.enc" ? "fleet_keys.meta.json" : "agent__fleet_keys.meta.json";
  return existsSync(path.join(dir, meta));
}
function encNames(dir) {
  const enc = existsSync(path.join(dir, "fleet_keys.enc")) ? "fleet_keys.enc" : "agent__fleet_keys.enc";
  const meta = enc === "fleet_keys.enc" ? "fleet_keys.meta.json" : "agent__fleet_keys.meta.json";
  return { enc, meta };
}

function openSeal(dir) {
  const { enc, meta } = encNames(dir);
  const raw = readFileSync(path.join(dir, enc), "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");
  // P0 (2026-09-29, audit מ-2): the pass must not live beside the ciphertext.
  // Precedence — ~/.secrets/fleet-vault-pass (external) → legacy meta.pass.
  // Matches the platform vault-seal.ts change; after scripts/reseal-no-meta.ts
  // runs on the platform home, legacy metas hold {externalPass:true} only.
  let pass = null;
  try {
    const ext = readFileSync(path.join(process.env.HOME ?? "/home/z", ".secrets", "fleet-vault-pass"), "utf8").trim();
    if (ext) pass = ext;
  } catch {}
  const metaJson = JSON.parse(readFileSync(path.join(dir, meta), "utf8"));
  if (!pass && metaJson.pass) pass = metaJson.pass;
  if (!pass) throw new Error("no vault pass: neither external secret nor seal meta");
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);
  const key = scryptSync(pass, salt, 32);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}

// ── in-memory key material (NEVER leaves this process) ───────────────────────
let STATE = null; // { sealedAt, main: {account, postingWif, activeWif, memoWif}, fleet: [{username, postingWif, activeWif}], vaultAccounts: string[] }

function loadState() {
  const dir = resolveEnvelopeDir();
  if (!dir) {
    log("ERROR", "no fleet envelope found (fail-closed: /health stays disconnected)");
    return;
  }
  try {
    const bundle = openSeal(dir);
    const envLines = (bundle.files[".env"] ?? "").split(/\r?\n/);
    const envOf = Object.fromEntries(envLines.filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
    const account = envOf.AGENT_ACCOUNT ?? "";
    if (!account || !envOf.POSTING_WIF) {
      log("ERROR", `envelope at ${dir} lacks AGENT_ACCOUNT/POSTING_WIF — fail-closed`);
      return;
    }
    let fleet = [];
    try {
      const vault = JSON.parse(bundle.files["keys/vault.json"]);
      // Task 59: net-tagged keys count too — an account holding ONLY wifBLURT
      // (e.g. a BLURT-plane ingest) is usable for BLURT and must not vanish.
      // The MAIN account is excluded even if it has a vault.json entry (its
      // slots live in .env; counting it as fleet would double every drift check).
      fleet = (vault.accounts ?? [])
        .filter((a) => a?.username && a.username !== account && (a?.keys?.posting?.wif || a?.keys?.active?.wif ||
          ["wifSTEEM", "wifHIVE", "wifBLURT"].some((t) => a?.keys?.posting?.[t] || a?.keys?.active?.[t])))
        .map((a) => ({
          username: a.username,
          postingWif: a.keys?.posting?.wif ?? null,
          activeWif: a.keys?.active?.wif ?? null,
          ownerWif: a.keys?.owner?.wif ?? null,
          net: {
            STEEM: { postingWif: a.keys?.posting?.wifSTEEM ?? null, activeWif: a.keys?.active?.wifSTEEM ?? null, ownerWif: a.keys?.owner?.wifSTEEM ?? null, memoWif: a.keys?.memo?.wifSTEEM ?? null },
            HIVE: { postingWif: a.keys?.posting?.wifHIVE ?? null, activeWif: a.keys?.active?.wifHIVE ?? null, ownerWif: a.keys?.owner?.wifHIVE ?? null, memoWif: a.keys?.memo?.wifHIVE ?? null },
            BLURT: { postingWif: a.keys?.posting?.wifBLURT ?? null, activeWif: a.keys?.active?.wifBLURT ?? null, ownerWif: a.keys?.owner?.wifBLURT ?? null, memoWif: a.keys?.memo?.wifBLURT ?? null }
          }
        }));
    } catch {}
    // v2.4.3: remember EVERY vault account name — including empty skeletons
    // (the 9 fleet accounts from the Task-36 build). Ingest candidates must
    // include them: owner key material for a fleet account arrives as a WIF
    // and the chain decides — but only if the account NAME is a candidate.
    // Skeleton names are public blockchain accounts; no secret material here.
    let vaultAccounts: string[] = [];
    try {
      const vaultRaw = JSON.parse(bundle.files["keys/vault.json"]);
      vaultAccounts = (vaultRaw.accounts ?? []).map((a: { username?: string }) => a?.username).filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
    } catch {}
    STATE = {
      sealedAt: bundle.sealedAt ?? null,
      main: {
        account,
        postingWif: envOf.POSTING_WIF,
        activeWif: envOf.ACTIVE_WIF ?? null,
        memoWif: envOf.MEMO_WIF ?? null,
        ownerWif: envOf.OWNER_WIF ?? null,
        net: {
          STEEM: { postingWif: envOf.STEEM_POSTING_WIF ?? null, activeWif: envOf.STEEM_ACTIVE_WIF ?? null, ownerWif: envOf.STEEM_OWNER_WIF ?? null, memoWif: envOf.STEEM_MEMO_WIF ?? null },
          HIVE: { postingWif: envOf.HIVE_POSTING_WIF ?? null, activeWif: envOf.HIVE_ACTIVE_WIF ?? null, ownerWif: envOf.HIVE_OWNER_WIF ?? null, memoWif: envOf.HIVE_MEMO_WIF ?? null },
          BLURT: { postingWif: envOf.BLURT_POSTING_WIF ?? null, activeWif: envOf.BLURT_ACTIVE_WIF ?? null, ownerWif: envOf.BLURT_OWNER_WIF ?? null, memoWif: envOf.BLURT_MEMO_WIF ?? null }
        }
      },
      fleet,
      vaultAccounts
    };
    log("INFO", `envelope open: sealedAt=${STATE.sealedAt ?? "?"} main=${account} fleet=${fleet.length} accounts, ${vaultAccounts.length} vault account names (values in-memory only, dir=${dir})`);
  } catch (e) {
    log("ERROR", `envelope open failed: ${String(e?.message ?? e).slice(0, 120)} — fail-closed`);
    STATE = null;
  }
}

// ── Task 29: owner key ingestion (verify-then-write, self-protecting) ────────
// Task 37: the vault helper is EMBEDDED — any envelope dir (runtime or a
// recovery copy restored by resolveEnvelopeDir) always knows how to open/seal
// itself, even after a sandbox rollback wiped the helper (the exact failure
// that blocked ingest on 2026-09-09: "fleet_vault.cjs missing").
// Source of truth for the template: scripts/fleet-vault-template.cjs (repo).
const FLEET_VAULT_SCRIPT = String.raw`#!/usr/bin/env node
/* fleet_vault.cjs - SAOS-FLEET-VAULT-1 open/seal helper (embedded template, Task 37).
 * fleet_keys.enc = MAGIC + hex(salt|iv|tag|ct); key=scrypt(meta.pass,salt,32); AES-256-GCM.
 * bundle = { files: { ".env", "keys/vault.json" }, sealedAt }. Contains NO secret material. */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const MAGIC = "SAOS-FLEET-VAULT-1";
const dir = __dirname;
const encP = path.join(dir, "fleet_keys.enc"), metaP = path.join(dir, "fleet_keys.meta.json");
function openBundle() {
  const raw = fs.readFileSync(encP, "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");
  const meta = JSON.parse(fs.readFileSync(metaP, "utf8"));
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
  d.setAuthTag(payload.subarray(28, 44));
  return JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8"));
}
function sealBundle(bundle) {
  const meta = JSON.parse(fs.readFileSync(metaP, "utf8"));
  if (!meta || typeof meta.pass !== "string" || !meta.pass.length) throw new Error("meta.pass missing");
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(meta.pass, salt, 32);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(bundle), "utf8"), c.final()]);
  const encText = MAGIC + Buffer.concat([salt, iv, c.getAuthTag(), ct]).toString("hex").replace(/(.{64})/g, "$1\n");
  fs.writeFileSync(encP, encText, { mode: 0o600 });
  fs.writeFileSync(metaP, JSON.stringify({ ...meta, sealedAt: bundle.sealedAt, generator: "fleet_vault.cjs (embedded template)" }, null, 1), { mode: 0o600 });
}
const arg = process.argv[2];
if (arg === "--open") {
  const bundle = openBundle();
  fs.mkdirSync(path.join(dir, "keys"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".env"), bundle.files[".env"] ?? "", { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "keys", "vault.json"), bundle.files["keys/vault.json"] ?? "{}", { mode: 0o600 });
  console.log("OPENED sealedAt=" + (bundle.sealedAt ?? "?"));
  process.exit(0);
}
if (arg === "--seal") {
  const envText = fs.readFileSync(path.join(dir, ".env"), "utf8");
  const vaultText = fs.readFileSync(path.join(dir, "keys", "vault.json"), "utf8");
  JSON.parse(vaultText);
  const bundle = { files: { ".env": envText, "keys/vault.json": vaultText }, sealedAt: new Date().toISOString() };
  sealBundle(bundle);
  console.log("SEALED sealedAt=" + bundle.sealedAt);
  process.exit(0);
}
console.error("usage: fleet_vault.cjs --open|--seal");
process.exit(2);
`;

function ensureVaultScript(dir: string): void {
  try {
    const p = path.join(dir, "fleet_vault.cjs");
    if (!existsSync(p)) {
      writeFileSync(p, FLEET_VAULT_SCRIPT, { mode: 0o600 });
      log("INFO", `fleet_vault.cjs materialized from embedded template in ${dir} (self-heal)`);
    }
  } catch (e) {
    log("ERROR", `ensureVaultScript failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

function runVault(dir, arg) {
  ensureVaultScript(dir);
  const script = path.join(dir, "fleet_vault.cjs");
  if (!existsSync(script)) return { ok: false, out: `fleet_vault.cjs missing in ${dir}` };
  try {
    const p = Bun.spawnSync([process.execPath, script, arg], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const out = `${p.stdout?.toString() ?? ""}${p.stderr?.toString() ?? ""}`.trim().slice(0, 300);
    return { ok: p.exitCode === 0, out };
  } catch (e) {
    return { ok: false, out: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * Write the ingested key into the runtime layout, then re-seal the envelope.
 * Network-suffixed vars only (STEEM_ACTIVE_WIF / HIVE_ACTIVE_WIF) — the legacy
 * generic ACTIVE_WIF is left untouched (non-destructive toward the owner's
 * envelope content); key resolution prefers suffixed vars, so a stale generic
 * value can never shadow a live-matched key again.
 */
function writeIngestedKey(dir, account, network, wif, role) {
  const open = runVault(dir, "--open");
  if (!open.ok) throw new Error(`vault open failed: ${open.out}`);
  const envPath = path.join(dir, ".env");
  if (!existsSync(envPath)) throw new Error("runtime .env missing after vault open (fail-closed)");
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const setVar = (name, val) => {
    const i = lines.findIndex((l) => l.startsWith(name + "="));
    if (i >= 0) lines[i] = `${name}=${val}`; else lines.push(`${name}=${val}`);
  };
  // Task 59 (account-aware persist): the ${NET}_${ROLE}_WIF .env slots belong
  // to the MAIN account ONLY. Persisting a non-main account (tov/ynet/fleet)
  // through the old path OVERWROTE headcorner's live-verified slot with a
  // foreign key — a self-inflicted authority poison that the drift monitor
  // would then report as an external rotation. Non-main keys land in
  // keys/vault.json (per-account, net-tagged) and NEVER in main's .env.
  const envMainAccount = lines.find((l) => l.startsWith("AGENT_ACCOUNT="))?.slice("AGENT_ACCOUNT=".length).trim();
  const isMain = !envMainAccount || envMainAccount === account;
  // Task 41-recovery fix: BLURT must write its OWN suffixed slots — the old
  // ternary collapsed BLURT into "STEEM", so BLURT-derived WIFs corrupted the
  // STEEM_* slots (live authority gates then refused every STEEM broadcast).
  const netTag = network === "HIVE" ? "HIVE" : network === "BLURT" ? "BLURT" : "STEEM";
  if (isMain) {
    setVar(`${netTag}_${role.toUpperCase()}_WIF`, wif);
    writeFileSync(envPath, lines.join("\n") + "\n");
    chmodSync(envPath, 0o600);
  }
  const keysDir = path.join(dir, "keys");
  mkdirSync(keysDir, { recursive: true });
  const vPath = path.join(keysDir, "vault.json");
  let vault = { accounts: [] };
  try {
    const parsed = JSON.parse(readFileSync(vPath, "utf8"));
    if (parsed && Array.isArray(parsed.accounts)) vault = parsed;
  } catch {}
  let acc = vault.accounts.find((a) => a?.username === account);
  if (!acc) { acc = { username: account, keys: {} }; vault.accounts.push(acc); }
  if (!acc.keys || typeof acc.keys !== "object") acc.keys = {};
  if (!acc.keys[role] || typeof acc.keys[role] !== "object") acc.keys[role] = {};
  acc.keys[role][network === "HIVE" ? "wifHIVE" : network === "BLURT" ? "wifBLURT" : "wifSTEEM"] = wif;
  writeFileSync(vPath, JSON.stringify(vault, null, 2));
  chmodSync(vPath, 0o600);
  const seal = runVault(dir, "--seal");
  if (!seal.ok) throw new Error(`vault seal failed: ${seal.out}`);
  return { sealedAt: new Date().toISOString(), sealOut: seal.out };
}

/**
 * Owner-key ingest core (v2.4.0): verify against the LIVE chain authority of
 * the candidate accounts BEFORE anything is written. Checks ALL roles
 * (owner/active/posting/memo) × both networks when needed — the first live
 * match wins and the EXACT role+network are returned so the key lands in its
 * true slot (the role/network fields are only hints; the chain decides).
 * A key that matches no live authority is refused with honest verdicts.
 */
async function ingestOwnerKey(network: string | null, wif: string, roleHint?: string | null) {
  let derived: string | null = null;
  try {
    derived = steem.auth.wifToPublic(wif);
  } catch {
    return { ok: false, verdict: { network: network ?? null, role: roleHint ?? null, derived: null, match: false, error: "wif derivation failed (not a valid private key)" } };
  }
  const nets = network ? [network] : ["STEEM", "HIVE", "BLURT"];
  const candidates = ingestCandidates();
  const roles = roleHint && ["owner", "active", "posting", "memo"].includes(roleHint) ? [roleHint] : ["owner", "active", "posting", "memo"];
  const checked: Array<Record<string, unknown>> = [];
  for (const net of nets) {
    for (const acct of candidates) {
      let auth: Record<string, string | null> | null = null;
      try {
        auth = await chainAuthorities(net, acct);
      } catch (e) {
        checked.push({ account: acct, network: net, error: String(e?.message ?? e).slice(0, 100) });
        continue;
      }
      for (const role of roles) {
        // Task 36: prefix-aware compare (STM render vs BLT authorities — same payload)
        if (auth?.[role] && auth[role] === NET_PREFIX[net] + derived.slice(3)) {
          checked.push({ account: acct, network: net, role, match: true });
          return { ok: true, account: acct, network: net, role, derived, checked };
        }
      }
      checked.push({ account: acct, network: net, match: false });
    }
  }
  return { ok: false, verdict: { network: network ?? null, role: roleHint ?? null, derived, match: false, checked: checked.slice(0, 16), error: `no live authority match across ${nets.join("/")} × ${candidates.length} accounts × ${roles.join("/")} (nothing written)` } };
}

/**
 * v2.4.0 — UNIVERSAL key-payload parser ("חיבור חכם לכל מפתח"):
 * the owner can paste ANY of these formats and the signer figures it out:
 *   - a multi-line key file: "OWNER = 5K…", "ACTIVE: 5J…", section headers STEEM/HIVE
 *   - a single WIF (5…/K…/L…), a master password (P…), or a 64-hex SAOS-ROT1 seed
 * Returns entries for /keys/ingest (network/role are HINTS — the live-chain
 * verify step always has the final word, so a wrong hint can never poison a slot).
 */
function parseKeyPayload(text: string) {
  const roleMap: Record<string, string> = {
    OWNER: "owner", OWNERKEY: "owner",
    ACTIVE: "active", ACTIVEKEY: "active",
    POSTING: "posting", POSTINGKEY: "posting",
    MEMO: "memo", MEMOKEY: "memo"
  };
  const entries: Array<{ network: string | null; role: string | null; wif: string }> = [];
  let sectionNet: string | null = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const sec = line.match(/^(STEEM|HIVE|BLURT)\s*:?\s*$/i);
    if (sec) { sectionNet = sec[1].toUpperCase(); continue; }
    const kv = line.match(/^([A-Za-z][A-Za-z _-]{0,20}?)\s*[=:]\s*(\S+)\s*$/);
    if (kv) {
      let norm = kv[1].toUpperCase().replace(/[\s_-]+/g, "");
      let net = sectionNet;
      const netM = norm.match(/^(STEEM|HIVE|BLURT)(.+)$/);
      if (netM) { net = netM[1]; norm = netM[2]; }
      const role = roleMap[norm] ?? null;
      const wif = kv[2].trim();
      if (wif.length >= 40 && wif.length <= 120) entries.push({ network: net, role, wif });
      continue;
    }
    const spaced = line.match(/^([A-Za-z]{4,8})\s+([5-9KMP][1-9A-HJ-NP-Za-km-z]{48,})$/);
    if (spaced) {
      const role = roleMap[spaced[1].toUpperCase()] ?? null;
      entries.push({ network: sectionNet, role, wif: spaced[2] });
      continue;
    }
    const bare = line.replace(/\s+/g, "");
    const looksKey = /^[5-9KM][1-9A-HJ-NP-Za-km-z]{48,52}$/.test(bare) || /^[0-9a-fA-F]{64}$/.test(bare) || /^P[5-9KM][1-9A-HJ-NP-Za-km-z]{48,52}$/.test(bare);
    if (looksKey) entries.push({ network: sectionNet, role: null, wif: bare });
  }
  return entries.slice(0, 16);
}

/**
 * v2.4.3 — the FULL ingest candidate tree: main + loaded fleet + ynet/tov +
 * EVERY vault account name (including empty fleet skeletons). Before this, a
 * fleet WIF from the owner was refused because the skeleton names were dropped
 * by the keys-only fleet filter — the exact "owner sent everything and we said
 * no" class roast 59 was built to kill. Fail-closed unchanged: each candidate
 * is still verified against the LIVE chain authority before anything writes.
 */
function ingestCandidates(): string[] {
  return [STATE.main.account, ...STATE.fleet.map((f) => f.username), ...(STATE.vaultAccounts ?? []), "ynet", "tov"]
    .filter((v, i, a) => typeof v === "string" && v.length > 0 && a.indexOf(v) === i);
}

/**
 * Task 29-b: MASTER-PASSWORD ingest — the owner's P-prefixed login string
 * ("מקשר להכל"). Task 59 (owner directive 2026-09-10, full-custody 2026-09-09):
 * derives ALL FOUR roles (owner included — verify-then-write means only keys
 * that MATCH the live chain authority are ever persisted, and the ROT1 path
 * already persists owner matches) for EVERY candidate account — including the
 * "ynet"/"tov" candidates the WIF path already had (the owner's password file
 * carries a per-account password for tov; refusing to even try it was a gap).
 * Returns internal matches (with wif for the write path) + public verdicts.
 */
async function ingestOwnerPassword(password, networks) {
  if (typeof networks === "undefined" || networks === null) networks = ["STEEM", "HIVE", "BLURT"];
  const candidates = ingestCandidates();
  const matches = [], checked = [];
  for (const acct of candidates) {
    let keys;
    try {
      keys = steem.auth.getPrivateKeys(acct, password, ["owner", "active", "posting", "memo"]);
    } catch {
      checked.push({ account: acct, error: "password derivation failed" });
      continue;
    }
    for (const net of networks) {
      let auth;
      try {
        auth = await chainAuthorities(net, acct);
      } catch (e) {
        checked.push({ account: acct, network: net, error: String(e?.message ?? e).slice(0, 120) });
        continue;
      }
      let matchedThisNet = false;
      for (const role of ["owner", "active", "posting", "memo"]) {
        let derived;
        try { derived = steem.auth.wifToPublic(keys[role]); } catch { continue; }
        const expected = auth[role];
        // Task 36: prefix-aware compare — the derivation render is STM-prefixed,
        // BLURT authorities are BLT-prefixed; the payload decides, not the prefix
        const rendered = derived ? NET_PREFIX[net] + derived.slice(3) : null;
        if (rendered && expected && rendered === expected) {
          matches.push({ account: acct, network: net, role, wif: keys[role], derived });
          checked.push({ account: acct, network: net, role, match: true });
          matchedThisNet = true;
        }
      }
      // Task 59: refusals must carry their own evidence — a no-match (acct,net)
      // is now visible in `checked` instead of vanishing (the tov-password
      // refusal came back with checked:[] — unexplainable to the owner).
      if (!matchedThisNet) checked.push({ account: acct, network: net, match: false });
    }
  }
  return { ok: matches.length > 0, matches, checked };
}

// ── Task 30: SAOS-ROT1 seed tree recovery (SETTLE-10 scheme) ─────────────────
// The 2026-09-08 rotation (saos-dex SETTLE-10) set headcorner/wic/tov authorities
// to keys derived as: fresh 64-hex seed → HMAC-SHA256 tree "SAOS-ROT1/<acct>/<chain>/<role>".
// Accepting the seed lets the OWNER reconnect every rotated account in one paste.
// Verify-then-write still applies: only keys that MATCH the live chain authority
// are ever persisted; owner role is stored too (owner demanded full custody restore).

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(buf) {
  let n = BigInt("0x" + buf.toString("hex"));
  let out = "";
  while (n > 0n) { out = B58_ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}
function wifFromPriv32(priv32, compressed) {
  const tail = compressed ? Buffer.from([0x01]) : Buffer.alloc(0);
  const payload = Buffer.concat([Buffer.from([0x80]), priv32, tail]);
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().slice(0, 4);
  return b58encode(Buffer.concat([payload, checksum]));
}

/**
 * Derive the SAOS-ROT1 tree for one account and match against LIVE authorities.
 * Tries construction variants (key=seed/msg=label and inverse, chain case,
 * compressed/uncompressed WIF) — the exact generator was ephemeral; we match its
 * OUTPUT on-chain, not its source. Returns matches with the exact verifying WIF.
 */
async function saosRot1Match(seedHex, account) {
  const seedBuf = /^[0-9a-fA-F]{64}$/.test(seedHex) ? Buffer.from(seedHex, "hex") : Buffer.from(seedHex, "utf8");
  const matches = [];
  const chainTokens = { STEEM: ["STEEM", "steem"], HIVE: ["HIVE", "hive"] };
  const roles = ["owner", "active", "posting", "memo"];
  for (const net of ["STEEM", "HIVE"]) {
    let auth;
    try { auth = await chainAuthorities(net, account); } catch { continue; }
    for (const chainTok of chainTokens[net]) {
      for (const role of roles) {
        const label = `SAOS-ROT1/${account}/${chainTok}/${role}`;
        const variants = [
          createHmacSha256(seedBuf, Buffer.from(label, "utf8")), // key=seed, msg=label
          createHmacSha256(Buffer.from(label, "utf8"), seedBuf)  // key=label, msg=seed
        ];
        for (const priv32 of variants) {
          for (const compressed of [true, false]) {
            const wif = wifFromPriv32(priv32, compressed);
            let pub = null;
            try { pub = steem.auth.wifToPublic(wif); } catch { continue; }
            if (pub && auth[role] === pub) matches.push({ account, network: net, role, wif, derived: pub });
            // Task 36: BLURT payload-parity match (BLT render of the same payload)
            else if (pub && auth[role] === "BLT" + pub.slice(3)) matches.push({ account, network: net, role, wif, derived: "BLT" + pub.slice(3) });
          }
        }
      }
    }
  }
  return matches;
}

function createHmacSha256(key, msg) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (steem-js parity)
  const { createHmac } = require("crypto");
  return createHmac("sha256", key).update(msg).digest();
}

/** public-data view of a role slot — never any WIF material.
 *  Task 74: match = ANY held candidate (cross-net-tag payload identity) — the
 *  requested net's own slot is tried first and `via` names the winner's tag. */
async function slotView(net, acct, target, role) {
  const candidates = target ? heldWifCandidates(target, role, net) : [];
  if (!candidates.length) return { loaded: false, role };
  let via = null;
  let viaDerived = null;
  let expected = null, match: boolean | null = null;
  try {
    const auth = await chainAuthorities(net, acct);
    // Task 64: memo slots are real slots (16/16 drift coverage) — the view used
    // to compare a memo WIF against the POSTING authority (silently false).
    expected = role === "active" ? auth.active : role === "owner" ? auth.owner : role === "memo" ? auth.memo : auth.posting;
    // Task 36/74: payload decides (STM/HIVE/BLT renders of the same key)
    for (const wif of candidates) {
      let d = null;
      try { d = steem.auth.wifToPublic(wif); } catch {}
      if (d && expected && d.slice(3) === expected.slice(3)) { via = netTagOf(target, wif, role) ?? "candidate"; viaDerived = d; break; }
    }
    match = expected ? via !== null : null;
  } catch { match = null; }
  const prefix = NET_PREFIX[net] ?? "STM";
  return { loaded: true, role, derived: viaDerived ? prefix + viaDerived.slice(3) : null, expected, match, ...(via ? { via } : {}) };
}

/** which net tag supplied the matching candidate (display only — no secret) */
function netTagOf(target, wif, role) {
  for (const n of ["STEEM", "HIVE", "BLURT"]) {
    const s = target?.net?.[n];
    if (s && (role === "active" ? s.activeWif : role === "owner" ? s.ownerWif : role === "memo" ? s.memoWif : s.postingWif) === wif) return n;
  }
  return "generic";
}

loadState();

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (signing only)
const steem = require("steem");

// ── RPC (plain fetch, no lib url coupling) ───────────────────────────────────
// roast 56: failure CLASS is a structural fact the caller needs — a chain that
// ANSWERED with an error refused the tx (nothing broadcast → a retry may build
// a fresh tx safely); a TRANSPORT failure during broadcast means the tx MAY be
// in flight (the caller must replay the requestId, never rebuild). Untagged,
// both looked identical at the /sign boundary and the caller had to guess.
async function rpcCall(node, method, params) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    let json;
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: ctl.signal
      });
      json = await res.json();
    } catch (e) {
      const err = new Error(`transport: ${String(e?.message ?? e).slice(0, 120)}`);
      err.code = "TRANSPORT";
      throw err;
    }
    if (json.error) {
      const err = new Error(String(json.error.message ?? "rpc error").slice(0, 160));
      err.code = "CHAIN_REJECTED"; // the chain answered and refused — nothing was broadcast
      throw err;
    }
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

function chainIdFor(network) {
  return network === "HIVE" ? HIVE_CHAIN_ID : network === "BLURT" ? BLURT_CHAIN_ID : null; // steem lib default = STEEM chain_id
}
function nodesFor(network) {
  // roast 52: the BLURT resilience doctrine applied to ALL chains — a single
  // hardcoded STEEM/HIVE endpoint made "authority-unverifiable" an intermittent
  // lie (hive.blog/steemit.com 403/429 proven on this env). All added candidates
  // live-verified 2026-09-10 (fresh heads: steem 109449504/505, hive 109784074/75).
  // Graphene broadcast is stateless — any node relays a signed tx, rotation is safe.
  if (network === "HIVE") return [HIVE_RPC, "https://api.deathwing.me", "https://api.openhive.network"].filter((v, i, a) => a.indexOf(v) === i);
  if (network === "BLURT") return BLURT_NODES;
  return [STEEM_RPC, "https://api.steem.fans", "https://api.justyy.com", "https://steemapi.boylikegirl.club"].filter((v, i, a) => a.indexOf(v) === i);
}
/** resilient rpc across a network's node list (BLURT has 3 candidates) */
async function rpcCallNet(network, method, params) {
  let lastErr = null;
  for (const node of nodesFor(network)) {
    try {
      return await rpcCall(node, method, params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("no rpc candidate for " + network);
}

// ── AUTHORITY VERIFICATION GATE (fail-closed, names/pubkeys only) ────────────
const authCache = new Map(); // `${network}:${account}` → { at, posting, active }
// ── v2.4.0: LIVE-DRIFT MONITOR — "ודא שזה לא יקרה שוב" ─────────────────────
// Every 10 minutes (plus on demand via /keys/verify-live) EVERY loaded key slot
// is re-derived and compared against the CURRENT on-chain authority. If a key
// that used to match no longer matches (i.e. someone rotated the authorities
// on-chain — the SETTLE-10 incident), it is recorded as drift + logged ALERT:
// detection within minutes instead of weeks.
type DriftRow = { account: string; network: string; role: string; expected: string; derived: string; at: string };
const driftState: { lastCheck: string | null; lastSummary: Record<string, unknown> | null; drifts: DriftRow[]; unmatched: DriftRow[]; running: boolean } = { lastCheck: null, lastSummary: null, drifts: [], unmatched: [], running: false };
// Task 33: per-slot previous-match memory — "drift" (external rotation) is
// declared ONLY on a true→false transition. Slots that never matched the live
// chain (e.g. fleet keys vs STEEM authorities — the known historic posture)
// are reported as "unmatched/pending-ingest", NOT as a rotation alarm.
const prevMatch = new Map(); // "acct|net|role" → boolean

async function verifyLiveAll() {
  if (driftState.running || !STATE) return { skipped: true, reason: "check already running or seal unavailable" };
  driftState.running = true;
  // roast 54 — the flag was cleared inline near the end; ONE unexpected throw
  // between set and clear would leave running=true FOREVER: every later check
  // answers "skipped — already running" and the drift monitor is dead until
  // restart (the safe-by-luck class again). finally guarantees the reset.
  try {
    return await verifyLiveAllInner();
  } finally {
    driftState.running = false;
  }
}

async function verifyLiveAllInner() {
  const rows: DriftRow[] = [];
  const unmatchedRows: DriftRow[] = [];
  let okCount = 0, errCount = 0;
  const targets: Array<{ account: string; net: Record<string, Record<string, string | null>> | null; generic: Record<string, string | null> }> = [
    { account: STATE.main.account, net: STATE.main.net ?? null, generic: { posting: STATE.main.postingWif ?? null, active: STATE.main.activeWif ?? null, owner: STATE.main.ownerWif ?? null, memo: STATE.main.memoWif ?? null } },
    ...STATE.fleet.map((f) => ({ account: f.username, net: f.net ?? null, generic: { posting: f.postingWif ?? null, active: f.activeWif ?? null, owner: f.ownerWif ?? null, memo: f.memoWif ?? null } }))
  ];
  for (const t of targets) {
    for (const net of ["STEEM", "HIVE", "BLURT"]) {
      const slots: Record<string, string | null> = {
        posting: t.net?.[net]?.postingWif ?? t.generic.posting ?? null,
        active: t.net?.[net]?.activeWif ?? t.generic.active ?? null,
        owner: t.net?.[net]?.ownerWif ?? t.generic.owner ?? null,
        memo: t.net?.[net]?.memoWif ?? t.generic.memo ?? null
      };
      let auth: Record<string, string | null> | null = null;
      try { auth = await chainAuthorities(net, t.account); } catch { errCount++; continue; }
      for (const [role, slotWif] of Object.entries(slots)) {
        if (!slotWif) continue;
        // Task 74: a slot is OURS iff ANY held candidate for the role derives to
        // the authority's payload (cross-net-tag identity — the 23:25Z rotation
        // re-pointed STEEM at the BLURT-payload keys we already hold). The
        // requested net's own slot is still the FIRST candidate, so a true
        // net-local match behaves exactly as before.
        const candidates = heldWifCandidates(t, role, net);
        let matched: string | null = null; // the matching candidate's derived payload render
        let derived: string | null = null;
        try { derived = steem.auth.wifToPublic(slotWif); } catch {}
        for (const cand of candidates) {
          let d: string | null = null;
          try { d = steem.auth.wifToPublic(cand); } catch {}
          if (d && auth?.[role] && auth[role].slice(3) === d.slice(3)) { matched = d; break; }
        }
        const expected = auth?.[role] ?? null;
        const slotKey = `${t.account}|${net}|${role}`;
        const prev = prevMatch.has(slotKey) ? prevMatch.get(slotKey) : null;
        if (expected && matched) {
          okCount++;
          prevMatch.set(slotKey, true);
        } else if (expected) {
          const row = { account: t.account, network: net, role, expected, derived: derived ?? "derivation-failed", at: new Date().toISOString() };
          if (prev === true) rows.push(row); // REAL rotation: matched before, failed now
          else unmatchedRows.push(row); // never matched — pending ingest / wrong chain
          prevMatch.set(slotKey, false);
        }
      }
    }
  }
  const prevRotations = driftState.drifts.length;
  driftState.drifts = rows;
  driftState.unmatched = unmatchedRows;
  driftState.lastCheck = new Date().toISOString();
  driftState.lastSummary = { ok: okCount, drift: rows.length, unmatched: unmatchedRows.length, errors: errCount };
  if (rows.length > 0 && rows.length > prevRotations) log("ALERT", `live-drift ROTATION: ${rows.length} key slot(s) MATCHED before and NO LONGER match the on-chain authority — external rotation detected! Accounts: ${[...new Set(rows.map((r) => r.account))].join(",")}`);
  else if (rows.length) log("WARN", `live-drift rotation still open: ${rows.length} slot(s) await re-ingest`);
  else if (unmatchedRows.length) log("INFO", `live-drift clean: ${okCount} slot(s) verified against the live chain; ${unmatchedRows.length} slot(s) never-matched (pending ingest for that chain) — no rotation`);
  else log("INFO", `live-drift check clean: ${okCount} slot(s) verified against the live chain`);
  return { ok: okCount, drift: rows.length, unmatched: unmatchedRows.length, errors: errCount, checkedAt: driftState.lastCheck, drifts: rows.slice(0, 12), unmatchedSample: unmatchedRows.slice(0, 12) };
}
setInterval(() => { void verifyLiveAll().catch(() => {}); }, 10 * 60 * 1000);
setTimeout(() => { void verifyLiveAll().catch(() => {}); }, 20 * 1000);

async function chainAuthorities(network, account) {
  const k = `${network}:${account}`;
  const hit = authCache.get(k);
  if (hit && Date.now() - hit.at < AUTH_CACHE_TTL_MS) return hit;
  const accs = await rpcCallNet(network, "condenser_api.get_accounts", [[account]]);
  const a = accs?.[0];
  if (!a) throw new Error(`account ${account} not found on ${network}`);
  const out = { at: Date.now(), posting: a.posting.key_auths[0][0], active: a.active.key_auths[0][0], owner: a.owner.key_auths[0][0], memo: a.memo_key };
  authCache.set(k, out);
  return out;
}

async function verifyAuthority(network, account, wif, role) {
  if (!wif) return { ok: false, error: `no ${role} key in envelope for ${account}` };
  let derived;
  try {
    derived = steem.auth.wifToPublic(wif);
  } catch {
    return { ok: false, error: `wif derivation failed for ${account} (envelope ${role})` };
  }
  const auth = await chainAuthorities(network, account);
  const expected = role === "active" ? auth.active : auth.posting;
  // Task 36: prefix-aware — the envelope WIF renders STM…, a BLURT authority is BLT…
  if (expected && derived.slice(3) !== expected.slice(3)) {
    return {
      ok: false,
      error: `authority-mismatch: ${account} envelope-${role} derives ${derived.slice(0, 11)}… but ${network} ${role} authority is ${expected.slice(0, 11)}… (fail-closed, nothing broadcast)`,
      derived,
      expected
    };
  }
  return { ok: true, derived: expected ? NET_PREFIX[network] + derived.slice(3) : derived };
}

// RC feasibility (Task 27): one op costs ~124M RC (measured live via lsa's
// rejected withdraw). Refuse doomed broadcasts with an honest ETA instead.
const RC_OP_COST = 1.5e8;
async function verifyRcFeasibility(network, account) {
  try {
    const rc = await rpcCallNet(network, "rc_api.find_rc_accounts", { accounts: [account] });
    const a = rc.rc_accounts[0];
    const mx = Number(a.max_rc) || 0;
    const stored = Number(a.rc_manabar.current_mana) || 0;
    const regen = Math.floor(((Math.floor(Date.now() / 1000) - Number(a.rc_manabar.last_update_time)) * mx) / (5 * 86400));
    const mana = Math.min(mx, stored + regen);
    if (mana < RC_OP_COST) {
      const etaMin = Math.ceil(((RC_OP_COST - mana) * 5 * 86400) / (mx || 1) / 60);
      return { ok: false, error: `rc-infeasible: ${account} has ${mana} RC, one op needs ~${RC_OP_COST} — regen ≈${etaMin} min (nothing broadcast)` };
    }
    return { ok: true, mana };
  } catch {
    return { ok: true, mana: null }; // rc probe failed — let the chain be the judge (honest fallback)
  }
}

/** which envelope key serves this request (account + authLevel + network);
 *  network-suffixed keys (Task 29) win over the legacy generic slot */
function keyFor(account, authLevel, network) {
  const isMain = !account || account === STATE.main.account;
  // Task 47 FIX (root cause of BLURT anchor refusal): BLURT must resolve its OWN
  // net-suffixed slots. It used to collapse to "STEEM" here, so after Task 43's
  // real-key ingest filled the STEEM slots, every BLURT request shadowed the
  // correct password-derived BLURT key with the STEEM posting WIF and the
  // authority gate (correctly) refused. Worked in Task 40 only because the
  // STEEM slots were still empty then — classic slot-shadowing regression.
  const net = network === "HIVE" ? "HIVE" : network === "BLURT" ? "BLURT" : "STEEM";
  const target = isMain ? STATE.main : STATE.fleet.find((f) => f.username === account);
  if (!target) return { target: null, wif: null, targetAccount: account ?? STATE.main.account };
  const generic = authLevel === "active" ? (target.activeWif ?? null) : authLevel === "owner" ? (target.ownerWif ?? null) : (target.postingWif ?? null);
  const suffixed = target?.net?.[net] ? (authLevel === "active" ? (target.net[net].activeWif ?? null) : authLevel === "owner" ? (target.net[net].ownerWif ?? null) : (target.net[net].postingWif ?? null)) : null;
  const wif = suffixed ?? generic;
  return { target, wif, targetAccount: target.username ?? target.account };
}

// Task 74 (2026-09-10 23:25Z rotation forensics): the chain can re-point a
// network's authorities at key material we ALREADY hold under a DIFFERENT net
// tag (the STEEM rotation unified STEEM onto the BLURT-payload keys — payload
// identity proven live: STM8m3rB… ≡ BLT8m3rB…). A slot is therefore "ours" iff
// ANY held candidate for that role derives to the authority's payload — the
// chain decides, prefixes are renders. This helper lists every held WIF for
// (target, role), REQUESTED net first (so the old behavior is the first
// candidate, never lost), then sibling nets, then generic/legacy slots —
// deduped. Fail-closed unchanged: verifyAuthority still checks every candidate
// against the LIVE chain before anything is signed.
function heldWifCandidates(target, role, net) {
  const out = [];
  const seen = new Set();
  const push = (w) => { if (w && !seen.has(w)) { seen.add(w); out.push(w); } };
  const netTags = [net, ...["STEEM", "HIVE", "BLURT"].filter((n) => n !== net)];
  for (const n of netTags) {
    const s = target?.net?.[n];
    if (s) push(role === "active" ? s.activeWif : role === "owner" ? s.ownerWif : role === "memo" ? s.memoWif : s.postingWif);
  }
  push(role === "active" ? target.activeWif : role === "owner" ? target.ownerWif : role === "memo" ? target.memoWif : target.postingWif);
  return out;
}

// Task 35: steem@0.7.10 cannot serialize the HIVE asset symbol (legacy STEEM/SBD/VESTS
// parser only) → any HIVE op carrying an asset (transfer_to_vesting/transfer) produced a
// digest the node could not match → tx_missing_active_auth. @hiveio/hive-js knows HIVE
// assets + the HIVE chain id, so HIVE signs through it; STEEM keeps the legacy path.
let hiveLib = null;
function hiveJs() {
  if (!hiveLib) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (signing only)
    hiveLib = require("@hiveio/hive-js");
    hiveLib.config.set("chain_id", HIVE_CHAIN_ID);
  }
  return hiveLib;
}

// Task 36 root-cause (proven by on-chain forensics): BLURT renumbered the
// operation enum — custom_json is op 12 on Blurt (not 18 like Steem), so the
// steem@0.7.10 serializer produced bytes the node parsed as a DIFFERENT op →
// "Missing Posting Authority". @blurtfoundation/blurtjs serializes byte-exact
// (txid-verified against live blocks 2026-09-09) — BLURT signs through it.
let blurtLib = null;
function blurtJs() {
  if (!blurtLib) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (signing only)
    blurtLib = require("@blurtfoundation/blurtjs");
    blurtLib.config.set("chain_id", BLURT_CHAIN_ID);
  }
  return blurtLib;
}

// ── build + sign + broadcast (transport 1:1 from he_powerup.cjs — proven) ────
// Task 35: Graphene trx_id = sha256(serialized-tx-body-without-signatures),
// truncated to 20 bytes — with NO chain_id prefix on EITHER chain (hived's
// signed_transaction::id() packs the base transaction only; chain_id feeds the
// SIGNATURE digest, not the id). Proven on-chain twice: STEEM task-35a canary,
// HIVE task-35b canary trx ec08f7ab05fed4f29388d4cf6d21e2fb0fe43760 —
// sha256(body)[0:20] == on-chain trx_id, while the earlier beeab0de…-prefix
// hypothesis produced e05b26b6… ≠ chain id (disproven by live canary, removed).
// Both legacy libs return txid:null from signTransaction, which left every
// /sign response with a null id (and fleet-cure recording txids by polling
// account history). Compute it here so EVERY response carries the real id.
function computeTxId(network, signedTx) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node builtin; CJS legacy-lib parity (signing only)
    const { createHash } = require("crypto");
    const serializer = network === "HIVE"
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (signing only)
      ? require("@hiveio/hive-js/lib/auth/serializer")
      : network === "BLURT"
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (signing only)
        ? require("@blurtfoundation/blurtjs/lib/auth/serializer")
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (signing only)
        : require("steem/lib/auth/serializer");
    const body = { ...signedTx };
    delete body.signatures;
    const buf = (serializer.ops?.transaction ?? serializer.transaction).toBuffer(body);
    // Task 40: FULL sha256 — the chain txid is 64 hex chars; the previous 40-hex
    // truncation made anchors impossible to verify via condenser get_transaction.
    // Anchors must be independently verifiable — that is their entire purpose.
    return createHash("sha256").update(buf).digest().toString("hex");
  } catch {
    return signedTx?.id ?? null; // honest fallback — never invent an id
  }
}

async function buildSignBroadcast(network, account, wif, operations) {
  const dgp = await rpcCallNet(network, "condenser_api.get_dynamic_global_properties", []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000).toISOString().slice(0, 19),
    operations,
    extensions: []
  };
  let signed;
  if (network === "HIVE") {
    signed = hiveJs().auth.signTransaction(tx, [wif]);
  } else if (network === "BLURT") {
    signed = blurtJs().auth.signTransaction(tx, [wif]);
  } else {
    const prev = steem.config.get("chain_id");
    const cid = chainIdFor(network);
    if (cid) steem.config.set("chain_id", cid);
    try {
      signed = steem.auth.signTransaction(tx, [wif]);
    } finally {
      if (cid) steem.config.set("chain_id", prev);
    }
  }
  const txid = computeTxId(network, signed); // full 64-hex sha256 — canonical, explorer-verifiable
  // Task 40: synchronous broadcast — the NODE confirms the block it landed in.
  // The node's id field is a 20-byte prefix of the full sha256 txid: cross-check
  // it against the locally computed full id (signing/serialization drift would
  // mismatch here — fail closed). Plain broadcast accepted doomed transactions
  // silently; synchronous surfaces every rejection verbatim.
  try {
    const sync = await rpcCallNet(network, "condenser_api.broadcast_transaction_synchronous", [signed]);
    log("DEBUG", `sync-broadcast raw: ${JSON.stringify(sync ?? null).slice(0, 300)}`);
    const nodeTrxId = sync?.id ?? sync?.trx_id ?? null;
    if (!nodeTrxId) throw new Error("synchronous-broadcast: node returned no trx id");
    if (txid && !txid.startsWith(nodeTrxId)) {
      throw new Error(`txid-mismatch: node=${nodeTrxId} local=${txid.slice(0, 20)}… — signing/serialization drift, refusing to record`);
    }
    // Task 80: return the NODE-CONFIRMED canonical id (40-hex — the form
    // get_transaction and every explorer accept). Identity vs the locally
    // computed full sha256 was PROVED by the prefix cross-check just above;
    // condenser get_transaction REJECTS the 64-hex form ("invalid size",
    // proven live on the first fleet HIVE weave anchor). The fallback path
    // below keeps the full hash (node id unavailable there).
    return { txid: nodeTrxId, result: sync, confirmedBlock: sync?.block_num ?? null, nodeTrxId };
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/Could not find method|not found|Unknown method/i.test(msg)) {
      // legacy node without the synchronous variant — plain broadcast + locally computed id
      const result = await rpcCallNet(network, "condenser_api.broadcast_transaction", [signed]);
      return { txid, result, confirmedBlock: null, nodeTrxId: null };
    }
    throw e; // the chain's own rejection reason — verbatim, never swallowed
  }
}

// ── Hive-Engine helpers (read-only balances for bounds/withdraw payload) ─────
const HE_RPC = "https://api.hive-engine.com/rpc/contracts";
async function heBalance(account, symbol) {
  const rows = await rpcCall(HE_RPC, "find", { contract: "tokens", table: "balances", query: { account, symbol }, limit: 1 });
  return rows?.[0] ? Number(rows[0].balance) : 0;
}

function heJson(contractName, contractAction, contractPayload) {
  return {
    required_auths: [], // filled per-op below
    required_posting_auths: [],
    id: "ssc-mainnet-hive",
    json: JSON.stringify({ contractName, contractAction, contractPayload })
  };
}

// ── roast-66: THE STEEM PLANE — measured live, displayed, one-step-closable ──
// The owner's finding ("לכולם חסר steemit"): the screen showed HIVE+BLURT for
// the fleet while the STEEM plane was INVISIBLE — nobody could see that all 12
// accounts EXIST on steemit (created 2018, pre-fork) with real balances, that
// the main account's STEEM plane is live-held 4/4, and that the fleet's STEEM
// authorities were rotated externally (the 2018 passwords match HIVE/BLURT but
// NOT STEEM — measured 0/80). This endpoint measures the whole plane live:
// existence, balances (liquid/SBD/HP), STEEM-vs-HIVE divergence, and a
// fail-closed probe of whether ANY held WIF (any net tag — WIF bytes are
// chain-agnostic, only the render prefix differs) matches the LIVE STEEM
// authorities. PUBLIC DATA ONLY: verdicts + balances; no WIF, no pubkey echo.
let steemPlaneCache: { at: number; payload: Record<string, unknown> } | null = null;
const STEEM_PLANE_TTL = 60_000;

interface ChainAuth { key_auths?: Array<[string, number]>; account_auths?: Array<[string, number | string]>; }
interface ChainAccount {
  name: string;
  created?: string;
  balance?: string;
  sbd_balance?: string;
  vesting_shares?: string;
  savings_balance?: string;
  savings_sbd_balance?: string;
  reward_steem_balance?: string;
  reward_sbd_balance?: string;
  reward_vesting_balance?: string;
  memo_key?: string;
  owner?: ChainAuth;
  active?: ChainAuth;
  posting?: ChainAuth;
}

async function steemPlaneProbe() {
  if (!STATE) throw new Error("seal-unavailable");
  if (steemPlaneCache && Date.now() - steemPlaneCache.at < STEEM_PLANE_TTL) return steemPlaneCache.payload;
  const names = [...new Set([STATE.main.account, ...STATE.fleet.map((f: { username: string }) => f.username), ...(STATE.vaultAccounts ?? [])])].filter(Boolean);
  const [dgpo, steemAccs, hiveAccs] = await Promise.all([
    rpcCallNet("STEEM", "condenser_api.get_dynamic_global_properties", []),
    rpcCallNet("STEEM", "condenser_api.get_accounts", [names]),
    rpcCallNet("HIVE", "condenser_api.get_accounts", [names]).catch(() => [] as Array<Record<string, unknown>>)
  ]);
  const tvs = Number(String(dgpo.total_vesting_shares).split(" ")[0]);
  const tvf = Number(String(dgpo.total_vesting_fund_steem).split(" ")[0]);
  const steemPerMvest = tvf / (tvs / 1e6);
  const sMap = new Map<string, ChainAccount>((steemAccs as ChainAccount[]).map((a) => [a.name, a]));
  const hMap = new Map<string, ChainAccount>((hiveAccs as ChainAccount[]).map((a) => [a.name, a]));
  // held WIF candidates per account×role across ALL net tags (chain-agnostic bytes)
  const heldOf = (account: string, role: string): string[] => {
    const out = new Set<string>();
    if (STATE.main.account === account) {
      for (const net of ["STEEM", "HIVE", "BLURT"]) {
        const w = STATE.main.net?.[net]?.[`${role}Wif`];
        if (w) out.add(w);
      }
      const flat = STATE.main[`${role}Wif`];
      if (flat) out.add(flat); // legacy flat slot (pre net-tagging) — a candidate like any other
    }
    const f = STATE.fleet.find((x: { username: string }) => x.username === account);
    if (f) {
      for (const net of ["STEEM", "HIVE", "BLURT"]) {
        const w = f.net?.[net]?.[`${role}Wif`];
        if (w) out.add(w);
      }
      const flat = f[`${role}Wif`];
      if (flat) out.add(flat);
    }
    return [...out];
  };
  const ROLES = ["owner", "active", "posting", "memo"];
  const accounts: Array<Record<string, unknown>> = [];
  const summary = { onSteem: 0, accountsTotal: names.length, probed: 0, invalidHeld: 0, matchedRoles: 0, accountsWithMatch: 0, postingAnchoredGaps: 0, totalLiquid: 0, totalSbd: 0, totalHp: 0 };
  for (const name of names) {
    const a = sMap.get(name);
    if (!a) { accounts.push({ name, exists: false, roles: {} }); continue; }
    summary.onSteem++;
    const h = hMap.get(name) ?? null;
    const roles: Record<string, { held: number; match: boolean | null }> = {};
    let anyMatch = false;
    for (const role of ROLES) {
      const wifs = heldOf(name, role);
      const acc = a as ChainAccount;
      const auths = role === "memo" ? [String(acc.memo_key ?? "")] : ((acc[role]?.key_auths ?? []) as Array<[string, number]>).map((k) => String(k?.[0] ?? ""));
      let match: boolean | null = wifs.length ? false : null;
      for (const wif of wifs) {
        summary.probed++;
        let pub: string;
        try { pub = steem.auth.wifToPublic(wif); } catch { summary.invalidHeld++; continue; }
        const payload = String(pub).slice(3);
        if (auths.some((auth) => auth && auth.slice(3) === payload)) { match = true; break; }
      }
      if (match === true) { anyMatch = true; summary.matchedRoles++; }
      roles[role] = { held: wifs.length, match };
    }
    if (anyMatch) summary.accountsWithMatch++;
    const acc = a as ChainAccount;
    const hp = (Number(String(acc.vesting_shares ?? "0").split(" ")[0]) / 1e6) * steemPerMvest;
    summary.totalLiquid += Number(String(acc.balance ?? "0").split(" ")[0]);
    summary.totalSbd += Number(String(acc.sbd_balance ?? "0").split(" ")[0]);
    summary.totalHp += hp;
    const divergence: Record<string, string | null> = {};
    for (const role of ["owner", "active", "posting"]) {
      const sKey = String(acc[role]?.key_auths?.[0]?.[0] ?? "");
      const hKey = h ? String((h as ChainAccount)[role]?.key_auths?.[0]?.[0] ?? "") : "";
      divergence[role] = !sKey || !hKey ? null : sKey.slice(3) === hKey.slice(3) ? "same" : "diverged";
    }
    // Task 70 — posting-anchor derivation (public chain data only): if OUR main
    // account sits in this account's posting account_auths with weight ≥
    // threshold, the posting plane is OPERABLE by us even with zero held keys
    // (the ynet rescue anchor the operator preserved at the 09-04 rotation;
    // proven on-chain by saos-ping txids on both chains). Derived, never stored.
    const anchorIn = (accAuth: ChainAccount | null): string | null => {
      if (!accAuth?.posting) return null;
      const th = Number(accAuth.posting.weight_threshold ?? 1);
      const hit = (accAuth.posting.account_auths ?? []).find((e) => String(e?.[0]) === STATE.main.account);
      return hit && Number(hit[1]) >= th ? String(STATE.main.account) : null;
    };
    const postingAnchor = { STEEM: anchorIn(acc), HIVE: anchorIn(h as ChainAccount | null) };
    if (!anyMatch && postingAnchor.STEEM) summary.postingAnchoredGaps++;
    accounts.push({
      name,
      exists: true,
      created: String(acc.created ?? "").slice(0, 10),
      liquid: acc.balance, sbd: acc.sbd_balance,
      hp: hp.toFixed(3),
      savings: `${acc.savings_balance} / ${acc.savings_sbd_balance}`,
      rewards: `${acc.reward_steem_balance} / ${acc.reward_sbd_balance} / ${acc.reward_vesting_balance}`,
      divergence,
      postingAnchor,
      roles
    });
  }
  const payload = {
    measuredAt: new Date().toISOString(),
    steemPerMvest: Number(steemPerMvest.toFixed(3)),
    accounts,
    summary: {
      ...summary,
      totalLiquid: Number(summary.totalLiquid.toFixed(3)),
      totalSbd: Number(summary.totalSbd.toFixed(3)),
      totalHp: Number(summary.totalHp.toFixed(3))
    }
  };
  steemPlaneCache = { at: Date.now(), payload };
  return payload;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- server handle kept for supervision
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    // liveness probe (no auth): proves the PROCESS is alive but leaks nothing
    if (url.pathname === "/ping") return Response.json({ ok: true, service: "external-signer" });

    if (!tokenOk(req)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (!STATE) return Response.json({ ok: false, error: "seal-unavailable (fail-closed)" }, { status: 503 });

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "external-signer",
        connected: true,
        sealedAt: STATE.sealedAt,
        mainAccount: STATE.main.account,
        fleetAccounts: [STATE.main.account, ...STATE.fleet.map((f) => f.username)].filter((v, i, a) => a.indexOf(v) === i),
        networks: ["STEEM", "HIVE", "BLURT"],
        capabilities: ["keys-ingest", "keys-backup", "rot1-seed-recovery", "universal-paste", "live-drift-monitor", "idempotent-sign"],
        // roast 54 — per-network scopes replace the flat list that claimed
        // transfer/delegate/claim for STEEM while only HIVE implements them
        scopes: {
          STEEM: ["custom_json"],
          HIVE: ["custom_json", "transfer_to_vesting", "transfer", "claim_rewards", "he_market_sell", "he_withdraw", "delegate_vesting_shares"],
          BLURT: ["custom_json"]
        },
        authorityGate: "verify-before-broadcast (fail-closed)",
        maxOpHive: MAX_OP_HIVE,
        version: SIGNER_VERSION
      });
    }

    if (url.pathname === "/keys/verify-live" && (req.method === "GET" || req.method === "POST")) {
      const r = await verifyLiveAll();
      return Response.json({ ok: true, summary: { slots: r.ok, drift: r.drift, unmatched: r.unmatched, errors: r.errors }, checkedAt: r.checkedAt, drifts: r.drifts, unmatchedSample: r.unmatchedSample ?? [], skipped: r.skipped ?? false, reason: r.reason ?? null });
    }

    // ── roast-66: the STEEM plane as a first-class measured surface ──
    // Before this, the plane was invisible (the owner: "לכולם חסר steemit"):
    // the screen showed HIVE+BLURT verdicts only. Now: live existence + balances
    // + divergence + held-WIF-vs-live-authority probe, fail-closed, public data
    // only (verdicts + balances; no WIF, no pubkey echo).
    if (url.pathname === "/keys/steem-plane" && req.method === "GET") {
      try {
        const payload = await steemPlaneProbe();
        return Response.json({ ok: true, ...payload, version: SIGNER_VERSION });
      } catch (e) {
        return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
      }
    }

    // ── Task 29: owner key entry point (self-protecting: only a live authority match is ever written) ──
    if (url.pathname === "/keys/status" && req.method === "GET") {
      try {
        const mainNet = {};
        for (const net of ["STEEM", "HIVE", "BLURT"]) {
          mainNet[net] = {
            posting: await slotView(net, STATE.main.account, STATE.main, "posting"),
            active: await slotView(net, STATE.main.account, STATE.main, "active"),
            owner: await slotView(net, STATE.main.account, STATE.main, "owner"),
            memo: await slotView(net, STATE.main.account, STATE.main, "memo")
          };
        }
        // Task 64 (חיבור-הכל): the fleet display used to show only generic
        // posting/active — a net-tagged account (tov: BLURT-only) rendered as
        // loaded:false on every visible slot while its keys were LIVE and
        // drift-verified. The display now carries the per-network role map,
        // only for networks that actually hold material (empty nets omitted —
        // absence means "no key material for that net", never "loaded:false").
        const fleet = [];
        for (const f of STATE.fleet) {
          const networks = {};
          for (const net of ["STEEM", "HIVE", "BLURT"]) {
            const n = f.net?.[net] ?? {};
            const roles = {
              posting: Boolean(n.postingWif ?? f.postingWif),
              active: Boolean(n.activeWif ?? f.activeWif),
              owner: Boolean(n.ownerWif ?? f.ownerWif),
              memo: Boolean(n.memoWif)
            };
            if (roles.posting || roles.active || roles.owner || roles.memo) networks[net] = roles;
          }
          fleet.push({
            username: f.username,
            posting: f.postingWif ? { loaded: true } : { loaded: false },
            active: f.activeWif ? { loaded: true } : { loaded: false },
            networks
          });
        }
        return Response.json({ ok: true, main: { account: STATE.main.account, networks: mainNet }, fleet, vaultAccountNames: STATE.vaultAccounts ?? [], sealedAt: STATE.sealedAt, drift: { lastCheck: driftState.lastCheck, openDrifts: driftState.drifts.length, unmatched: driftState.unmatched.length, summary: driftState.lastSummary }, version: SIGNER_VERSION });
      } catch (e) {
        return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
      }
    }

    if (url.pathname === "/keys/ingest" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad-json" }, { status: 400 }); }
      const raw = JSON.stringify(body ?? {});
      if (raw.length > 8192) return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
      const rawText = typeof body?.text === "string" && body.text.trim().length > 0 && body.text.length <= 8192 ? body.text : null;
      const entries = rawText
        ? parseKeyPayload(rawText)
        : Array.isArray(body?.entries)
          ? body.entries.slice(0, 16)
          : body?.wif
            ? [{ network: body.network, wif: body.wif }]
            : [];
      if (!entries.length) return Response.json({ ok: false, error: "missing entries [{network, wif, role?}] or text (universal paste)" }, { status: 400 });
      const ingested = [], refused = [];
      let sealInfo = null;
      const persist = (account, network, wif, role) => {
        sealInfo = writeIngestedKey(resolveEnvelopeDir(), account, network, wif, role);
      };
      for (const ent of entries) {
        const wif = typeof ent?.wif === "string" ? ent.wif.trim() : "";
        const askedNet = ent?.network === "HIVE" ? "HIVE" : ent?.network === "BLURT" ? "BLURT" : ent?.network === "STEEM" ? "STEEM" : null;
        if (!wif) { refused.push({ network: ent?.network ?? "?", error: "missing wif" }); continue; }
        const isWif = steem.auth.isWif ? steem.auth.isWif(wif) : false;
        const isRotSeed = /^[0-9a-fA-F]{64}$/.test(wif) || /^SAOS-ROT1:/i.test(wif);
        if (isRotSeed) {
          // SAOS-ROT1 master seed — derive the full tree for every candidate account.
          const seedHex = wif.replace(/^SAOS-ROT1:/i, "").trim();
          const accounts = ingestCandidates();
          const found = [];
          for (const acct of accounts) {
            try { found.push(...await saosRot1Match(seedHex, acct)); } catch {}
          }
          if (found.length) {
            try {
              for (const m of found) {
                await persist(m.account, m.network, m.wif, m.role);
                log("INGEST", `network=${m.network} account=${m.account} role=${m.role} MATCH (SAOS-ROT1 tree) — written, envelope re-sealed`);
                ingested.push({ account: m.account, network: m.network, role: m.role, derived: m.derived, via: "saos-rot1", sealedAt: sealInfo?.sealedAt ?? null });
              }
            } catch (e) {
              log("ERROR", `ingest write failed (rot1 path): ${String(e?.message ?? e).slice(0, 160)}`);
              refused.push({ error: `verify-ok but write failed (fail-closed): ${String(e?.message ?? e).slice(0, 160)}` });
            }
          } else {
            log("REFUSED", "ingest SAOS-ROT1 seed: no live authority match across the tree (nothing written)");
            refused.push({ error: "ה-seed לא גוזר אף מפתח שתואם לרשויות-החיות — שום דבר לא נכתב. ודא שזהו ה-seed מ-SETTLE-10 (64-hex)" });
          }
          continue;
        }
        if (isWif) {
          // v2.4.0: role-aware — the chain decides the true account/network/role
          const res = await ingestOwnerKey(askedNet, wif, typeof ent?.role === "string" ? ent.role.toLowerCase() : null);
          if (res.ok) {
            try {
              await persist(res.account, res.network, wif, res.role);
              log("INGEST", `network=${res.network} account=${res.account} role=${res.role} MATCH — written to its true slot, envelope re-sealed`);
              ingested.push({ account: res.account, network: res.network, role: res.role, derived: res.derived, sealedAt: sealInfo?.sealedAt ?? null });
            } catch (e) {
              log("ERROR", `ingest write failed network=${res.network}: ${String(e?.message ?? e).slice(0, 160)}`);
              refused.push({ network: res.network, error: `verify-ok but write failed (fail-closed): ${String(e?.message ?? e).slice(0, 160)}` });
            }
          } else {
            log("REFUSED", `ingest network=${ent?.network ?? "?"}: ${res.verdict?.error ?? "no match"}`);
            refused.push(res.verdict);
          }
        } else {
          // master-password path: derive active/posting/memo per candidate account × all networks
          // Task 40 fix: BLURT was missing here — the universal paste NEVER derived
          // BLURT role keys, so the vault's BLURT slots stayed empty (keys/status
          // silently fell back to the shared STEEM wif) and every BLURT broadcast
          // was refused by the authority gate. The password DOES derive all four
          // BLURT authorities live (p-key-connect-test proof).
          const networks = askedNet ? [askedNet] : ["STEEM", "HIVE", "BLURT"];
          const res = await ingestOwnerPassword(wif, networks);
          if (res.ok && res.matches.length) {
            try {
              for (const m of res.matches) {
                await persist(m.account, m.network, m.wif, m.role);
                log("INGEST", `network=${m.network} account=${m.account} role=${m.role} MATCH (master-password derived) — written, envelope re-sealed`);
                ingested.push({ account: m.account, network: m.network, role: m.role, derived: m.derived, sealedAt: sealInfo.sealedAt });
              }
            } catch (e) {
              log("ERROR", `ingest write failed (password path): ${String(e?.message ?? e).slice(0, 160)}`);
              refused.push({ error: `verify-ok but write failed (fail-closed): ${String(e?.message ?? e).slice(0, 160)}` });
            }
          } else {
            log("REFUSED", `ingest master-password: no live authority match across ${networks.join("/")} (nothing written)`);
            refused.push({ error: `לא נמצאה התאמה לרשויות-החיות (${networks.join("/")}) — שום דבר לא נכתב`, checked: res.checked.slice(0, 12) });
          }
        }
      }
      if (ingested.length) loadState(); // hot-reload in-memory keys from the re-sealed envelope
      return Response.json({ ok: ingested.length > 0, ingested, refused, sealedAt: STATE?.sealedAt ?? null });
    }

    if (url.pathname === "/keys/backup" && req.method === "POST") {
      // Task 30: encrypted owner backup — AES-256-GCM under a passphrase the OWNER
      // chooses; the blob is safe to keep anywhere (repo included). The passphrase
      // and the payload are never logged. Fail-closed on missing STATE.
      let body;
      try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad-json" }, { status: 400 }); }
      const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
      if (passphrase.length < 10 || passphrase.length > 200) {
        return Response.json({ ok: false, error: "passphrase must be 10-200 chars" }, { status: 400 });
      }
      try {
        // roast 63: the payload used to export net STEEM+HIVE only while STATE
        // fully carries BLURT — the backup lied about what it holds, and exactly
        // the BLURT plane (the live-anchored chain, HEADCORNER master-key roles)
        // would have been missing from a wipe-recovery. All three planes now.
        const payload = { exportedAt: new Date().toISOString(), version: SIGNER_VERSION, main: { account: STATE.main.account, keys: { generic: { posting: STATE.main.postingWif ?? null, active: STATE.main.activeWif ?? null, memo: STATE.main.memoWif ?? null, owner: STATE.main.ownerWif ?? null }, net: { STEEM: STATE.main.net?.STEEM ?? null, HIVE: STATE.main.net?.HIVE ?? null, BLURT: STATE.main.net?.BLURT ?? null } } }, fleet: STATE.fleet.map((f) => ({ username: f.username, generic: { posting: f.postingWif ?? null, active: f.activeWif ?? null, owner: f.ownerWif ?? null }, net: { STEEM: f.net?.STEEM ?? null, HIVE: f.net?.HIVE ?? null, BLURT: f.net?.BLURT ?? null } })) };
        const salt = randomBytes(16), iv = randomBytes(12);
        const key = scryptSync(passphrase, salt, 32);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        const file = JSON.stringify({ v: 1, cipher: "aes-256-gcm", kdf: "scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"), data: data.toString("base64") });
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const filename = `key-backup-${STATE.main.account}-${stamp}.enc`;
        log("INFO", `backup created: ${filename} (aes-256-gcm/scrypt; passphrase never logged)`);
        return Response.json({ ok: true, filename, file, format: "SAOS-KEY-BACKUP-1 (scrypt+AES-256-GCM; decrypt: scripts/decrypt-key-backup.mjs)" });
      } catch (e) {
        return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, { status: 500 });
      }
    }

    // ── Task 38: owner-key operator login (owner directive: "אני עדיין לא מצליח להתחבר") ──
    // The foundry's login form accepts the OWNER'S OWN master keys (owner/active,
    // STEEM/HIVE/BLURT) in addition to the admin key. Verification happens HERE,
    // inside the signer: sha256(presented) is compared timing-safe against the
    // sha256 of every in-memory vault key. The plaintext NEVER leaves this
    // process, is never logged, never stored — only a boolean + coarse slot
    // label (network/role/account) is returned. Fail-closed: no STATE ⇒ no match.
    if (url.pathname === "/auth/verify-owner" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return Response.json({ ok: false, match: false, error: "bad-json" }, { status: 400 }); }
      const key = typeof body?.key === "string" ? body.key.trim() : "";
      if (!key || key.length > 4096) return Response.json({ ok: false, match: false, error: "missing key" }, { status: 400 });
      if (!STATE) return Response.json({ ok: true, match: false, reason: "seal-unavailable" });
      const presented = createHash("sha256").update(key, "utf8").digest("hex");
      // P-convention normalization (Blurt wallet writes "P"+WIF; STEEM/HIVE are bare):
      // the owner may paste either variant of the SAME key — try all three forms.
      const alt1 = key.startsWith("P") ? createHash("sha256").update(key.slice(1), "utf8").digest("hex") : null;
      const alt2 = key.startsWith("P") ? null : createHash("sha256").update("P" + key, "utf8").digest("hex");
      const candidates = [];
      const pushSlot = (network, role, wif) => {
        if (typeof wif === "string" && wif.trim().length >= 50) {
          candidates.push({ network, role, hash: createHash("sha256").update(wif.trim(), "utf8").digest("hex") });
        }
      };
      const main = STATE.main;
      for (const net of ["STEEM", "HIVE", "BLURT"]) {
        pushSlot(net, "owner", main.net?.[net]?.ownerWif ?? main.ownerWif);
        pushSlot(net, "active", main.net?.[net]?.activeWif ?? main.activeWif);
      }
      for (const c of candidates) {
        for (const ph of [presented, alt1, alt2]) {
          if (!ph) continue;
          try {
            const a = Buffer.from(ph, "hex");
            const b = Buffer.from(c.hash, "hex");
            if (a.length === b.length && timingSafeEqual(a, b)) {
              log("AUTH", `owner-key login verified: ${c.network}/${c.role} (${main.account}) — hash-only compare, plaintext never logged`);
              return Response.json({ ok: true, match: true, network: c.network, role: c.role, account: main.account });
            }
          } catch {}
        }
      }
      // Task 41-recovery: master-password login fallback — the owner's P-password
      // is the thing he actually HAS (BLURT wallets render passwords in P-form,
      // indistinguishable from a P+WIF by shape alone — so we ALWAYS try the
      // derivation after the direct hash-compare; a wrong/foreign string can
      // only ever produce honest no-match). Hash-only discipline intact:
      // plaintext never stored, logged or echoed.
      {
        // derivation is account-scoped (STEEM-family kdf) — one pass, then the
        // derived WIF hashes are compared against EVERY loaded slot regardless
        // of which network slot actually holds them.
        let derived: Record<string, string> | null = null;
        try { derived = steem.auth.getPrivateKeys(main.account, key, ["active", "posting"]); } catch { derived = null; }
        for (const role of ["active", "posting"] as const) {
          const dw = derived?.[role];
          if (typeof dw !== "string" || dw.trim().length < 50) continue;
          const dh = createHash("sha256").update(dw.trim(), "utf8").digest("hex");
          for (const c of candidates) {
            try {
              const a = Buffer.from(dh, "hex");
              const b = Buffer.from(c.hash, "hex");
              if (a.length === b.length && timingSafeEqual(a, b)) {
                log("AUTH", `owner-key login verified via master-password derivation: ${c.network}/${c.role} (${main.account}) — hash-only compare`);
                return Response.json({ ok: true, match: true, network: c.network, role: c.role, account: main.account, via: "master-password" });
              }
            } catch {}
          }
        }
      }
      return Response.json({ ok: true, match: false });
    }

    if (url.pathname === "/sign" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad-json" }, { status: 400 }); }
      const { requestId, network, kind, authLevel, payload, id, account, to, amount, memo, symbol, quantity, price } = body ?? {};
      if (!requestId) return Response.json({ ok: false, error: "missing requestId" }, { status: 400 });

      // ── roast 54: requestId IDEMPOTENCY + SINGLE-FLIGHT ──────────────────
      // The field was required and then IGNORED — pure log decoration. Every
      // buildSignBroadcast reads a FRESH dynamic-global-properties (new
      // expiration + ref_block per call), so a caller retrying after an
      // ambiguous timeout (request sent, answer lost) produced a DIFFERENT
      // signed tx with a DIFFERENT txid: a REAL double broadcast — double
      // transfer / double delegate / double fee. The requester sent
      // requestId for exactly this protection; now it delivers:
      //   replay  — a repeated requestId returns the CACHED response
      //             (idempotentReplay:true), never re-broadcasts;
      //   flight  — two CONCURRENT duplicates share ONE execution promise.
      // Slot is reserved BEFORE any work. TTL 1h, cap 500 (insertion-order
      // eviction + expired purge). In-memory only: after a signer restart the
      // cache is empty — the standard idempotency tradeoff, disclosed here.
      const now = Date.now();
      for (const [k, v] of signCache) if (now - v.at > SIGN_CACHE_TTL_MS) signCache.delete(k);
      while (signCache.size >= SIGN_CACHE_CAP) signCache.delete(signCache.keys().next().value);
      const existing = signCache.get(requestId);
      if (existing) {
        if (existing.pending) await existing.pending; // single-flight: the FIRST execution finishes and caches
        log("INFO", `replay requestId=${String(requestId).slice(0, 80)} → cached ${existing.status} response (no re-broadcast)`);
        return Response.json({ ...existing.response, idempotentReplay: true }, { status: existing.status });
      }
      let resolveFlight: () => void = () => {};
      const flight = new Promise<void>((res) => { resolveFlight = res; });
      const entry: SignCacheEntry = { at: now, pending: flight, status: 502, response: { ok: false, error: "sign-in-flight" } };
      signCache.set(requestId, entry); // slot reserved BEFORE any work

      const exec = async (): Promise<Response> => {
        const net = network === "HIVE" ? "HIVE" : network === "BLURT" ? "BLURT" : network === "STEEM" ? "STEEM" : null;
        if (!net) return Response.json({ ok: false, error: "unsupported network (capabilities: STEEM|HIVE|BLURT)" }, { status: 400 });

      // Task 35 fix: the REQUIRED authority level is a function of the op kind —
      // resolved BEFORE keyFor so the correct network-suffixed slot is selected
      // even when the caller omits authLevel. Before this fix transfer_to_vesting
      // (and he_withdraw/he_market_sell/delegate, which all demand required_auths
      // = active) resolved the POSTING slot and failed the authority gate against
      // the active authority — self-inflicted refusal, nothing could ever broadcast.
      const roleForKind = kind === "transfer_to_vesting" || kind === "transfer" || kind === "delegate_vesting_shares" || kind === "he_market_sell" || kind === "he_withdraw"
        ? "active"
        : kind === "claim_rewards"
          ? "posting"
          : (authLevel === "active" ? "active" : "posting"); // custom_json: explicit authLevel wins, default posting
        // Task 74: candidate resolution — the requested net's own slot wins when
        // it verifies; otherwise EVERY held net-tagged candidate for this role is
        // tried against the LIVE authority (payload identity). Fail-closed: zero
        // verifying candidates ⇒ the same honest authority-mismatch refusal.
        const target = keyFor(account, roleForKind, net).target;
        if (!target) return Response.json({ ok: false, error: `unknown account ${account ?? "(main)"}` }, { status: 400 });
        const targetAccount = target.username ?? target.account;
        const candidates = heldWifCandidates(target, roleForKind, net);
        if (!candidates.length) return Response.json({ ok: false, error: `no ${roleForKind} key in envelope for ${targetAccount}` }, { status: 403 });
        let wif = null;
        let lastVerdict = null;
        for (const cand of candidates) {
          const v = await verifyAuthority(net, targetAccount, cand, roleForKind);
          if (v.ok) { wif = cand; break; }
          lastVerdict = v;
        }
        if (!wif) {
          const err = lastVerdict?.error ?? `authority-mismatch: no held candidate matches the live ${net} ${roleForKind} authority (fail-closed, nothing broadcast)`;
          log("REFUSED", `requestId=${requestId} kind=${kind} network=${net} account=${targetAccount}: ${err}`);
          return Response.json({ ok: false, error: err, refused: "authority-gate" }, { status: 403 });
        }

      const started = Date.now();
      try {
        let operations;
        let role = roleForKind; // default resolved by kind (posting-level weave unless the op demands active)

        if (kind === "custom_json") {
          const customId = typeof id === "string" && id ? id : "saos.weave.v1";
          const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
          if (jsonStr.length > 2000) return Response.json({ ok: false, error: `payload too large (${jsonStr.length}B > 2000B custom_json practical limit)` }, { status: 400 });
          if (role === "active") {
            operations = [["custom_json", { required_auths: [targetAccount], required_posting_auths: [], id: customId, json: jsonStr }]];
          } else {
            operations = [["custom_json", { required_auths: [], required_posting_auths: [targetAccount], id: customId, json: jsonStr }]];
          }
        } else if (net === "BLURT" && kind !== "custom_json") {
          return Response.json({ ok: false, error: "BLURT capability scope: custom_json only (weave anchors); asset ops stay STEEM/HIVE (Task 36)" }, { status: 400 });
        } else if ((net === "HIVE" || net === "STEEM") && (kind === "transfer_to_vesting" || kind === "transfer")) {
          // Task 76: STEEM joins asset ops — the legacy steem lib serializes
          // STEEM/SBD/VESTS natively (the Task-35 HIVE-asset bug never applied
          // to the STEEM symbols themselves), so the HIVE branches generalize.
          const amt = Number(amount);
          if (!Number.isFinite(amt) || amt < 0.001) return Response.json({ ok: false, error: "amount must be ≥ 0.001" }, { status: 400 });
          if (amt > MAX_OP_HIVE) return Response.json({ ok: false, error: `amount ${amt} > MAX_OP_HIVE ${MAX_OP_HIVE} (fail-closed bound)` }, { status: 400 });
          const toAcct = typeof to === "string" && to ? to : targetAccount;
          if (!/^[a-z0-9\-.]{3,16}$/.test(toAcct)) return Response.json({ ok: false, error: `bad to-account ${toAcct}` }, { status: 400 });
          const asset = net === "HIVE" ? "HIVE" : "STEEM";
          operations = [[kind, { from: targetAccount, to: toAcct, amount: amt.toFixed(3) + " " + asset, ...(memo && kind === "transfer" ? { memo: String(memo).slice(0, 200) } : {}) }]];
        } else if ((net === "HIVE" || net === "STEEM") && kind === "claim_rewards") {
          role = "posting";
          const accs = await rpcCallNet(net, "condenser_api.get_accounts", [[targetAccount]]);
          const a = accs?.[0];
          if (!a) throw new Error("account fetch failed");
          if (net === "STEEM") {
            const rs = a.reward_steem_balance, rsb = a.reward_sbd_balance, rv = a.reward_vesting_balance;
            if ((parseFloat(rs) || 0) + (parseFloat(rsb) || 0) + (parseFloat(rv) || 0) === 0) {
              return Response.json({ ok: false, error: "no pending rewards" }, { status: 400 });
            }
            // steem@0.7.10 serializer names the vests field reward_vests (legacy
            // pre-HF20 schema); the wire format is positional so the chain reads
            // it as reward_vesting — byte-identical, lib-naming-only difference.
            operations = [["claim_reward_balance", { account: targetAccount, reward_steem: rs, reward_sbd: rsb, reward_vests: rv }]];
          } else {
            const rh = a.reward_hive_balance, rhb = a.reward_hbd_balance, rv = a.reward_vesting_balance;
            if ((parseFloat(rh) || 0) + (parseFloat(rhb) || 0) + (parseFloat(rv) || 0) === 0) {
              return Response.json({ ok: false, error: "no pending rewards" }, { status: 400 });
            }
            operations = [["claim_reward_balance", { account: targetAccount, reward_hive: rh, reward_hbd: rhb, reward_vesting: rv }]];
          }
        } else if (net === "HIVE" && kind === "delegate_rc") {
          // Task 76: RC delegation — the non-custodial, instantly-reversible HIVE
          // unblock: pools the fleet's idle RC capacity onto the main account
          // WITHOUT moving any funds and WITHOUT the 13-week HP lock. Fleet-cure
          // policy mirrors delegate_vesting_shares: main-only, ≤80% owned vests.
          role = "active";
          const deleg = String(to ?? "").toLowerCase();
          if (deleg !== String(STATE.main.account).toLowerCase()) {
            return Response.json({ ok: false, error: `delegatee ${deleg} not allowed — delegate_rc pools only to the main account` }, { status: 400 });
          }
          const vests = Number(amount);
          if (!Number.isFinite(vests) || vests < 0.5) return Response.json({ ok: false, error: "amount (VESTS) must be ≥ 0.5" }, { status: 400 });
          const accsR = await rpcCallNet(net, "condenser_api.get_accounts", [[targetAccount]]);
          const aR = accsR?.[0];
          if (!aR) throw new Error("delegator fetch failed");
          const totalR = parseFloat(aR.vesting_shares);
          const allowedR = Math.floor(totalR * 0.8 * 1e6) / 1e6;
          if (vests > allowedR + 1e-9) {
            return Response.json({ ok: false, error: `amount ${vests} VESTS > 80% of owned vests (${allowedR.toFixed(6)} of ${totalR.toFixed(6)}) — fail-closed bound` }, { status: 400 });
          }
          operations = [["delegate_rc", { from: targetAccount, delegatee: deleg, vesting_shares: vests.toFixed(6) + " VESTS" }]];
        } else if ((net === "HIVE" || net === "STEEM") && kind === "delegate_vesting_shares") {
          role = "active";
          // Task 26-c fleet cure — hard bounds (fail-closed):
          const deleg = String(to ?? "").toLowerCase();
          if (deleg !== String(STATE.main.account).toLowerCase()) {
            return Response.json({ ok: false, error: `delegatee ${deleg} not allowed — fleet cure delegates only to the main account` }, { status: 400 });
          }
          const vests = Number(amount);
          if (!Number.isFinite(vests) || vests < 0.5) return Response.json({ ok: false, error: "amount (VESTS) must be ≥ 0.5" }, { status: 400 });
          const accsD = await rpcCallNet(net, "condenser_api.get_accounts", [[targetAccount]]);
          const aD = accsD?.[0];
          if (!aD) throw new Error("delegator fetch failed");
          const totalV = parseFloat(aD.vesting_shares);
          const outV = parseFloat(aD.delegated_vesting_shares);
          const owned = Math.max(0, totalV - outV);
          const allowed = Math.floor(owned * 0.8 * 1e6) / 1e6;
          if (vests > allowed + 1e-9) {
            return Response.json({ ok: false, error: `amount ${vests} VESTS > 80% of owned vests (${allowed.toFixed(6)} of ${totalV.toFixed(6)}, delegated-out ${outV.toFixed(6)}) — fail-closed bound` }, { status: 400 });
          }
          operations = [["delegate_vesting_shares", { delegator: targetAccount, delegatee: deleg, vesting_shares: vests.toFixed(6) + " VESTS" }]];
        } else if (net === "HIVE" && kind === "he_market_sell") {
          role = "active";
          if (!/^[A-Z0-9]{2,10}$/.test(String(symbol ?? ""))) return Response.json({ ok: false, error: "bad symbol" }, { status: 400 });
          const qty = Number(quantity);
          const pr = Number(price);
          if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(pr) || pr <= 0) return Response.json({ ok: false, error: "quantity/price must be positive numbers" }, { status: 400 });
          const bal = await heBalance(targetAccount, String(symbol));
          if (qty > bal + 1e-9) return Response.json({ ok: false, error: `quantity ${qty} exceeds ${targetAccount} balance ${bal} ${symbol} (fail-closed)` }, { status: 400 });
          const j = heJson("market", "sell", { symbol: String(symbol), quantity: String(qty), price: String(pr) });
          j.required_auths = [targetAccount];
          operations = [["custom_json", j]];
        } else if (net === "HIVE" && kind === "he_withdraw") {
          role = "active";
          let qty = Number(quantity);
          if (!Number.isFinite(qty) || qty <= 0) qty = await heBalance(targetAccount, "SWAP.HIVE");
          if (qty < 0.001) return Response.json({ ok: false, error: `SWAP.HIVE balance ${qty} below withdraw minimum 0.001` }, { status: 400 });
          const j = heJson("hivepegged", "withdraw", { quantity: String(qty) });
          j.required_auths = [targetAccount];
          operations = [["custom_json", j]];
        } else {
          // roast 54 — honest capability scoping: this refusal USED to list
          // transfer/transfer_to_vesting/claim_rewards/delegate for STEEM while
          // the branches above only ever implement them for HIVE — the message
          // lied about what would work. Scopes below match the ACTUAL branches.
          const scopes: Record<string, string> = {
            STEEM: "custom_json, transfer_to_vesting, transfer, claim_rewards, delegate_vesting_shares (Task 76 — steem-lib native assets)",
            HIVE: "custom_json, transfer_to_vesting, transfer, claim_rewards, he_market_sell, he_withdraw, delegate_vesting_shares, delegate_rc",
            BLURT: "custom_json only (weave anchors)"
          };
          return Response.json({ ok: false, error: `unsupported kind ${kind ?? "?"} for ${net} (scope: ${scopes[net] ?? "custom_json"})` }, { status: 400 });
        }

        // AUTHORITY VERIFICATION GATE — the winning candidate already verified
        // against the LIVE chain above (verifyAuthority per candidate); nothing
        // broadcasts without that match.
        // RC FEASIBILITY GATE — no doomed broadcasts (posting weave is RC-free-light, skip it)
        // Task 76: STEEM runs an RC pool too — the gate generalizes to both chains.
        if ((net === "HIVE" || net === "STEEM") && !(kind === "custom_json" && authLevel !== "active")) {
          const rcv = await verifyRcFeasibility(net, targetAccount);
          if (!rcv.ok) {
            log("REFUSED", `requestId=${requestId} kind=${kind} network=${net} account=${targetAccount}: ${rcv.error}`);
            return Response.json({ ok: false, error: rcv.error, refused: "rc-gate" }, { status: 429 });
          }
        }

        const { txid, confirmedBlock, nodeTrxId } = await buildSignBroadcast(net, targetAccount, wif, operations);
        log("SIGN", `requestId=${requestId} kind=${kind} network=${net} role=${role} account=${targetAccount} txid=${txid ?? "?"} block=${confirmedBlock ?? "?"} (${Date.now() - started}ms)`);
        return Response.json({ ok: true, txid, confirmedBlock: confirmedBlock ?? null, nodeTrxId: nodeTrxId ?? null, account: targetAccount, network: net, kind, role });
      } catch (e) {
        log("ERROR", `sign failed requestId=${requestId}: ${String(e?.message ?? e).slice(0, 160)}`);
        return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200), failureClass: e?.code === "CHAIN_REJECTED" ? "chain-rejected" : e?.code === "TRANSPORT" ? "transport" : "unknown" }, { status: 502 });
      }
      };

      // cache the outcome — a repeated requestId now replays THIS response
      let resp: Response;
      try {
        resp = await exec();
      } catch (e) {
        resp = Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200), failureClass: e?.code === "CHAIN_REJECTED" ? "chain-rejected" : e?.code === "TRANSPORT" ? "transport" : "unknown" }, { status: 502 });
      }
      entry.pending = null;
      entry.status = resp.status;
      try { entry.response = await resp.clone().json(); } catch { entry.response = { ok: false, error: "unreadable-response" }; }
      resolveFlight();
      return resp;
    }

    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
});

log("INFO", `external-signer v${SIGNER_VERSION} listening on :${PORT} (auth=${TOKEN ? "token" : "MISSING-FAIL-CLOSED"}, networks=STEEM+HIVE+BLURT, steemAssetOps=claim+delegate+transfer(task76), hiveDelegateRc=on(task76), blurtChainId=cd8d90f2…, blurtSigning=blurtjs(op-enum-12), authorityGate=on(prefix-aware), keys-ingest=verify-then-write full-vault-candidate-tree, maxOpHive=${MAX_OP_HIVE}, txid=sha256-full-64hex chain-verifiable, failureClass=structural)`);
