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
import { validateCredentialText, vpSpoilage } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const KEY_FILE = path.join(SECRETS, "headcorner.key");
const ARMED_FILE = path.join(SECRETS, "exec-armed.json");
const STATE = path.join(DIR, "state");
const PAUSE_FILE = path.join(STATE, "exec-pause.json");
const LOG_FILE = path.join(STATE, "exec-log.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
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
    if (!fs.existsSync(KEY_FILE)) {
      // T-16: the credential was REMOVED while identities may be cached — a
      // stale verified:false (or worse, verified wifs) must never outlive the
      // credential it was derived from. Wipe so the next verifyRoles hits
      // loadCredential → typed CREDENTIAL-MISSING → the honest alarm state.
      if (Object.keys(mem.identities).length || mem.master) {
        for (const k of Object.keys(mem.identities)) delete mem.identities[k];
        mem.master = null;
        mem.keyFileFp = null;
      }
      return false;
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

/**
 * T-16 · paste-revival (the fastest operator path — measured 2026-09-30: the
 * file-drop revival waited ~1 day with zero action; friction kills revival).
 * Validates the text (pure half in lib.mjs), secures it (0600, .secrets/),
 * invalidates every cached identity, journals ONLY the fingerprint (the
 * secret itself is never logged/returned). The caller (engine route) then
 * runs verifyRoles for instant on-chain truth before answering.
 */
export function adoptCredentialText(text, { source = "paste" } = {}) {
  const v = validateCredentialText(text);
  if (!v.ok) return { ok: false, reason: v.reason };
  // same normalized split as the validator — the secret stays inside this scope
  const fields = String(text ?? "").trim().split(/[\s:=]+/).filter(Boolean);
  const secret = fields.slice(1).join(" ");
  try {
    fs.mkdirSync(SECRETS, { recursive: true });
    fs.writeFileSync(KEY_FILE, `${v.account} ${secret}\n`, { mode: 0o600 });
    fs.chmodSync(KEY_FILE, 0o600);
    const fp = fingerprint(secret);
    appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "credential-adopted", source, account: v.account, fingerprint: fp });
    // credential changed → invalidate every cached identity (memory only)
    for (const k of Object.keys(mem.identities)) delete mem.identities[k];
    mem.master = null;
    mem.keyFileFp = null;
    appendLine(path.join(STATE, "events.jsonl"), { type: "cred.adopted", at: new Date().toISOString(), source, account: v.account, fingerprint: fp, verdict: "ADOPTED" });
    return { ok: true, account: v.account, fingerprint: fp };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}

/* ── T-15 credential-truth (loud, honest, journaled once/hour — no spam) ────
 * The cold-reset lesson: a dead signing layer must SCREAM, not rot. This
 * state is public-safe (booleans + paths + guidance — never key material). */
const CRED_ALARM_FILE = path.join(STATE, "cred-alarm.json");
function noteCredMissing() {
  try {
    const now = new Date().toISOString();
    const prev = readJson(CRED_ALARM_FILE, { missingSince: null, lastAlertAt: null, alerts: 0 });
    const hourAgo = Date.now() - 3600_000;
    if (!prev.missingSince) prev.missingSince = now;
    if (!prev.lastAlertAt || Date.parse(prev.lastAlertAt) < hourAgo) {
      prev.lastAlertAt = now;
      prev.alerts = (prev.alerts ?? 0) + 1;
      appendLine(LOG_FILE, { at: now, tag: "cred-missing", verdict: "SIGNING-DEAD", keyFile: KEY_FILE, revival: "drop upload/headcorner.txt → engine self-adopts (0600) on next cycle" });
      appendLine(path.join(STATE, "events.jsonl"), { type: "cred.missing", at: now, verdict: "SIGNING-DEAD", agentsAffected: ["curate", "execute", "soldiers"], revival: "upload/headcorner.txt" });
    }
    writeJson(CRED_ALARM_FILE, prev);
  } catch { /* best effort — never crash the caller on alarm bookkeeping */ }
}
export function credentialState() {
  let present = false;
  try { fs.accessSync(KEY_FILE, fs.constants.R_OK); present = true; } catch { present = false; }
  const alarm = readJson(CRED_ALARM_FILE, { missingSince: null, lastAlertAt: null, alerts: 0 });
  const conf = armedConf();
  return {
    present,
    keyFile: ".secrets/headcorner.key",
    armedButNoCredential: !!conf.armed && !present,
    missingSince: present ? null : (alarm.missingSince ?? null),
    alerts: alarm.alerts ?? 0,
    agentsAffected: present ? [] : ["curate", "execute", "soldiers", "promo"],
    revival: present ? null : "drop the CURRENT master-password file as upload/headcorner.txt → engine secures+adopts automatically (0600, upload copy removed, zero restart)",
  };
}

/**
 * T-16 · VP-spoilage — the visible price of the blocked signing rail.
 * Measured: days blocked × doctrine vote quota foregone. Estimated: STEEM
 * from discovery's PUBLIC reward-fund math (never claimed as measured).
 * Earliest of the two clocks wins — sovereign's boot-time firstDownAt can be
 * YOUNGER than the real absence; the cred-alarm file knows the true start.
 */
export function spoilagePublic(now = new Date().toISOString()) {
  const sov = readJson(path.join(STATE, "sovereign.json"), null);
  const alarm = readJson(CRED_ALARM_FILE, { missingSince: null });
  const disc = readJson(path.join(STATE, "discovery.json"), null);
  const conf = armedConf();
  const firstDown = [sov?.cred?.firstDownAt, alarm?.missingSince].filter(Boolean).sort()[0] ?? null;
  const est = (disc?.opportunities ?? []).find((o) => o.id === "curation-share")?.potential ?? null;
  const s = vpSpoilage({ firstDownAt: firstDown, now, maxPerDay: conf.curate?.maxPerDay ?? 0, estSteemPerDay: est });
  return { ...s, note: est != null ? "STEEM part is ESTIMATED (public reward-fund math) · days/votes are measured" : "days/votes measured; no discovery estimate available yet" };
}

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
    // T-13: the measured fuel rail — VP put to work (posting key only, vote op
    // can never move funds). The operator ordered it implemented and running.
    curate: { enabled: true, maxPerDay: 10, baseWeightPct: 50, minWeightPct: 20, minVpEffPct: 60 },
  };
}

