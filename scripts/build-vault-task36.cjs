/**
 * build-vault-task36.cjs — rebuild the fleet vault envelope from the owner's
 * master password (the "מקשר להכל" key, uploaded 2026-09-09).
 *
 * WHAT IT DOES:
 *   1. derives headcorner's BLURT role keys (owner/active/posting/memo) via the
 *      graphene KDF — the SAME derivation proven live-matching in
 *      scripts/p-key-connect-test.cjs (4/4 roles match the live chain);
 *   2. RE-VERIFIES every derived key against the LIVE Blurt authorities
 *      immediately before writing — fail-closed: any mismatch aborts;
 *   3. seals the SAOS-FLEET-VAULT-1 envelope (scrypt + AES-256-GCM, exact
 *      format the external-signer's openSeal() reads) with:
 *        - .env: AGENT_ACCOUNT + the verified BLURT slots (+ honest pending notes)
 *        - keys/vault.json: headcorner entry with net.BLURT slots
 *   4. writes the envelope to THREE locations (runtime + recovery), 0600/700.
 *
 * WHAT IT NEVER DOES: print a key, write anything into the repo, broadcast.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SIGNER_NM = "/home/z/my-project/mini-services/external-signer/node_modules";
const steem = require(path.join(SIGNER_NM, "steem"));
const INPUT = "/home/z/my-project/upload/בלורט.evm";
const MAGIC = "SAOS-FLEET-VAULT-1";
const ACCOUNT = "headcorner";
const BLURT_NODES = ["https://rpc.beblurt.com", "https://rpc.blurt.world", "https://blurt-rpc.saboin.com"];

async function rpc(url, method, params) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(12000),
        cache: "no-store"
      });
      const json = await res.json();
      if (json.error) throw new Error(String(json.error.message ?? "rpc").slice(0, 100));
      return json.result;
    } catch (e) {
      if (i === 1) throw e;
    }
  }
}

(async () => {
  const password = fs.readFileSync(INPUT, "utf8").trim();
  if (!password.startsWith("P") || password.length < 50) {
    console.log(JSON.stringify({ ok: false, reason: "unexpected key shape" }));
    process.exit(1);
  }

  // 1) derive role keys (in memory only)
  const keys = steem.auth.getPrivateKeys(ACCOUNT, password, ["owner", "active", "posting", "memo"]);
  // 2) live re-verification — fail-closed
  let a = null;
  for (const node of BLURT_NODES) {
    try {
      const accs = await rpc(node, "condenser_api.get_accounts", [[ACCOUNT]]);
      if (Array.isArray(accs) && accs[0]) { a = accs[0]; a.__node = node; break; }
    } catch {}
  }
  if (!a) {
    console.log(JSON.stringify({ ok: false, reason: "blurt-unreachable — nothing written" }));
    process.exit(1);
  }
  const pub = {};
  for (const role of ["owner", "active", "posting", "memo"]) {
    pub[role] = steem.auth.wifToPublic(keys[role]); // STM-prefixed render
  }
  const swap = (stmPub) => "BLT" + stmPub.slice(3); // same payload, Blurt prefix
  const verify = {
    owner: a.owner?.key_auths?.[0]?.[0] === swap(pub.owner),
    active: a.active?.key_auths?.[0]?.[0] === swap(pub.active),
    posting: a.posting?.key_auths?.[0]?.[0] === swap(pub.posting),
    memo: a.memo_key === swap(pub.memo)
  };
  const allOk = Object.values(verify).every(Boolean);
  if (!allOk) {
    console.log(JSON.stringify({ ok: false, reason: "LIVE VERIFICATION FAILED — nothing written (fail-closed)", verified: verify }));
    process.exit(1);
  }

  // 3) build the envelope (exact openSeal() format)
  const sealedAt = new Date().toISOString();
  const envFile = [
    "# SAOS fleet runtime envelope — rebuilt 2026-09-09 from the owner master password",
    "# (Task 36). BLURT slots are LIVE-VERIFIED against chain authorities.",
    "# STEEM_*/HIVE_* slots are ABSENT: the previous envelope was lost with the",
    "# sandbox rollback; their live authorities await owner re-ingest (verify-then-write).",
    `AGENT_ACCOUNT=${ACCOUNT}`,
    `POSTING_WIF=${keys.posting}`,
    `ACTIVE_WIF=${keys.active}`,
    `MEMO_WIF=${keys.memo}`,
    `OWNER_WIF=${keys.owner}`,
    "# ── network-suffixed slots ──",
    `BLURT_POSTING_WIF=${keys.posting}`,
    `BLURT_ACTIVE_WIF=${keys.active}`,
    `BLURT_MEMO_WIF=${keys.memo}`,
    `BLURT_OWNER_WIF=${keys.owner}`,
    "# STEEM_POSTING_WIF=(pending owner re-ingest)",
    "# STEEM_ACTIVE_WIF=(pending owner re-ingest)",
    "# HIVE_POSTING_WIF=(pending owner re-ingest)",
    "# HIVE_ACTIVE_WIF=(pending owner re-ingest)"
  ].join("\n");
  const vaultJson = JSON.stringify(
    {
      generatedAt: sealedAt,
      note: "Task 36 rebuild — headcorner BLURT roles live-verified; STEEM/HIVE pending",
      accounts: [
        {
          username: ACCOUNT,
          keys: {
            posting: { wif: keys.posting, wifBLURT: keys.posting },
            active: { wif: keys.active, wifBLURT: keys.active },
            owner: { wif: keys.owner, wifBLURT: keys.owner },
            memo: { wifBLURT: keys.memo }
          }
        }
      ]
    },
    null,
    1
  );
  const bundle = { sealedAt, files: { ".env": envFile, "keys/vault.json": vaultJson } };

  const pass = crypto.randomBytes(32).toString("base64");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  const payload = Buffer.concat([salt, iv, cipher.getAuthTag(), ct]);
  const encText = MAGIC + payload.toString("hex").replace(/(.{64})/g, "$1\n");
  const meta = {
    pass,
    sealedAt,
    generator: "task36-master-password-ingest (scripts/build-vault-task36.cjs)",
    verified: { chain: "BLURT", account: ACCOUNT, roles: Object.keys(verify) },
    format: MAGIC
  };

  // 4) write: runtime + two recovery copies (never in the repo)
  const targets = [
    "/tmp/agent-audit/steem/agent",
    "/home/z/.secrets/vault-recovery/guardian-manual-task36",
    "/home/z/.secrets/fleet-keys"
  ];
  const written = [];
  for (const dir of targets) {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, "fleet_keys.enc"), encText, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "fleet_keys.meta.json"), JSON.stringify(meta, null, 1), { mode: 0o600 });
    fs.chmodSync(path.join(dir, "fleet_keys.enc"), 0o600);
    fs.chmodSync(path.join(dir, "fleet_keys.meta.json"), 0o600);
    written.push(dir);
  }
  console.log(
    JSON.stringify({
      ok: true,
      sealedAt,
      verifiedRoles: Object.keys(verify),
      chain: "BLURT",
      node: String(a.__node).replace("https://", ""),
      envelopeBytes: payload.length,
      written,
      note: "STEEM/HIVE slots honestly absent — pending owner re-ingest (verify-then-write)"
    })
  );
})();
