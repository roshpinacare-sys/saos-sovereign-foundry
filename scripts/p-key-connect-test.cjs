/**
 * p-key-connect-test.cjs — Task 36: does the owner's uploaded P-string connect
 * to EVERYTHING (the "מקשר להכל" master-key mechanism) or is it an unbound WIF?
 *
 * Two interpretations tested against LIVE on-chain authorities:
 *   A. WIF  — strip the Blurt "P" marker, derive the pubkey, compare to the
 *             live owner/active/posting/memo authorities of the full roster
 *             (headcorner + 12 soldiers) on STEEM / HIVE / BLURT.
 *   B. PASSWORD — graphene role derivation (steem.auth.getPrivateKeys) for
 *             every candidate account × role, same live comparison.
 *
 * Zero secret output: only match verdicts + PUBLIC key fingerprints.
 * Zero broadcasts. Read-only chain calls.
 */
const crypto = require("crypto");
const path = require("path");

const SIGNER_NM = "/home/z/my-project/mini-services/external-signer/node_modules";
const steem = require(path.join(SIGNER_NM, "steem"));
const INPUT = "/home/z/my-project/upload/בלורט.evm";

const HEAD = "headcorner";
const ROSTER = ["cashmachine", "haran", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "ynet", "israelnews", "powerspan"];
const ACCOUNTS = [HEAD, ...ROSTER];
const CHAINS = {
  STEEM: { url: "https://api.steemit.com", prefix: "STM" },
  HIVE: { url: "https://api.hive.blog", prefix: "STM" },
  BLURT: { url: "https://rpc.blurt.world", prefix: "BLT" }
};
const BLURT_FALLBACKS = ["https://rpc.blurt.btsd.io", "https://blurt-rpc.saboin.com", "https://rpc.beblurt.com"];

async function rpc(url, method, params, timeoutMs = 12000) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store"
    });
    const json = await res.json();
    if (json.error) return { error: String(json.error.message ?? "rpc").slice(0, 80) };
    return json.result;
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 80) };
  }
}

async function authorities(net, url, acct) {
  for (const u of net === "BLURT" ? [url, ...BLURT_FALLBACKS] : [url]) {
    const r = await rpc(u, "condenser_api.get_accounts", [[acct]]);
    if (r && !r.error && Array.isArray(r) && r[0]) {
      const a = r[0];
      return {
        node: u.replace("https://", ""),
        owner: a.owner?.key_auths?.[0]?.[0] ?? null,
        active: a.active?.key_auths?.[0]?.[0] ?? null,
        posting: a.posting?.key_auths?.[0]?.[0] ?? null,
        memo: a.memo_key ?? null,
        exists: true
      };
    }
  }
  return { exists: false };
}

function fp(pub) {
  return pub ? pub.slice(0, 6) + "…" + pub.slice(-4) : null;
}

(async () => {
  const fs = require("fs");
  const raw = fs.readFileSync(INPUT, "utf8").trim();

  // ── interpretation A: the string as a Blurt WIF ("P" + 51-char WIF) ──
  let wifPubByChain = {};
  try {
    const wif = raw.startsWith("P") ? raw.slice(1) : raw;
    if (steem.auth.isWif(wif)) {
      const pubSTM = steem.auth.wifToPublic(wif);
      // same 33-byte payload, chain prefix re-render
      const dec = Buffer.from(wif.split("").reduce((acc, c) => {
        const idx = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".indexOf(c);
        return null;
      }, null) || "");
      // derive raw payload for prefix swap
      const payload = steem.auth.wifToPublic(wif).slice(3); // strip STM
      wifPubByChain = {
        STEEM: "STM" + payload,
        HIVE: "STM" + payload,
        BLURT: "BLT" + payload
      };
    }
  } catch (e) {
    wifPubByChain = { error: String(e?.message ?? e).slice(0, 80) };
  }

  // ── chain facts: authorities for every account × chain (cached) ──
  const auth = {};
  for (const [net, cfg] of Object.entries(CHAINS)) {
    auth[net] = {};
    for (const acct of ACCOUNTS) {
      auth[net][acct] = await authorities(net, cfg.url, acct);
    }
  }

  // ── interpretation A comparisons ──
  const wifMatches = [];
  if (wifPubByChain && !wifPubByChain.error) {
    for (const [net, pub] of Object.entries(wifPubByChain)) {
      if (typeof pub !== "string") continue;
      for (const acct of ACCOUNTS) {
        const a = auth[net]?.[acct];
        if (!a?.exists) continue;
        for (const role of ["owner", "active", "posting", "memo"]) {
          if (a[role] && a[role] === pub) wifMatches.push({ net, acct, role, pubkey: fp(pub) });
        }
      }
    }
  }

  // ── interpretation B: the string as a master password ──
  const pwMatches = [];
  const pwChecked = [];
  for (const acct of ACCOUNTS) {
    let keys = null;
    try {
      keys = steem.auth.getPrivateKeys(acct, raw, ["owner", "active", "posting", "memo"]);
    } catch {
      pwChecked.push({ acct, error: "derivation-failed" });
      continue;
    }
    for (const [net, cfg] of Object.entries(CHAINS)) {
      const a = auth[net]?.[acct];
      if (!a?.exists) continue;
      for (const role of ["owner", "active", "posting", "memo"]) {
        let pub = null;
        try { pub = steem.auth.wifToPublic(keys[role]); } catch { continue; }
        const payload = pub.slice(3);
        const chainPub = cfg.prefix + payload;
        const match = a[role] === chainPub;
        pwChecked.push({ acct, net, role, match, derived: fp(chainPub), expected: fp(a[role]) });
        if (match) pwMatches.push({ acct, net, role, pubkey: fp(chainPub) });
      }
    }
  }

  // ── summary (public data only) ──
  const summary = {
    stringShape: { len: raw.length, pPrefix: raw[0] === "P", isWifAfterP: wifPubByChain && !wifPubByChain.error ? true : false },
    wifInterpretation: { tested: !wifPubByChain?.error, matches: wifMatches, error: wifPubByChain?.error ?? null },
    passwordInterpretation: { derivationsChecked: pwChecked.length, matches: pwMatches },
    chainReachability: Object.fromEntries(Object.entries(auth).map(([net, m]) => [net, Object.values(m).filter((x) => x.exists).length + "/" + ACCOUNTS.length + " accounts visible"])),
    verdict:
      pwMatches.length > 0
        ? "MASTER-PASSWORD MATCH — the string derives live chain authorities: the tree can be rebuilt from it"
        : wifMatches.length > 0
          ? "WIF MATCH — the key controls live authority slots"
          : "NO LIVE MATCH — the key is valid but bound to no listed account on any chain (pending-bind)"
  };
  console.log(JSON.stringify(summary, null, 1));
})();
