/**
 * blurt-sign-diag2.cjs — Task 36 endgame: decisive BLURT signing experiment.
 *
 * 1. signs the canary tx via the lib (chain_id prepended digest — graphene standard)
 * 2. offline-verifies the signature against BOTH candidate digests:
 *      a. sha256(chain_id || tx-bytes)   (standard graphene)
 *      b. sha256(tx-bytes)               (no-chain_id hypothesis)
 * 3. asks the CHAIN itself: condenser_api.verify_authority [signed]
 * 4. broadcasts raw if the chain says the authority is satisfied, then
 *    confirms with condenser_api.get_transaction.
 * Never prints key material. Broadcasts AT MOST the single canary.
 */
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const NM = "/home/z/my-project/mini-services/external-signer/node_modules";
const steem = require(path.join(NM, "steem"));
const serializer = require(path.join(NM, "steem/lib/auth/serializer"));
const ecc = require(path.join(NM, "steem/lib/auth/ecc"));
const BLURT_CHAIN_ID = "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";
const MAGIC = "SAOS-FLEET-VAULT-1";
const NODES = ["https://rpc.beblurt.com", "https://rpc.blurt.world", "https://blurt-rpc.saboin.com"];

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(12000),
    cache: "no-store"
  });
  const json = await res.json();
  if (json.error) throw new Error(String(json.error.message ?? "rpc").slice(0, 200));
  return json.result;
}
async function rpcAny(method, params) {
  let last = null;
  for (const n of NODES) {
    try { return await rpc(n, method, params); } catch (e) { last = e; }
  }
  throw last;
}

(async () => {
  const dir = "/tmp/agent-audit/steem/agent";
  const raw = fs.readFileSync(path.join(dir, "fleet_keys.enc"), "utf8");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "fleet_keys.meta.json"), "utf8"));
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
  d.setAuthTag(payload.subarray(28, 44));
  const bundle = JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8"));
  const envOf = Object.fromEntries(bundle.files[".env"].split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
  const postingWif = envOf.BLURT_POSTING_WIF;
  const pubPayload = steem.auth.wifToPublic(postingWif).slice(3); // 33-byte payload

  const dgp = await rpcAny("condenser_api.get_dynamic_global_properties", []);
  const jsonPayload = JSON.stringify({ v: 1, protocol: "saos.weave.v1", network: "BLURT", kind: "weave", note: "task36 connect: headcorner BLURT identity live-verified from owner master key; vault rebuilt", sealedAt: "2026-09-09T17:26:18Z", ts: new Date().toISOString().slice(0, 19) + "Z" });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000).toISOString().slice(0, 19),
    operations: [["custom_json", { required_auths: [], required_posting_auths: ["headcorner"], id: "saos.weave.v1", json: jsonPayload }]],
    extensions: []
  };

  steem.config.set("chain_id", BLURT_CHAIN_ID);
  const signed = steem.auth.signTransaction(tx, [postingWif]);
  const buf = serializer.ops.transaction.toBuffer(tx);
  const cidBuf = Buffer.from(BLURT_CHAIN_ID, "hex");
  const digestWithCid = crypto.createHash("sha256").update(Buffer.concat([cidBuf, buf])).digest();
  const digestNoCid = crypto.createHash("sha256").update(buf).digest();
  const sig = ecc.Signature.fromHex(signed.signatures[0]);
  const pubExpected = ecc.PublicKey.fromString("BLT" + pubPayload);

  const offline = { verifyHash_withCid: null, verifyHash_noCid: null };
  try { offline.verifyHash_withCid = sig.verifyHash(digestWithCid, pubExpected) === true; } catch (e) { offline.verifyHash_withCid = "err:" + String(e?.message ?? e).slice(0, 60); }
  try { offline.verifyHash_noCid = sig.verifyHash(digestNoCid, pubExpected) === true; } catch (e) { offline.verifyHash_noCid = "err:" + String(e?.message ?? e).slice(0, 60); }

  // chain verdict: verify_authority with the signed tx (object, not double-wrapped)
  let chainVerdict = null;
  try {
    const r = await rpcAny("condenser_api.verify_authority", [signed]);
    chainVerdict = { valid: r === true, raw: r };
  } catch (e) {
    chainVerdict = { error: String(e?.message ?? e).slice(0, 160) };
  }

  const out = {
    txid20: crypto.createHash("sha256").update(buf).digest().subarray(0, 20).toString("hex"),
    offline,
    chainVerdict,
    headBlock: dgp.head_block_number,
    broadcast: null,
    confirmed: null
  };

  // broadcast ONLY if the chain itself says the authority is satisfied OR the offline no-cid verify passed (then re-sign without cid)
  if (chainVerdict.valid === true) {
    try {
      const b = await rpcAny("condenser_api.broadcast_transaction", [signed]);
      out.broadcast = { ok: true, node: "primary", result: b ?? null };
      try {
        const trx = await rpcAny("condenser_api.get_transaction", [out.txid20]);
        out.confirmed = { onChain: !!trx?.transaction_id || !!trx?.block_num, block: trx?.block_num ?? null };
      } catch (e) {
        out.confirmed = { note: "get_transaction pending/miss: " + String(e?.message ?? e).slice(0, 80) };
      }
    } catch (e) {
      out.broadcast = { ok: false, error: String(e?.message ?? e).slice(0, 160) };
    }
  } else if (offline.verifyHash_noCid === true) {
    out.hypothesis = "BLURT signs WITHOUT chain_id prefix — re-signing accordingly";
    try {
      const priv = ecc.PrivateKey.fromWif(postingWif);
      const sig2 = ecc.Signature.signBuffer(buf, priv); // hashes buf internally (no cid)
      const signed2 = { ...signed, signatures: [sig2.toHex()] };
      const va = await rpcAny("condenser_api.verify_authority", [signed2]);
      out.resignedVerifyAuthority = { valid: va === true, raw: va };
      if (va === true) {
        await rpcAny("condenser_api.broadcast_transaction", [signed2]);
        out.broadcast = { ok: true, mode: "no-chain_id digest" };
        try {
          const trx = await rpcAny("condenser_api.get_transaction", [out.txid20]);
          out.confirmed = { onChain: !!trx?.transaction_id || !!trx?.block_num, block: trx?.block_num ?? null };
        } catch (e) {
          out.confirmed = { note: "get_transaction pending/miss: " + String(e?.message ?? e).slice(0, 80) };
        }
      }
    } catch (e) {
      out.resignedError = String(e?.message ?? e).slice(0, 160);
    }
  }

  console.log(JSON.stringify(out, null, 1));
})();
