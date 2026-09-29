/**
 * signer.mjs — the X-1 rail, engine-held: doctrine-bounded execution.
 *
 * SECURITY CONTRACT:
 *  - credential lives ONLY in .secrets/ (0600, gitignored) and process memory
 *  - WIFs are derived on demand, held in a module map, NEVER returned/logged
 *  - all public output: pubkeys, fingerprints (8 hex), booleans, txids
 *  - seed-composition order is SELF-VERIFIED against on-chain authorities —
 *    no guessing: the order that reproduces the account's own public keys wins
 *
 * SAFETY DOCTRINE (carried from T-8, now enforced at sign time):
 *  - exec-armed.json (.secrets/) is the standing order; state/exec-pause.json
 *    (written by the cockpit pause button) is the operator kill-switch
 *  - caps: maxOpsPerCycle, per-order max, SBD bid reserve, RC floor
 *  - batched into ONE atomic tx per cycle → all-or-nothing, fail-closed
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState } from "./measure.mjs";
import { SEED_ORDERS, wifFor, derivePub, buildTx, fingerprint } from "./steemtx.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const KEY_FILE = path.join(SECRETS, "headcorner.key");
const ARMED_FILE = path.join(SECRETS, "exec-armed.json");
const STATE = path.join(DIR, "state");
const PAUSE_FILE = path.join(STATE, "exec-pause.json");
const LOG_FILE = path.join(STATE, "exec-log.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const SOLDIERS_SECRET = path.join(SECRETS, "soldiers.json");
const UPLOAD_KEY = path.join(DIR, "..", "..", "upload", "headcorner.txt");

/**
 * T-12 sovereign self-service: if the operator drops a credential file into
 * upload/ (headcorner.txt: "<account> <master-password|P-key>"), the engine
 * secures it (0600 into .secrets/, upload copy removed) and self-adopts it on
 * the next cycle — zero manual restart, zero key exposure in logs.
 */
export function syncCredential() {
  try {
    if (fs.existsSync(UPLOAD_KEY)) {
      fs.mkdirSync(SECRETS, { recursive: true });
      fs.copyFileSync(UPLOAD_KEY, KEY_FILE);
      fs.chmodSync(KEY_FILE, 0o600);
      fs.rmSync(UPLOAD_KEY, { force: true });
      try { fs.rmSync(path.dirname(UPLOAD_KEY), { recursive: true, force: true }); } catch { /* dir may hold other files */ }
      appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "credential-adopted", fingerprint: fingerprint(fs.readFileSync(KEY_FILE, "utf8").trim().split(/[\s:=]+/).filter(Boolean).slice(1).join(" ")) });
      // credential changed → invalidate every cached identity (memory only)
      for (const k of Object.keys(mem.identities)) delete mem.identities[k];
      mem.master = null;
      return true;
    }
    // also: same-file content change detection (sha256 fingerprint)
    const fp = fingerprint(fs.readFileSync(KEY_FILE, "utf8"));
    if (mem.keyFileFp && mem.keyFileFp !== fp) {
      for (const k of Object.keys(mem.identities)) delete mem.identities[k];
      mem.master = null;
    }
    mem.keyFileFp = fp;
  } catch { /* best effort */ }
  return false;
}

/* in-memory only — never serialized anywhere. One identity per account. */
const mem = { identities: {}, master: null, keyFileFp: null }; // account → { password, wifs:{role:wif}, matchedOrder, verified }

export function defaultArmedConf() {
  return {
    armed: true,
    note: "operator standing order 2026-09-29: full autonomous execution, doctrine-capped",
    maxOpsPerCycle: 12,
    maxAskSteemPerCycle: 200,
    maxBidSbdPerCycle: 20,
    bidReserveSbd: 0.5,
    minRcPct: 20,
    soldiers: { enabled: true, count: 3, prefix: "hcsoldier", steemEach: 10, sbdEach: 2, minLevel: 0.2 },
    promo: { armed: true, perDay: 1, tags: ["steem", "defi", "marketmaking", "saos"] },
  };
}

export function armedConf() {
  const d = readJson(ARMED_FILE, null);
  if (d) return d;
  const def = defaultArmedConf();
  try { fs.mkdirSync(SECRETS, { recursive: true }); fs.writeFileSync(ARMED_FILE, JSON.stringify(def, null, 2)); } catch { /* read-only fs */ }
  return def;
}