export function armedConf() {
  const d = readJson(ARMED_FILE, null);
  if (!d) {
    const def = defaultArmedConf();
    try { fs.mkdirSync(SECRETS, { recursive: true }); fs.writeFileSync(ARMED_FILE, JSON.stringify(def, null, 2)); } catch { /* read-only fs */ }
    return def;
  }
  // shallow-merge: the operator's file wins on keys it defines, new doctrine
  // blocks (e.g. T-13 curate) appear without touching the operator's file
  return { ...defaultArmedConf(), ...d };
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
    let raw;
    try {
      raw = fs.readFileSync(KEY_FILE, "utf8");
    } catch (e) {
      // T-15 LOUD ALARM (measured live 2026-09-30: cold-reset wiped .secrets/;
      // 3 agents died SILENTLY every cycle for a whole day — curate/execute/
      // soldiers all rotting with raw ENOENT). A missing credential is a
      // TYPED, actionable state — never a generic ENOENT again:
      if (/ENOENT|no such file/i.test(String(e?.message ?? e))) {
        noteCredMissing();
        throw new Error(
          "CREDENTIAL-MISSING: .secrets/headcorner.key not found (sandbox cold-reset wipes gitignored secrets). " +
          "Revival (self-service, zero restart): drop the account's CURRENT master-password file as upload/headcorner.txt — " +
          "the engine secures it (0600 into .secrets/), adopts it on the next cycle, and the whole signing fleet revives."
        );
      }
      throw e;
    }
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
  // T-15: the account NAME is public (it's on-chain) — a missing credential
  // file must never crash callers with a raw ENOENT here; the typed
  // CREDENTIAL-MISSING alarm belongs to loadCredential (the secret read).
  let acct = null;
  try {
    const raw = fs.readFileSync(KEY_FILE, "utf8");
    const fields = raw.trim().split(/[\s:=]+/).filter(Boolean);
    acct = fields[0] ?? null;
  } catch { /* fall through to the known public account name */ }
  mem.master = acct || process.env.SAOS_ACCOUNT || "headcorner";
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
  const cred = credentialState();
  let master = null;
  try { master = masterAccount(); } catch { master = "headcorner"; }
  let ver = null;
  try { ver = await verifyRoles(master); } catch (e) { ver = { ok: false, reason: String(e?.message ?? e).slice(0, 120) }; }
  return {
    credentialPresent: cred.present,
    credential: cred,
    fingerprint: ver?.fingerprint ?? null,
    account: master,
    armed: conf.armed && !execPaused(),
    standingOrder: conf.armed,
    operatorPaused: execPaused(),
    verdict: ver?.verdict ?? (ver?.ok ? "VERIFIED" : null),
    caps: { maxOpsPerCycle: conf.maxOpsPerCycle, maxAskSteemPerCycle: conf.maxAskSteemPerCycle, maxBidSbdPerCycle: conf.maxBidSbdPerCycle, minRcPct: conf.minRcPct },
    soldiers: conf.soldiers,
    promo: conf.promo,
    curate: conf.curate ?? null,
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
