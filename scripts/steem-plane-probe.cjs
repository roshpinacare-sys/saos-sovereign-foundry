#!/usr/bin/env node
/* STEEM-plane probe (roast-66) — probe-ONLY, fail-closed, zero key material on stdout.
 * Question: does ANY key we hold (any net tag — WIF bytes are chain-agnostic) match
 * the LIVE STEEM authorities of the 12 fleet accounts? Plus: chain-divergence map
 * (STEEM authority vs HIVE authority per role) + balances + VESTS→HP via dgpo.
 * Prints: verdicts, public keys, balances, counts. NEVER WIFs / passwords.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const steem = require("/home/z/my-project/mini-services/external-signer/node_modules/steem");

const ENVELOPE = path.join(os.homedir(), ".secrets", "fleet-envelope");
const VAULT = path.join(ENVELOPE, "keys", "vault.json");
const ACCOUNTS = ["headcorner","tov","ynet","macrame","israelnews","haran","cashmachine","wog","wic","lsa","siq","woq"];
const ROLES = ["owner","active","posting","memo"];
const STEEM_RPC = "https://api.steemit.com";
const HIVE_RPC = "https://api.hive.blog";

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await r.json();
  if (j.error) throw new Error(url + " " + method + ": " + JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

function heldWifs() {
  // role -> { account: [wif,...] } from ALL net tags in the vault + main envelope env
  const out = {};
  for (const r of ROLES) out[r] = {};
  const vault = JSON.parse(fs.readFileSync(VAULT, "utf8"));
  for (const a of vault.accounts || []) {
    const name = a.username;
    for (const r of ROLES) {
      const rd = (a.keys || {})[r] || {};
      const tags = Object.keys(rd).filter((k) => k.startsWith("wif"));
      const wifs = tags.map((t) => rd[t]).filter(Boolean);
      if (wifs.length) out[r][name] = (out[r][name] || []).concat(wifs);
    }
  }
  // main envelope .env (STEEM_*/HIVE_*/BLURT_*_*_WIF for AGENT_ACCOUNT)
  const envTxt = fs.readFileSync(path.join(ENVELOPE, ".env"), "utf8");
  const env = {};
  for (const line of envTxt.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const mainAcct = env.AGENT_ACCOUNT || "headcorner";
  for (const r of ROLES) {
    const wifs = new Set();
    for (const pre of ["STEEM", "HIVE", "BLURT"]) {
      const v = env[`${pre}_${r.toUpperCase()}_WIF`];
      if (v) wifs.add(v);
    }
    if (wifs.size) out[r][mainAcct] = (out[r][mainAcct] || []).concat([...wifs]);
  }
  return out;
}

