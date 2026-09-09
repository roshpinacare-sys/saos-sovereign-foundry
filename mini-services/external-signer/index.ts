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
import { createDecipheriv, scryptSync, timingSafeEqual, createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, appendFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import path from "path";

const PORT = Number(process.env.SIGNER_PORT ?? 3033);
const MAGIC = "SAOS-FLEET-VAULT-1";
const LOG = path.join(import.meta.dir, "signer.log");
const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000";
const HIVE_RPC = process.env.HIVE_RPC ?? "https://api.hive.blog";
const STEEM_RPC = process.env.STEEM_RPC ?? "https://api.steemit.com";
const MAX_OP_HIVE = Number(process.env.SIGNER_MAX_OP_HIVE ?? 50);
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
  const metaJson = JSON.parse(readFileSync(path.join(dir, meta), "utf8"));
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);
  const key = scryptSync(metaJson.pass, salt, 32);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}

// ── in-memory key material (NEVER leaves this process) ───────────────────────
let STATE = null; // { sealedAt, main: {account, postingWif, activeWif, memoWif}, fleet: [{username, postingWif, activeWif}] }

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
      fleet = (vault.accounts ?? [])
        .filter((a) => a?.username && (a?.keys?.posting?.wif || a?.keys?.active?.wif))
        .map((a) => ({
          username: a.username,
          postingWif: a.keys?.posting?.wif ?? null,
          activeWif: a.keys?.active?.wif ?? null,
          net: {
            STEEM: { postingWif: a.keys?.posting?.wifSTEEM ?? null, activeWif: a.keys?.active?.wifSTEEM ?? null },
            HIVE: { postingWif: a.keys?.posting?.wifHIVE ?? null, activeWif: a.keys?.active?.wifHIVE ?? null }
          }
        }));
    } catch {}
    STATE = {
      sealedAt: bundle.sealedAt ?? null,
      main: {
        account,
        postingWif: envOf.POSTING_WIF,
        activeWif: envOf.ACTIVE_WIF ?? null,
        memoWif: envOf.MEMO_WIF ?? null,
        net: {
          STEEM: { postingWif: envOf.STEEM_POSTING_WIF ?? null, activeWif: envOf.STEEM_ACTIVE_WIF ?? null },
          HIVE: { postingWif: envOf.HIVE_POSTING_WIF ?? null, activeWif: envOf.HIVE_ACTIVE_WIF ?? null }
        }
      },
      fleet
    };
    log("INFO", `envelope open: sealedAt=${STATE.sealedAt ?? "?"} main=${account} fleet=${fleet.length} accounts (values in-memory only, dir=${dir})`);
  } catch (e) {
    log("ERROR", `envelope open failed: ${String(e?.message ?? e).slice(0, 120)} — fail-closed`);
    STATE = null;
  }
}

// ── Task 29: owner key ingestion (verify-then-write, self-protecting) ────────
function runVault(dir, arg) {
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
  const netTag = network === "HIVE" ? "HIVE" : "STEEM";
  setVar(`${netTag}_${role === "active" ? "ACTIVE" : "POSTING"}_WIF`, wif);
  writeFileSync(envPath, lines.join("\n") + "\n");
  chmodSync(envPath, 0o600);
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
  acc.keys[role][network === "HIVE" ? "wifHIVE" : "wifSTEEM"] = wif;
  writeFileSync(vPath, JSON.stringify(vault, null, 2));
  chmodSync(vPath, 0o600);
  const seal = runVault(dir, "--seal");
  if (!seal.ok) throw new Error(`vault seal failed: ${seal.out}`);
  return { sealedAt: new Date().toISOString(), sealOut: seal.out };
}

/**
 * Owner-key ingest core: verify against the LIVE chain authority of the fleet
 * accounts BEFORE anything is written. A key that matches no live authority is
 * refused with honest verdicts — only the true owner's key can ever land.
 */
async function ingestOwnerKey(network, wif) {
  const net = network === "HIVE" ? "HIVE" : "STEEM";
  let derived;
  try {
    derived = steem.auth.wifToPublic(wif);
  } catch {
    return { ok: false, verdict: { network: net, role: "active", derived: null, match: false, error: "wif derivation failed (not a valid private key)" } };
  }
  const candidates = [STATE.main.account, ...STATE.fleet.map((f) => f.username)].filter((v, i, a) => a.indexOf(v) === i);
  const checked = [];
  for (const acct of candidates) {
    try {
      const auth = await chainAuthorities(net, acct);
      const match = auth.active === derived;
      checked.push({ account: acct, match });
      if (match) return { ok: true, account: acct, derived };
    } catch (e) {
      checked.push({ account: acct, match: false, error: String(e?.message ?? e).slice(0, 120) });
    }
  }
  return { ok: false, verdict: { network: net, role: "active", derived, match: false, checked, error: `no live ${net} active authority matches the derived public key (nothing written)` } };
}

