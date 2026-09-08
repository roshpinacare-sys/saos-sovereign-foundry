/**
 * external-signer (:3033) — Task 26, owner directive "connect and execute".
 * =============================================================================
 * The golden architecture (docs/external-signer.md): the foundry SYSTEM never
 * holds keys — the signer is a SEPARATE process, outside the system boundary.
 * This service:
 *   - opens the sealed fleet envelope (SAOS-FLEET-VAULT-1, AES-256-GCM/scrypt)
 *     in memory at boot; keys NEVER leave this process, never logged, never
 *     served by any endpoint;
 *   - GET  /health (Bearer) → public inventory only: account NAMES, networks,
 *     sealedAt — what the foundry needs to mark external=connected;
 *   - POST /sign    (Bearer) → {requestId, network, kind, payload, account?}
 *     signs the foundry's prepared payload and broadcasts it, returning ONLY
 *     the public {txid}. The foundry records the txid; keys never cross.
 *
 * Iron rules mirrored from AGENTS.md: zero secret values in logs/responses;
 * fail-closed when the envelope or token is missing; loud audit lines with
 * public data only (requestId/network/txid/account-name).
 *
 * Owner authority: keys-access directive 2026-09-08 + "connect and execute"
 * (2026-09-08). DEV-phase environment, private repos, test network.
 */

import Bun from "bun";
import { createDecipheriv, scryptSync, timingSafeEqual, createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, appendFileSync } from "fs";
import path from "path";

const PORT = Number(process.env.SIGNER_PORT ?? 3033);
const MAGIC = "SAOS-FLEET-VAULT-1";
const LOG = path.join(import.meta.dir, "signer.log");
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
    if (existsSync(path.join(dir, "fleet_keys.enc")) && existsSync(path.join(dir, "fleet_keys.meta.json"))) return dir;
  }
  return null;
}

function openSeal(dir) {
  const raw = readFileSync(path.join(dir, "fleet_keys.enc"), "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");
  const meta = JSON.parse(readFileSync(path.join(dir, "fleet_keys.meta.json"), "utf8"));
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);
  const key = scryptSync(meta.pass, salt, 32);
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
        .filter((a) => a?.username && a?.keys?.posting?.wif)
        .map((a) => ({ username: a.username, postingWif: a.keys.posting.wif, activeWif: a.keys?.active?.wif ?? null }));
    } catch {}
    STATE = { sealedAt: bundle.sealedAt ?? null, main: { account, postingWif: envOf.POSTING_WIF, activeWif: envOf.ACTIVE_WIF ?? null, memoWif: envOf.MEMO_WIF ?? null }, fleet };
    log("INFO", `envelope open: sealedAt=${STATE.sealedAt ?? "?"} main=${account} fleet=${fleet.length} accounts (values in-memory only, dir=${dir})`);
  } catch (e) {
    log("ERROR", `envelope open failed: ${String(e?.message ?? e).slice(0, 120)} — fail-closed`);
    STATE = null;
  }
}

loadState();

// ── steem broadcast via the battle-tested lib (same as saos-dex) ─────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only legacy lib
const steem = require("steem");
steem.api.setOptions({ url: process.env.STEEM_RPC ?? "https://api.steemit.com" });

function broadcastSteemCustomJson(wif, account, id, jsonStr) {
  return new Promise((resolve, reject) => {
    const requiredPostings = [account];
    const requiredAuths = [];
    steem.broadcast.customJson(wif, requiredAuths, requiredPostings, id, jsonStr, (err, result) => {
      if (err) reject(new Error(String(err?.message ?? err).slice(0, 200)));
      else resolve(result);
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future status endpoint
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
        networks: ["STEEM"],
        capabilities: ["custom_json"],
        version: "1.0.0"
      });
    }

    if (url.pathname === "/sign" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad-json" }, { status: 400 }); }
      const { requestId, network, kind, payload, id, account } = body ?? {};
      if (!requestId) return Response.json({ ok: false, error: "missing requestId" }, { status: 400 });
      if (network !== "STEEM") return Response.json({ ok: false, error: `unsupported network ${network} (capabilities: STEEM custom_json)` }, { status: 400 });
      const customId = typeof id === "string" && id ? id : "saos.weave.v1";
      const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
      if (jsonStr.length > 2000) return Response.json({ ok: false, error: `payload too large (${jsonStr.length}B > 2000B custom_json practical limit)` }, { status: 400 });
      const target = account && account !== STATE.main.account ? STATE.fleet.find((f) => f.username === account) : STATE.main;
      const wif = target ? (target === STATE.main ? target.postingWif : target.postingWif) : null;
      const targetAccount = target ? (target.username ?? target.account) : null;
      if (!target || !wif) return Response.json({ ok: false, error: `unknown account ${account ?? "(main)"}` }, { status: 400 });
      try {
        const started = Date.now();
        const result = await broadcastSteemCustomJson(wif, targetAccount, customId, jsonStr);
        const txid = result?.id ?? result?.transaction_id ?? null;
        log("SIGN", `requestId=${requestId} kind=${kind ?? "?"} network=STEEM op=${customId} account=${targetAccount} txid=${txid ?? "?"} (${Date.now() - started}ms)`);
        return Response.json({ ok: true, txid, account: targetAccount, network: "STEEM", id: customId });
      } catch (e) {
        log("ERROR", `sign failed requestId=${requestId}: ${String(e?.message ?? e).slice(0, 160)}`);
        return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
      }
    }

    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
});

log("INFO", `external-signer listening on :${PORT} (auth=${TOKEN ? "token" : "MISSING-FAIL-CLOSED"})`);