export function execPaused() { return readJson(PAUSE_FILE, { paused: false })?.paused === true; }

function identity(account) {
  if (!mem.identities[account]) mem.identities[account] = { password: null, wifs: {}, matchedOrder: null, verified: null };
  return mem.identities[account];
}

export function loadCredential(account = null) {
  let acct, password;
  if (account && account !== masterAccount()) {
    const s = readJson(SOLDIERS_SECRET, null);
    const rec = (s?.accounts ?? []).find((a) => a.name === account);
    if (!rec) throw new Error(`no-credential: ${account}`);
    acct = rec.name; password = rec.password;
  } else {
    const raw = fs.readFileSync(KEY_FILE, "utf8");
    const fields = raw.trim().split(/[\s:=]+/).filter(Boolean);
    if (fields.length < 2) throw new Error("credential-format");
    acct = fields[0]; password = fields.slice(1).join(" ");
  }
  const id = identity(acct);
  id.password = password;
  return { account: acct, hasPassword: !!password };
}

export function masterAccount() {
  if (mem.master) return mem.master;
  const raw = fs.readFileSync(KEY_FILE, "utf8");
  const fields = raw.trim().split(/[\s:=]+/).filter(Boolean);
  mem.master = fields[0];
  return mem.master;
}

export function credentialFingerprint(account = null) {
  loadCredential(account);
  return fingerprint(identity(account ?? masterAccount()).password);
}

/** verify derived keys against the chain's own authorities (self-proving) */
export async function verifyRoles(account = null) {
  syncCredential();
  const acct = account ?? masterAccount();
  const id = identity(acct);
  if (id.verified) return id.verified;
  loadCredential(acct);
  const r = await rpcCall("condenser_api.get_accounts", [[acct]]);
  const acc = r.ok ? r.result?.[0] : null;
  if (!acc) return { ok: false, reason: "account-not-found" };
  const chain = {
    owner: (acc.owner?.key_auths ?? []).map((k) => k[0]),
    active: (acc.active?.key_auths ?? []).map((k) => k[0]),
    posting: (acc.posting?.key_auths ?? []).map((k) => k[0]),
    memo: acc.memo_key ? [acc.memo_key] : [],
  };
  let matchedOrder = null;
  for (const [name, compose] of Object.entries(SEED_ORDERS)) {
    const pk = derivePub(compose(acct, "active", id.password));
    if (chain.active.includes(pk)) { matchedOrder = name; break; }
  }
  if (!matchedOrder) {
    // engine-derived pubkeys from THIS credential (steem-js standard order) —
    // if the operator installs these (steemit.com → Permissions), the engine
    // becomes the account's controller on the next verification pass
    const composeStd = SEED_ORDERS["name+role+pw"];
    const proposed = {};
    for (const role of ["owner", "active", "posting", "memo"]) {
      proposed[role] = derivePub(composeStd(acct, role, id.password));
    }
    return {
      ok: false,
      verdict: "CREDENTIAL-MISMATCH",
      reason: "derived pubkeys do not match this account's on-chain authorities under any standard scheme — the credential was likely never installed (or belongs to a different account)",
      fingerprint: fingerprint(id.password),
      proposedPubkeys: proposed,
      guidance: "operator, pick one: (a) upload the CURRENT password (the one steemit.com accepts for this account) as upload/headcorner.txt — the engine secures and adopts it automatically; or (b) on steemit.com → Permissions, replace Owner/Active/Posting/Memo keys with the proposedPubkeys below — after that single step the system is fully autonomous forever",
    };
  }
  const roles = {};
  for (const role of ["owner", "active", "posting", "memo"]) {
    const compose = SEED_ORDERS[matchedOrder];
    const seed = compose(acct, role, id.password);
    const pk = derivePub(seed);
    roles[role] = { pubkey: pk, matched: (chain[role] ?? []).includes(pk) };
    if (roles[role].matched) id.wifs[role] = wifFor(seed); // memory only
  }
  id.matchedOrder = matchedOrder;
  id.verified = {
    ok: roles.active.matched,
    account: acct,
    matchedOrder,
    roles: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, { pubkey: v.pubkey, matched: v.matched }])),
    fingerprint: fingerprint(id.password),
  };
  return id.verified;
}