/** public-data view of a role slot — never any WIF material */
async function slotView(net, acct, wif, role) {
  if (!wif) return { loaded: false, role };
  let derived = null;
  try { derived = steem.auth.wifToPublic(wif); } catch {}
  let expected = null, match = null;
  try {
    const auth = await chainAuthorities(net, acct);
    expected = role === "active" ? auth.active : auth.posting;
    match = derived !== null && derived === expected;
  } catch { match = null; }
  return { loaded: true, role, derived, expected, match };
}

loadState();

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib (signing only)
const steem = require("steem");

// ── RPC (plain fetch, no lib url coupling) ───────────────────────────────────
async function rpcCall(node, method, params) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(node, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: ctl.signal
    });
    const json = await res.json();
    if (json.error) throw new Error(String(json.error.message ?? "rpc error").slice(0, 160));
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

function nodeFor(network) {
  return network === "HIVE" ? HIVE_RPC : STEEM_RPC;
}
function chainIdFor(network) {
  return network === "HIVE" ? HIVE_CHAIN_ID : null; // steem lib default = STEEM chain_id
}

// ── AUTHORITY VERIFICATION GATE (fail-closed, names/pubkeys only) ────────────
const authCache = new Map(); // `${network}:${account}` → { at, posting, active }
async function chainAuthorities(network, account) {
  const k = `${network}:${account}`;
  const hit = authCache.get(k);
  if (hit && Date.now() - hit.at < AUTH_CACHE_TTL_MS) return hit;
  const accs = await rpcCall(nodeFor(network), "condenser_api.get_accounts", [[account]]);
  const a = accs?.[0];
  if (!a) throw new Error(`account ${account} not found on ${network}`);
  const out = { at: Date.now(), posting: a.posting.key_auths[0][0], active: a.active.key_auths[0][0] };
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
  if (derived !== expected) {
    return {
      ok: false,
      error: `authority-mismatch: ${account} envelope-${role} derives ${derived.slice(0, 11)}… but ${network} ${role} authority is ${expected.slice(0, 11)}… (fail-closed, nothing broadcast)`,
      derived,
      expected
    };
  }
  return { ok: true, derived };
}

