/**
 * blurt-scheme-forensics.cjs — Task 36: discover Blurt's REAL signing digest
 * from a LIVE on-chain transaction (not from docs, not from guesses).
 *
 * Method: take a fresh block's signed transaction, strip its signatures,
 * re-serialize the body with our (byte-proven) serializer, then RECOVER the
 * signing pubkey from the signature under EACH candidate digest:
 *    A. sha256(chain_id || body)      — graphene standard (cd8d90f2…)
 *    B. sha256(body)                  — no chain_id
 *    C. sha256(STEEM-zero chain_id || body) — stale-default check
 * The recovered pubkey payload is compared to the tx actors' on-chain
 * authorities → the matching digest IS Blurt's scheme. Read-only.
 */
const crypto = require("crypto");
const path = require("path");

const NM = "/home/z/my-project/mini-services/external-signer/node_modules";
const steem = require(path.join(NM, "steem"));
const serializer = require(path.join(NM, "steem/lib/auth/serializer"));
const ecc = require(path.join(NM, "steem/lib/auth/ecc"));
const BLURT_CHAIN_ID = "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";
const ZERO64 = "0".repeat(64);
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
  const dgp = await rpcAny("condenser_api.get_dynamic_global_properties", []);
  const head = dgp.head_block_number;

  // find a recent block with a tx whose ops serialize identically on both chains
  // (custom_json/vote/comment — no asset fields, which Blurt renames in some ops)
  const SAFE_OPS = new Set(["custom_json", "vote", "comment", "delete_comment"]);
  let block = null, blockNum = null, trx = null;
  for (let back = 3; back < 60 && !trx; back++) {
    blockNum = head - back;
    try { block = await rpcAny("condenser_api.get_block", [blockNum]); } catch { continue; }
    const trxs = block?.transactions ?? [];
    for (const t of trxs) {
      if (t.signatures?.length > 0 && (t.operations ?? []).every((o) => SAFE_OPS.has(o[0]))) { trx = t; break; }
    }
  }
  if (!trx) {
    console.log(JSON.stringify({ ok: false, reason: "no signed tx found in recent blocks" }));
    return;
  }

  const body = { ...trx, signatures: undefined };
  delete body.signatures;
  delete body.transaction_id;
  delete body.block_num;
  delete body.block_num;
  delete body.transaction_num;
  let buf = null;
  try {
    buf = (serializer.ops?.transaction ?? serializer.transaction).toBuffer(body);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, reason: "serializer failed on sample tx", error: String(e?.message ?? e).slice(0, 120) }));
    return;
  }

  const sigBuf = Buffer.from(trx.signatures[0], "hex");
  const sig = ecc.Signature.fromBuffer(sigBuf);
  const candidates = {
    A_chainid_prefix: crypto.createHash("sha256").update(Buffer.concat([Buffer.from(BLURT_CHAIN_ID, "hex"), buf])).digest(),
    B_no_chainid: crypto.createHash("sha256").update(buf).digest(),
    C_zero_chainid: crypto.createHash("sha256").update(Buffer.concat([Buffer.from(ZERO64, "hex"), buf])).digest()
  };

  const recovered = {};
  for (const [name, digest] of Object.entries(candidates)) {
    try {
      const pub = sig.recoverPublicKey(digest, /*canonical*/ true);
      const payload = pub.toBuffer().toString("hex").slice(2, 68); // strip header byte, 33B → take 32B+flag
      recovered[name] = pub.toBuffer().toString("hex").slice(2); // full 33-byte payload hex
    } catch (e) {
      recovered[name] = "recover-failed: " + String(e?.message ?? e).slice(0, 60);
    }
  }

  // collect the tx actors' authorities to see which recovery (if any) matches
  const actors = new Set();
  for (const [opName, op] of trx.operations ?? []) {
    for (const [field, value] of Object.entries(op ?? {})) {
      if (/^(account|from|to|creator|author|delegator|owner|voter|curator|publisher)$/.test(field) && typeof value === "string") actors.add(value);
    }
  }
  const authOf = {};
  for (const acct of [...actors].slice(0, 4)) {
    try {
      const accs = await rpcAny("condenser_api.get_accounts", [[acct]]);
      const a = accs?.[0];
      if (a) authOf[acct] = [a.posting?.key_auths?.[0]?.[0], a.active?.key_auths?.[0]?.[0], a.owner?.key_auths?.[0]?.[0]].filter(Boolean).map((k) => k.slice(3));
    } catch {}
  }

  const matchVerdict = {};
  for (const [name, payloadHex] of Object.entries(recovered)) {
    if (typeof payloadHex !== "string" || payloadHex.startsWith("recover-failed")) { matchVerdict[name] = payloadHex; continue; }
    const hit = Object.entries(authOf).find(([acct, pubs]) => pubs.some((p) => p === payloadHex));
    matchVerdict[name] = hit ? `MATCH → ${hit[0]} (scheme confirmed)` : "no authority match";
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        blockNum,
        txOperations: (trx.operations ?? []).map((o) => o[0]),
        txBytes: buf.length,
        signatureHeader: sigBuf[0],
        recoveredPayloadFirst8: Object.fromEntries(Object.entries(recovered).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 16) : v])),
        matchVerdict,
        verdict: Object.entries(matchVerdict).find(([, v]) => String(v).startsWith("MATCH"))?.[0] ?? "no scheme matched — deeper fork difference (report honestly)"
      },
      null,
      1
    )
  );
})();