(async () => {
  const held = heldWifs();
  const [steemAccs, hiveAccs, dgpo] = await Promise.all([
    rpc(STEEM_RPC, "condenser_api.get_accounts", [ACCOUNTS]),
    rpc(HIVE_RPC, "condenser_api.get_accounts", [ACCOUNTS]),
    rpc(STEEM_RPC, "condenser_api.get_dynamic_global_properties", []),
  ]);
  const sMap = new Map(steemAccs.map((a) => [a.name, a]));
  const hMap = new Map(hiveAccs.map((a) => [a.name, a]));
  // CORRECT formula: STEEM per MVESTS = TVF / (TVS / 1e6)   (dgpo values carry unit suffixes)
  const steemPerMvest = parseFloat(dgpo.total_vesting_fund_steem) / (parseFloat(dgpo.total_vesting_shares) / 1e6);

  const byName = new Map(steemAccs.map((a) => [a.name, a]));
  const summary = { accounts: ACCOUNTS.length, onSteem: steemAccs.length, totalSteem: 0, totalSbd: 0, totalHp: 0, roleMatches: 0, probedWifs: 0 };
  const rows = [];

  for (const name of ACCOUNTS) {
    const a = byName.get(name);
    if (!a) { rows.push({ name, exists: false }); continue; }
    const row = { name, exists: true, created: a.created.slice(0, 10), roles: {}, balances: {
      steem: a.balance, sbd: a.sbd_balance,
      hp: ((parseFloat(a.vesting_shares) / 1e6) * steemPerMvest).toFixed(3),
      savings: a.savings_balance + " / " + a.savings_sbd_balance,
      rewards: a.reward_steem_balance + " / " + a.reward_sbd_balance + " / " + a.reward_vesting_balance,
    } };
    summary.totalSteem += parseFloat(a.balance); summary.totalSbd += parseFloat(a.sbd_balance);
    summary.totalHp += (parseFloat(a.vesting_shares) / 1e6) * steemPerMvest;
    // chain divergence: STEEM authority vs HIVE authority (public keys only)
    const h = hMap.get(name);
    row.divergence = {};
    for (const r of ["owner", "active", "posting"]) {
      const sKey = (a[r].key_auths[0] || ["-"])[0];
      const hKey = h ? ((h[r].key_auths[0] || ["-"])[0]) : "no-hive-acct";
      // payload compare (strip prefix)
      row.divergence[r] = sKey.slice(3) === hKey.slice(3) ? "same" : "diverged";
      if (a[r].key_auths.length > 1 || a[r].account_auths.length) row.divergence[r + "_extra"] = a[r].key_auths.length + "keys+" + a[r].account_auths.length + "accts";
    }
    // probe: every held WIF for this account vs live STEEM authorities
    for (const r of ROLES) {
      const wifs = (held[r] && held[r][name]) || [];
      const auths = r === "memo" ? [a.memo_key] : a[r].key_auths.map((k) => k[0]);
      let matched = null;
      for (const wif of wifs) {
        summary.probedWifs++;
        let pub;
        try { pub = steem.auth.wifToPublic(wif); } catch { summary.invalidHeld = (summary.invalidHeld || 0) + 1; continue; }
        const payload = pub.slice(3); // strip render prefix
        for (const auth of auths) {
          if (auth && auth.slice(3) === payload) { matched = true; break; }
        }
        if (matched) break;
      }
      row.roles[r] = { held: wifs.length, match: wifs.length ? (matched ? "MATCH" : "no") : "none-held" };
      if (matched) summary.roleMatches++;
    }
    rows.push(row);
  }

  console.log("=== STEEM-PLANE PROBE (probe-only; verdicts+public data only) ===");
  for (const row of rows) {
    if (!row.exists) { console.log(`${row.name}: NOT-ON-STEEM`); continue; }
    console.log(`${row.name} (created ${row.created}) bal=${row.balances.steem} sbd=${row.balances.sbd} hp=${row.balances.hp} savings=${row.balances.savings} rewards=${row.balances.rewards}`);
    console.log(`   divergence STEEM-vs-HIVE: owner=${row.divergence.owner} active=${row.divergence.active} posting=${row.divergence.posting}${row.divergence.owner_extra ? " (" + row.divergence.owner_extra + ")" : ""}`);
    console.log(`   probe: owner=${row.roles.owner.match}(${row.roles.owner.held}) active=${row.roles.active.match}(${row.roles.active.held}) posting=${row.roles.posting.match}(${row.roles.posting.held}) memo=${row.roles.memo.match}(${row.roles.memo.held})`);
  }
  console.log("=== SUMMARY ===");
  console.log(JSON.stringify({
    ...summary, totalHp: summary.totalHp.toFixed(3),
    totals: `${summary.totalSteem.toFixed(3)} STEEM + ${summary.totalSbd.toFixed(3)} SBD + ${summary.totalHp.toFixed(3)} HP`,
    verdict: summary.roleMatches > 0 ? "KEYS-WE-HOLD-MATCH-STEEM" : "NO-HELD-KEY-MATCHES-LIVE-STEEM",
  }, null, 1));
})();