// RC feasibility (Task 27): one op costs ~124M RC (measured live via lsa's
// rejected withdraw). Refuse doomed broadcasts with an honest ETA instead.
const RC_OP_COST = 1.5e8;
async function verifyRcFeasibility(network, account) {
  try {
    const rc = await rpcCall(nodeFor(network), "rc_api.find_rc_accounts", { accounts: [account] });
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
  const net = network === "HIVE" ? "HIVE" : "STEEM";
  const target = isMain ? STATE.main : STATE.fleet.find((f) => f.username === account);
  if (!target) return { target: null, wif: null, targetAccount: account ?? STATE.main.account };
  const generic = authLevel === "active" ? (target.activeWif ?? null) : (target.postingWif ?? null);
  const suffixed = target?.net?.[net] ? (authLevel === "active" ? (target.net[net].activeWif ?? null) : (target.net[net].postingWif ?? null)) : null;
  const wif = suffixed ?? generic;
  return { target, wif, targetAccount: target.username ?? target.account };
}

// ── build + sign + broadcast (transport 1:1 from he_powerup.cjs — proven) ────
async function buildSignBroadcast(network, account, wif, operations) {
  const dgp = await rpcCall(nodeFor(network), "condenser_api.get_dynamic_global_properties", []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000).toISOString().slice(0, 19),
    operations,
    extensions: []
  };
  const prev = steem.config.get("chain_id");
  const cid = chainIdFor(network);
  if (cid) steem.config.set("chain_id", cid);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [wif]);
  } finally {
    if (cid) steem.config.set("chain_id", prev);
  }
  const result = await rpcCall(nodeFor(network), "condenser_api.broadcast_transaction", [signed]);
  return { txid: signed?.id ?? null, result };
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
        networks: ["STEEM", "HIVE"],
        capabilities: ["custom_json", "transfer_to_vesting", "transfer", "claim_rewards", "he_market_sell", "he_withdraw", "delegate_vesting_shares", "keys-ingest"],
        authorityGate: "verify-before-broadcast (fail-closed)",
        maxOpHive: MAX_OP_HIVE,
        version: "2.2.0"
      });
    }

    // ── Task 29: owner key entry point (self-protecting: only a live authority match is ever written) ──
    if (url.pathname === "/keys/status" && req.method === "GET") {
      try {
        const mainNet = {};
        for (const net of ["STEEM", "HIVE"]) {
          mainNet[net] = {
            posting: await slotView(net, STATE.main.account, STATE.main.net?.[net]?.postingWif ?? STATE.main.postingWif, "posting"),
            active: await slotView(net, STATE.main.account, STATE.main.net?.[net]?.activeWif ?? STATE.main.activeWif, "active")
          };
        }
        const fleet = [];
        for (const f of STATE.fleet) {
          fleet.push({
            username: f.username,
            posting: f.postingWif ? { loaded: true } : { loaded: false },
            active: f.activeWif ? { loaded: true } : { loaded: false }
          });
        }
        return Response.json({ ok: true, main: { account: STATE.main.account, networks: mainNet }, fleet, sealedAt: STATE.sealedAt, version: "2.2.0" });
      } catch (e) {
        return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
      }
    }

    if (url.pathname === "/keys/ingest" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad-json" }, { status: 400 }); }
      const raw = JSON.stringify(body ?? {});
      if (raw.length > 8192) return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
      const entries = Array.isArray(body?.entries) ? body.entries.slice(0, 4)
        : (body?.wif ? [{ network: body.network, wif: body.wif }] : []);
      if (!entries.length) return Response.json({ ok: false, error: "missing entries [{network, wif}]" }, { status: 400 });
      const ingested = [], refused = [];
      for (const ent of entries) {
        const network = ent?.network === "HIVE" ? "HIVE" : ent?.network === "STEEM" ? "STEEM" : null;
        const wif = typeof ent?.wif === "string" ? ent.wif.trim() : "";
        if (!network || !wif) { refused.push({ network: ent?.network ?? "?", error: "missing network or wif" }); continue; }
        const res = await ingestOwnerKey(network, wif);
        if (res.ok) {
          try {
            const dir = resolveEnvelopeDir();
            const sealInfo = writeIngestedKey(dir, res.account, network, wif, "active");
            loadState(); // hot-reload in-memory keys from the re-sealed envelope
            log("INGEST", `network=${network} account=${res.account} role=active MATCH — written to runtime layout, envelope re-sealed (${sealInfo.sealOut || "ok"})`);
            ingested.push({ account: res.account, network, role: "active", derived: res.derived, sealedAt: sealInfo.sealedAt });
          } catch (e) {
            log("ERROR", `ingest write failed network=${network}: ${String(e?.message ?? e).slice(0, 160)}`);
            refused.push({ network, error: `verify-ok but write failed (fail-closed): ${String(e?.message ?? e).slice(0, 160)}` });
          }
        } else {
          log("REFUSED", `ingest network=${network}: ${res.verdict?.error ?? "no match"}`);
          refused.push(res.verdict);
        }
      }
      return Response.json({ ok: ingested.length > 0, ingested, refused, sealedAt: STATE?.sealedAt ?? null });
    }

    if (url.pathname === "/sign" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad-json" }, { status: 400 }); }
      const { requestId, network, kind, authLevel, payload, id, account, to, amount, memo, symbol, quantity, price } = body ?? {};
      if (!requestId) return Response.json({ ok: false, error: "missing requestId" }, { status: 400 });
      const net = network === "HIVE" ? "HIVE" : network === "STEEM" ? "STEEM" : null;
      if (!net) return Response.json({ ok: false, error: "unsupported network (capabilities: STEEM|HIVE)" }, { status: 400 });

      const { target, wif, targetAccount } = keyFor(account, authLevel === "active" ? "active" : "posting", net);
      if (!target) return Response.json({ ok: false, error: `unknown account ${account ?? "(main)"}` }, { status: 400 });

      const started = Date.now();
      try {
        let operations;
        let role = "posting"; // default: posting-level (weave)

        if (kind === "custom_json") {
          const customId = typeof id === "string" && id ? id : "saos.weave.v1";
          const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
          if (jsonStr.length > 2000) return Response.json({ ok: false, error: `payload too large (${jsonStr.length}B > 2000B custom_json practical limit)` }, { status: 400 });
          if (authLevel === "active") {
            role = "active";
            operations = [["custom_json", { required_auths: [targetAccount], required_posting_auths: [], id: customId, json: jsonStr }]];
          } else {
            operations = [["custom_json", { required_auths: [], required_posting_auths: [targetAccount], id: customId, json: jsonStr }]];
          }
        } else if (net === "HIVE" && (kind === "transfer_to_vesting" || kind === "transfer")) {
          role = "active";
          const amt = Number(amount);
          if (!Number.isFinite(amt) || amt < 0.001) return Response.json({ ok: false, error: "amount must be ≥ 0.001" }, { status: 400 });
          if (amt > MAX_OP_HIVE) return Response.json({ ok: false, error: `amount ${amt} > MAX_OP_HIVE ${MAX_OP_HIVE} (fail-closed bound)` }, { status: 400 });
          const toAcct = typeof to === "string" && to ? to : targetAccount;
          if (!/^[a-z0-9\-.]{3,16}$/.test(toAcct)) return Response.json({ ok: false, error: `bad to-account ${toAcct}` }, { status: 400 });
          const asset = kind === "transfer_to_vesting" ? "HIVE" : "HIVE";
          operations = [[kind, { from: targetAccount, to: toAcct, amount: amt.toFixed(3) + " " + asset, ...(memo && kind === "transfer" ? { memo: String(memo).slice(0, 200) } : {}) }]];
        } else if (net === "HIVE" && kind === "claim_rewards") {
          role = "posting";
          const accs = await rpcCall(nodeFor(net), "condenser_api.get_accounts", [[targetAccount]]);
          const a = accs?.[0];
          if (!a) throw new Error("account fetch failed");
          const rh = a.reward_hive_balance, rhb = a.reward_hbd_balance, rv = a.reward_vesting_balance;
          if ((parseFloat(rh) || 0) + (parseFloat(rhb) || 0) + (parseFloat(rv) || 0) === 0) {
            return Response.json({ ok: false, error: "no pending rewards" }, { status: 400 });
          }
          operations = [["claim_reward_balance", { account: targetAccount, reward_hive: rh, reward_hbd: rhb, reward_vesting: rv }]];
        } else if (net === "HIVE" && kind === "delegate_vesting_shares") {
          role = "active";
          // Task 26-c fleet cure — hard bounds (fail-closed):
          const deleg = String(to ?? "").toLowerCase();
          if (deleg !== String(STATE.main.account).toLowerCase()) {
            return Response.json({ ok: false, error: `delegatee ${deleg} not allowed — fleet cure delegates only to the main account` }, { status: 400 });
          }
          const vests = Number(amount);
          if (!Number.isFinite(vests) || vests < 0.5) return Response.json({ ok: false, error: "amount (VESTS) must be ≥ 0.5" }, { status: 400 });
          const accsD = await rpcCall(nodeFor(net), "condenser_api.get_accounts", [[targetAccount]]);
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
          return Response.json({ ok: false, error: `unsupported kind ${kind ?? "?"} for ${net} (allowlist: custom_json, transfer_to_vesting, transfer, claim_rewards, he_market_sell, he_withdraw, delegate_vesting_shares)` }, { status: 400 });
        }

        // AUTHORITY VERIFICATION GATE — nothing broadcasts without a live match
        const verdict = await verifyAuthority(net, targetAccount, wif, role);
        if (!verdict.ok) {
          log("REFUSED", `requestId=${requestId} kind=${kind} network=${net} account=${targetAccount}: ${verdict.error}`);
          return Response.json({ ok: false, error: verdict.error, refused: "authority-gate" }, { status: 403 });
        }
        // RC FEASIBILITY GATE — no doomed broadcasts (posting weave is RC-free-light, skip it)
        if (net === "HIVE" && !(kind === "custom_json" && authLevel !== "active")) {
          const rcv = await verifyRcFeasibility(net, targetAccount);
          if (!rcv.ok) {
            log("REFUSED", `requestId=${requestId} kind=${kind} network=${net} account=${targetAccount}: ${rcv.error}`);
            return Response.json({ ok: false, error: rcv.error, refused: "rc-gate" }, { status: 429 });
          }
        }

        const { txid } = await buildSignBroadcast(net, targetAccount, wif, operations);
        log("SIGN", `requestId=${requestId} kind=${kind} network=${net} role=${role} account=${targetAccount} txid=${txid ?? "?"} (${Date.now() - started}ms)`);
        return Response.json({ ok: true, txid, account: targetAccount, network: net, kind, role });
      } catch (e) {
        log("ERROR", `sign failed requestId=${requestId}: ${String(e?.message ?? e).slice(0, 160)}`);
        return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
      }
    }

    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
});

log("INFO", `external-signer v2.2 listening on :${PORT} (auth=${TOKEN ? "token" : "MISSING-FAIL-CLOSED"}, networks=STEEM+HIVE, authorityGate=on, keys-ingest=verify-then-write, maxOpHive=${MAX_OP_HIVE})`);