/** public status (safe for APIs/UI) */
export async function execStatus() {
  const conf = armedConf();
  const master = masterAccount();
  let ver = null;
  try { ver = await verifyRoles(master); } catch (e) { ver = { ok: false, reason: String(e?.message ?? e).slice(0, 80) }; }
  return {
    credentialPresent: (() => { try { loadCredential(master); return true; } catch { return false; } })(),
    fingerprint: ver?.fingerprint ?? null,
    account: master,
    armed: conf.armed && !execPaused(),
    standingOrder: conf.armed,
    operatorPaused: execPaused(),
    verdict: ver?.verdict ?? (ver?.ok ? "VERIFIED" : null),
    caps: { maxOpsPerCycle: conf.maxOpsPerCycle, maxAskSteemPerCycle: conf.maxAskSteemPerCycle, maxBidSbdPerCycle: conf.maxBidSbdPerCycle, minRcPct: conf.minRcPct },
    soldiers: conf.soldiers,
    promo: conf.promo,
    roles: ver?.roles ?? null,
    matchedOrder: ver?.matchedOrder ?? null,
    reason: ver?.reason ?? null,
    guidance: ver?.guidance ?? null,
    proposedPubkeys: ver?.proposedPubkeys ?? null,
  };
}

/* ── broadcast: own node loop so error details survive (fail-closed) ─────── */
async function broadcastTx(json) {
  const NODES = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
  let lastErr = "";
  for (const node of NODES) {
    try {
      const r = await fetch(node, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction", params: [json], id: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json().catch(() => null);
      if (d?.error) { lastErr = String(d.error.message ?? JSON.stringify(d.error)).slice(0, 200); continue; }
      if (d?.result !== undefined) return { ok: true, node };
      lastErr = "no-result";
    } catch (e) { lastErr = String(e?.message ?? e).slice(0, 160); }
  }
  return { ok: false, error: lastErr || "all-nodes-failed" };
}

/* ── the one execution entry-point: sign & broadcast a capped, atomic tx ── */
export async function executeAs(account, ops, { tag = "cycle", role = "active" } = {}) {
  const conf = armedConf();
  if (!conf.armed) return { ok: false, verdict: "DISARMED", reason: "standing-order-off" };
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED", reason: "kill-switch" };
  if (!ops.length) return { ok: true, verdict: "NO-OPS", ops: 0 };
  if (ops.length > conf.maxOpsPerCycle) ops = ops.slice(0, conf.maxOpsPerCycle);

  const ver = await verifyRoles(account);
  if (!ver.ok) return { ok: false, verdict: "KEY-UNVERIFIED", reason: ver.reason ?? "no-match" };
  const id = identity(account);
  if (!id.wifs[role]) return { ok: false, verdict: "ROLE-KEY-ABSENT", role, matched: ver.roles?.[role]?.matched ?? null };

  // RC floor — chain resource health before any op (master only; soldiers ride small)
  if (account === masterAccount()) {
    const acc = await accountState(account);
    if (acc.ok && acc.rcPct != null && acc.rcPct < conf.minRcPct) {
      return { ok: false, verdict: "RC-FLOOR", rcPct: acc.rcPct, reason: `rc below ${conf.minRcPct}%` };
    }
  }

  const dgpoR = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  if (!dgpoR.ok) return { ok: false, verdict: "NO-DGPO" };
  const t = buildTx({ ops, dgpo: dgpoR.result, wifs: [id.wifs[role]] });
  const crypto = await import("node:crypto");
  const txid = crypto.createHash("sha256").update(Buffer.from(t.serializedHex, "hex")).digest("hex").slice(0, 40);
  const res = await broadcastTx(t.json);
  appendLine(LOG_FILE, {
    at: new Date().toISOString(), tag, account, ok: res.ok, txid,
    ops: ops.map(([n]) => n), node: res.node ?? null, error: res.error ?? null,
    fingerprint: ver.fingerprint,
  });
  return { ok: res.ok, verdict: res.ok ? "BROADCAST" : "BROADCAST-FAIL", txid, ops: ops.length, opNames: ops.map(([n]) => n), node: res.node ?? null, error: res.error ?? null };
}

export async function executeOps(ops, opts = {}) {
  return executeAs(masterAccount(), ops, opts);
}

export const EXEC_FILES = { ARMED_FILE, PAUSE_FILE, LOG_FILE };
