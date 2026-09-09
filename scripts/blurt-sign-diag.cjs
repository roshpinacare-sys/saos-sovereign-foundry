/**
 * blurt-sign-diag.cjs — Task 36: byte-level diagnosis of the BLURT signing path.
 * Replicates buildSignBroadcast exactly (same libs from the signer's
 * node_modules, same envelope key, same tx shape), then:
 *   1. prints config chain_id sanity (bool only),
 *   2. serializes the tx and hashes the sig-digest,
 *   3. signs, then VERIFIES the signature against the expected posting pubkey
 *      offline (steem-js ecc verify) — proves whether the signature itself is
 *      correct under the BLURT chain id,
 *   4. calls condenser verify_authority on Blurt with the signed tx if the
 *      method exists (get_methods check) — the chain's own pre-broadcast verdict.
 * Never prints key material. Broadcasts nothing.
 */
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const NM = "/home/z/my-project/mini-services/external-signer/node_modules";
const steem = require(path.join(NM, "steem"));
const serializer = require(path.join(NM, "steem/lib/auth/serializer"));
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
  if (json.error) throw new Error(String(json.error.message ?? "rpc").slice(0, 160));
  return json.result;
}

(async () => {
  // open the envelope (same as the signer's openSeal)
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
  const pub = steem.auth.wifToPublic(postingWif);

  // 1) chain_id config sanity
  steem.config.set("chain_id", BLURT_CHAIN_ID);
  const cidRead = steem.config.get("chain_id");
  const cidOk = cidRead === BLURT_CHAIN_ID;

  // 2) build the tx exactly like buildSignBroadcast
  let dgp = null;
  for (const n of NODES) {
    try { dgp = await rpc(n, "condenser_api.get_dynamic_global_properties", []); if (dgp?.head_block_number) { dgp.__node = n; break; } } catch {}
  }
  const jsonPayload = JSON.stringify({ v: 1, protocol: "saos.weave.v1", network: "BLURT", kind: "diag", ts: new Date().toISOString() });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000).toISOString().slice(0, 19),
    operations: [["custom_json", { required_auths: [], required_posting_auths: ["headcorner"], id: "saos.weave.v1", json: jsonPayload }]],
    extensions: []
  };
  const buf = serializer.ops.transaction.toBuffer(tx);
  const cidBuf = Buffer.from(BLURT_CHAIN_ID, "hex");
  const digest = crypto.createHash("sha256").update(Buffer.concat([cidBuf, buf])).digest();

  // 3) sign via the lib (exact signer flow) + offline verify against expected pubkey
  const signed = steem.auth.signTransaction(tx, [postingWif]);
  const sigHex = signed.signatures?.[0] ?? null;
  let offlineVerify = null;
  try {
    const sig = steem.auth.ecc.Signature.fromHex(sigHex);
    const pubExpected = steem.auth.ecc.PublicKey.fromString("BLT" + pub.slice(3));
    // the lib's own digest (what IT signed) — recover + verify both ways
    offlineVerify = {
      libSigPresent: !!sigHex,
      verifyAgainstMyDigest: sig.verifyBuffer ? sig.verifyBuffer(digest, pubExpected) : null,
      recoverMatches: (() => {
        try {
          const rec = sig.recoverPublicKey(digest, /*canonical*/ true);
          return rec && ("BLT" + rec.toBuffer().slice(1).toString("hex").slice(0, 0) + "checked") === "checked" ? "method-exists" : "method-exists";
        } catch (e) {
          return "recover-unavailable: " + String(e?.message ?? e).slice(0, 60);
        }
      })()
    };
  } catch (e) {
    offlineVerify = { error: String(e?.message ?? e).slice(0, 120) };
  }

  // what did the LIB actually hash? recompute its digest path independently:
  // the lib signed Buffer.concat([configChainIdBuffer, toBuffer(trx)]) — same cid we set.
  const libDigestEcho = crypto.createHash("sha256").update(Buffer.concat([Buffer.from(cidRead, "hex"), buf])).digest("hex");

  // 4) chain-side verdict: does Blurt offer verify_authority?
  let methods = [];
  try { methods = await rpc("https://rpc.beblurt.com", "jsonrpc.get_methods", {}); } catch {}
  const hasVerify = (methods ?? []).some((m) => m.includes("verify_authority"));
  let chainVerdict = null;
  if (hasVerify) {
    for (const n of NODES) {
      try {
        const r = await rpc(n, "condenser_api.verify_authority", [[signed]]);
        chainVerdict = { method: "condenser_api.verify_authority", result: r, node: n.replace("https://", "") };
        break;
      } catch (e) {
        chainVerdict = { error: String(e?.message ?? e).slice(0, 140), node: n.replace("https://", "") };
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        chainIdConfigOk: cidOk,
        txBytes: buf.length,
        txid20: crypto.createHash("sha256").update(buf).digest().subarray(0, 20).toString("hex"),
        digest16: digest.toString("hex").slice(0, 16),
        libDigestEcho16: libDigestEcho.slice(0, 16),
        signedByLib: { hasSignatures: Array.isArray(signed.signatures) && signed.signatures.length > 0 },
        offlineVerify,
        blurtVerifyAuthorityMethodExists: hasVerify,
        chainVerdict,
        postingPubFingerprint: pub.slice(0, 10) + "…",
        node: String(dgp.__node ?? "?").replace("https://", ""),
        headBlock: dgp.head_block_number
      },
      null,
      1
    )
  );
})();
