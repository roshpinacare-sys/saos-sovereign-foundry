/**
 * blurt-scheme-forensics2.cjs — Task 36: decisive digest-scheme identification.
 *
 * 1. POSITIVE CONTROL: run the full recovery pipeline on a fresh STEEM tx —
 *    the standard graphene scheme (sha256(zero-cid || body)) MUST recover the
 *    voter's posting key. Proves the machinery.
 * 2. BODY VALIDATION for the BLURT sample: sha256(body)[0:20] must equal the
 *    on-chain transaction_id → proves our byte-serialization is exact.
 * 3. WIDE candidate set for the BLURT sample digest.
 */
const crypto = require("crypto");
const path = require("path");

const NM = "/home/z/my-project/mini-services/external-signer/node_modules";
const steem = require(path.join(NM, "steem"));
const serializer = require(path.join(NM, "steem/lib/auth/serializer"));
const ecc = require(path.join(NM, "steem/lib/auth/ecc"));
const BLURT_CHAIN_ID = "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";
const ZERO64 = "0".repeat(64);
const BLURT_NODES = ["https://rpc.beblurt.com", "https://rpc.blurt.world", "https://blurt-rpc.saboin.com"];
const STEEM_NODE = "https://api.steemit.com";

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

function cleanBody(trx) {
  const body = { ...trx };
  delete body.signatures;
  delete body.transaction_id;
  delete body.block_num;
  delete body.transaction_num;
  return body;
}

function candidatesFor(buf) {
  const cid32 = Buffer.from(BLURT_CHAIN_ID, "hex");
  const zero32 = Buffer.from(ZERO64, "hex");
  const cidAscii = Buffer.from(BLURT_CHAIN_ID, "ascii");
  const sha = (b) => crypto.createHash("sha256").update(b).digest();
  return {
    A_cid32_prefix: sha(Buffer.concat([cid32, buf])),
    B_no_cid: sha(buf),
    C_zero_prefix: sha(Buffer.concat([zero32, buf])),
    D_cid_ascii: sha(Buffer.concat([cidAscii, buf])),
    E_double_cid: sha(sha(Buffer.concat([cid32, buf]))),
    F_double_body: sha(sha(buf))
  };
}

async function analyzeChain(label, node, chainIdScheme) {
  const dgp = await rpc(node, "condenser_api.get_dynamic_global_properties", []);
  const head = dgp.head_block_number;
  const SAFE = new Set(["custom_json", "vote", "comment", "delete_comment"]);
  let trx = null, blockNum = null;
  for (let back = 3; back < 60 && !trx; back++) {
    blockNum = head - back;
    let block = null;
    try { block = await rpc(node, "condenser_api.get_block", [blockNum]); } catch { continue; }
    for (const t of block?.transactions ?? []) {
      if (t.signatures?.length > 0 && (t.operations ?? []).every((o) => SAFE.has(o[0]))) { trx = t; break; }
    }
  }
  if (!trx) return { label, ok: false, reason: "no clean sample tx" };

  const body = cleanBody(trx);
  const buf = (serializer.ops?.transaction ?? serializer.transaction).toBuffer(body);
  const txidComputed = crypto.createHash("sha256").update(buf).digest().subarray(0, 20).toString("hex");

  // fetch the REAL on-chain transaction id
  let txidChain = null;
  try {
    const opDesc = (trx.operations?.[0] ?? [])[1] ?? {};
    // use condenser get_transaction via the block's own id when available
    const withId = await rpc(node, "condenser_api.get_block", [blockNum]);
    const match = (withId?.transactions ?? []).find((t) => JSON.stringify(t.operations) === JSON.stringify(trx.operations));
    txidChain = match?.transaction_id ?? null;
  } catch {}

  // actors + authorities
  const actors = new Set();
  for (const [, op] of trx.operations ?? []) {
    for (const [field, value] of Object.entries(op ?? {})) {
      if (/^(account|from|to|creator|author|voter|delegator)$/.test(field) && typeof value === "string") actors.add(value);
    }
  }
  const authPayloads = [];
  for (const acct of [...actors].slice(0, 3)) {
    try {
      const accs = await rpc(node, "condenser_api.get_accounts", [[acct]]);
      const a = accs?.[0];
      if (a) for (const role of ["posting", "active", "owner"]) authPayloads.push({ acct, role, payload: a?.[role]?.key_auths?.[0]?.[0]?.slice(3) });
    } catch {}
  }

  const cands = candidatesFor(buf);
  const sig = ecc.Signature.fromBuffer(Buffer.from(trx.signatures[0], "hex"));
  const verdicts = {};
  for (const [name, digest] of Object.entries(cands)) {
    try {
      const pub = sig.recoverPublicKey(digest);
      const payloadHex = pub.toBuffer().toString("hex").slice(2, 66) + pub.toBuffer().toString("hex").slice(67); // 33B payload (skip header, keep Q compressed form)
      const p33 = pub.toBuffer().toString("hex").slice(2);
      const hit = authPayloads.find((a) => a.payload && a.payload.slice(3) === p33);
      verdicts[name] = hit ? `MATCH ${hit.acct}/${hit.role}` : "no-match";
    } catch (e) {
      verdicts[name] = "recover-error: " + String(e?.message ?? e).slice(0, 50);
    }
  }

  return {
    label,
    blockNum,
    ops: (trx.operations ?? []).map((o) => o[0]),
    txBytes: buf.length,
    txidComputed,
    txidChain,
    bodyExact: txidChain ? txidComputed === txidChain : null,
    verdicts
  };
}

(async () => {
  const out = {};
  // positive control on STEEM
  try { out.steem = await analyzeChain("STEEM", STEEM_NODE, "zero"); } catch (e) { out.steem = { ok: false, error: String(e?.message ?? e).slice(0, 120) }; }
  // the Blurt mystery
  try { out.blurt = await analyzeChain("BLURT", BLURT_NODES[0], "?"); } catch (e) { out.blurt = { ok: false, error: String(e?.message ?? e).slice(0, 120) }; }
  console.log(JSON.stringify(out, null, 1));
})();
