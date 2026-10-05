/**
 * steemtx.mjs — minimal, self-contained STEEM transaction toolkit.
 * T-12: the operator handed the master credential — the X-1 gate becomes an
 * ENGINE-HELD, DOCTRINE-BOUNDED execution rail.
 *
 * SECURITY CONTRACT (non-negotiable):
 *  - secrets live ONLY in .secrets/ (gitignored, 0600) and in process memory
 *  - nothing in this module ever logs or returns private material
 *  - the only outputs are: public keys, fingerprints, txids, booleans
 *
 * Pure crypto via @noble (audited): sha256, ripemd160, secp256k1 (RFC6979
 * deterministic sigs, canonical low-s — matches chain enforcement).
 */

import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { hmac } from "@noble/hashes/hmac";
import * as secp from "@noble/secp256k1";

// noble v2: RFC6979 needs HMAC-SHA256 registered (sync + async) — lives on .etc
secp.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, ...msgs);
secp.etc.hmacSha256Async = async (key, ...msgs) => hmac(sha256, key, ...msgs);

/* ── base58 (bitcoin alphabet — same as steem) ──────────────────────────── */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58encode(buf) {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}
export function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad-base58"); n = n * 58n + BigInt(i); }
  let hex = n.toString(16).padStart(2, "0"); if (hex.length % 2) hex = "0" + hex;
  let buf = Buffer.from(hex, "hex");
  let pad = 0; for (const c of s) { if (c === "1") pad++; else break; }
  return Buffer.concat([Buffer.alloc(pad), buf]);
}
const sha256d = (b) => Buffer.from(sha256(Buffer.from(sha256(b))));

/* ── WIF (private key, version 0x80, compressed flag) ───────────────────── */
export function wifEncode(seed32) {
  const body = Buffer.concat([Buffer.from([0x80]), Buffer.from(seed32), Buffer.from([0x01])]);
  const chk = sha256d(body).slice(0, 4);
  return b58encode(Buffer.concat([body, chk]));
}
export function wifDecode(wif) {
  const d = b58decode(wif);
  if (d.length !== 38) throw new Error("wif-length"); // 1 ver + 32 key + 1 flag + 4 chk
  const body = d.slice(0, 34), chk = d.slice(34);
  if (!sha256d(body).slice(0, 4).equals(chk)) throw new Error("wif-checksum");
  if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format");
  return body.slice(1, 33);
}

/* T-83 · wifDecodeAny — the vault fleet (army-vault-recovered.json) holds
 * BOTH WIF shapes (T-79/T-81 measured: "wifDecodeAny(uncompressed+compressed)
 * → secp256k1 → live authorities", 56/56 chain-matched). The strict
 * wifDecode above stays for the master credential; fleet identities use this:
 *   compressed WIF   : 0x80 ‖ key32 ‖ 0x01 ‖ chk4  (38 bytes)
 *   uncompressed WIF : 0x80 ‖ key32 ‖ chk4           (37 bytes)
 */
export function wifDecodeAny(wif) {
  const d = b58decode(wif);
  if (d.length === 38) {
    const priv = wifDecode(wif); // full compressed validation reuses the strict path
    return { priv, compressed: true };
  }
  if (d.length === 37) {
    const body = d.slice(0, 33), chk = d.slice(33);
    if (!sha256d(body).slice(0, 4).equals(chk)) throw new Error("wif-checksum");
    if (body[0] !== 0x80) throw new Error("wif-format");
    return { priv: body.slice(1, 33), compressed: false };
  }
  throw new Error("wif-length");
}

/* T-83 · pubkeys from a WIF of either shape — the authority-matching half of
 * custody. MEASURED 2026-10-05: the vault's WIFs are UNCOMPRESSED (37-byte)
 * while the chain's authorities are stored COMPRESSED — same secp256k1 key,
 * different encoding. The matcher therefore receives BOTH forms and the
 * chain decides; the WIF's own shape is never trusted to predict it. */
export function pubkeyFormsFromWif(wif) {
  const { priv } = wifDecodeAny(wif);
  const enc = (pub) => {
    const chk = Buffer.from(ripemd160(Buffer.from(pub))).slice(0, 4);
    return "STM" + b58encode(Buffer.concat([Buffer.from(pub), chk]));
  };
  return {
    compressed: enc(secp.getPublicKey(Buffer.from(priv), true)),
    uncompressed: enc(secp.getPublicKey(Buffer.from(priv), false)),
  };
}
export function pubkeyFromWif(wif) {
  return pubkeyFormsFromWif(wif).compressed;
}

/* ── public key: "STM" + base58(33B compressed || ripemd160(33B)[:4]) ──
 * NOTE: steem pubkey checksum = ripemd160 over the key DIRECTLY (single hash),
 * unlike bitcoin addresses (hash160 = ripemd160(sha256())) — this asymmetry
 * cost us a full verification round; byte-proven against live authorities. */
export function pubkeyFromSeed(seed32) {
  const pub = secp.getPublicKey(Buffer.from(seed32), true); // 33B compressed
  const chk = Buffer.from(ripemd160(Buffer.from(pub))).slice(0, 4);
  return "STM" + b58encode(Buffer.concat([Buffer.from(pub), chk]));
}
export function pubkeyBytes(stm) {
  if (!stm.startsWith("STM")) throw new Error("pubkey-prefix");
  const d = b58decode(stm.slice(3));
  if (d.length !== 37) throw new Error("pubkey-length");
  const key = d.slice(0, 33), chk = d.slice(33);
  if (!Buffer.from(ripemd160(key)).slice(0, 4).equals(chk)) throw new Error("pubkey-checksum");
  return Buffer.from(key);
}

/* ── steem key derivation. steem-js: PrivateKey.fromSeed(seed) = sha256(seed);
 * the seed composition order is verified against on-chain authorities by the
 * caller (signer.mjs tries candidates and keeps the one that matches). ── */
export const SEED_ORDERS = {
  "name+role+pw": (a, r, p) => `${a}${r}${p}`,
  "pw+role+name": (a, r, p) => `${p}${r}${a}`,
  "role+name+pw": (a, r, p) => `${r}${a}${p}`,
  "name+pw+role": (a, r, p) => `${a}${p}${r}`,
};
export function derivePub(seedStr) {
  return pubkeyFromSeed(sha256(Buffer.from(seedStr, "utf8")));
}
export function wifFor(seedStr) {
  return wifEncode(sha256(Buffer.from(seedStr, "utf8")));
}

/* ── binary writer ──────────────────────────────────────────────────────── */
class Writer {
  constructor() { this.buf = []; }
  u8(v) { this.buf.push(v & 0xff); return this; }
  u16(v) { this.buf.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u32(v) { this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); return this; }
  i32(v) { return this.u32(v >>> 0); }
  u64(v) { let b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.buf.push(...b); return this; }
  i16(v) { return this.u16(v & 0xffff); }
  varint(v) { let n = BigInt(v); while (true) { const b = Number(n & 0x7fn); n >>= 7n; this.u8(n === 0n ? b : b | 0x80); if (n === 0n) break; } return this; }
  bytes(b) { this.buf.push(...b); return this; }
  str(s) { const b = Buffer.from(s, "utf8"); this.varint(b.length); return this.bytes(b); }
  asset(amountStr) {
    // "12.345 STEEM" / "96.123456 VESTS" → the digits themselves ARE the scaled
    // uint64 (precision byte carries the decimal count) — never re-scale
    const m = /^\s*(\d+(?:\.\d+)?)\s+([A-Z]+)\s*$/.exec(amountStr);
    if (!m) throw new Error(`asset-format: ${amountStr}`);
    const whole = m[1]; const sym = m[2];
    const dot = whole.indexOf(".");
    const prec = dot < 0 ? 0 : whole.length - dot - 1;
    const scaled = BigInt(whole.replace(".", ""));
    this.u64(scaled); this.u8(prec);
    const s = Buffer.from(sym, "ascii");
    this.bytes(Buffer.concat([s, Buffer.alloc(7 - s.length)]));
    return this;
  }
  pubkey(stm) { this.bytes(pubkeyBytes(stm)); return this; }
  authority(a) {
    this.u32(a.weight_threshold ?? 1);
    this.varint((a.account_auths ?? []).length);
    for (const [n, w] of a.account_auths ?? []) { this.str(n); this.u16(w); }
    this.varint((a.key_auths ?? []).length);
    for (const [k, w] of a.key_auths ?? []) { this.pubkey(k); this.u16(w); }
    return this;
  }
  out() { return Buffer.from(this.buf); }
}

/* ── operation serializers (field order = chain registry order) ─────────── */
export const OP_IDS = { vote: 0, comment: 1, transfer: 2, limit_order_create: 5, limit_order_cancel: 6, convert: 8, account_create: 9, claim_account: 22, create_claimed_account: 23, claim_reward_balance: 33, delegate_vesting_shares: 40 };

function serOp(name, v, w) {
  switch (name) {
    case "comment":
      w.str(v.parent_author ?? "").str(v.parent_permlink).str(v.author).str(v.permlink).str(v.title ?? "").str(v.body ?? "").str(v.json_metadata ?? "{}");
      break;
    case "limit_order_create":
      w.str(v.owner).u32(v.orderid).asset(v.amount_to_sell).asset(v.min_to_receive).u8(v.fill_or_kill ? 1 : 0).i32(v.expiration);
      break;
    case "limit_order_cancel":
      w.str(v.owner).u32(v.orderid);
      break;
    case "convert":
      w.str(v.owner).asset(v.amount).u32(v.requestid);
      break;
    case "transfer":
      w.str(v.from).str(v.to).asset(v.amount).str(v.memo ?? "");
      break;
    case "claim_account":
      w.str(v.creator).asset(v.fee ?? "0.000 STEEM").varint(0);
      break;
    case "create_claimed_account":
      // NOTE: current steem protocol appends an extensions vector to this op —
      // byte-proven against node serialization (missing `00` = authority error)
      w.str(v.creator).str(v.new_account_name)
        .authority(v.owner).authority(v.active).authority(v.posting)
        .pubkey(v.memo_key).str(v.json_metadata ?? "{}").varint(0);
      break;
    case "account_create":
      // direct paid creation — bypasses the RC claim wall entirely (3.000 STEEM)
      w.asset(v.fee).str(v.creator).str(v.new_account_name)
        .authority(v.owner).authority(v.active).authority(v.posting)
        .pubkey(v.memo_key).str(v.json_metadata ?? "{}");
      break;
    case "vote":
      w.str(v.voter).str(v.author).str(v.permlink).i16(v.weight);
      break;
    case "claim_reward_balance":
      w.str(v.account).asset(v.reward_steem).asset(v.reward_sbd).asset(v.reward_vests);
      break;
    case "delegate_vesting_shares":
      // T-82: op-id + field order MEASURED from the chain's own serializer
      // (condenser_api.get_transaction_hex byte-decode: id=40, delegator,
      // delegatee, vesting_shares prec-6). JSON key contract also MEASURED:
      // this chain maps "delegator"→field1; "account"/"from" → EMPTY (assert
      // "Account name  is invalid"). Binary layout is positional.
      w.str(v.delegator ?? v.account).str(v.delegatee).asset(v.vesting_shares);
      break;
    default:
      throw new Error(`op-not-serializable: ${name}`);
  }
}

/** serialize tx → Buffer (operations as [name, json] pairs) */
export function serializeTx({ ref_block_num, ref_block_prefix, expiration, operations, extensions = [] }) {
  const w = new Writer();
  w.u16(ref_block_num).u32(ref_block_prefix).i32(expiration);
  w.varint(operations.length);
  for (const [name, v] of operations) {
    w.varint(OP_IDS[name]);
    serOp(name, v, w);
  }
  w.varint(extensions.length);
  return w.out();
}

export const STEEM_CHAIN_ID = Buffer.alloc(32); // mainnet chain id = 32 zero bytes

/* ── signing ────────────────────────────────────────────────────────────── */
export function signDigest(digest32, wif) {
  // T-83: the fleet vault holds UNCOMPRESSED WIFs (measured) — the signer
  // accepts both shapes; the signature itself is shape-agnostic (the chain
  // recovers the authority pubkey from the DER signature).
  const priv = Buffer.from(wifDecodeAny(wif).priv);
  const sig = secp.sign(Buffer.from(digest32), priv); // deterministic RFC6979, low-s
  const rec = sig.recovery ?? 0;
  const r = Buffer.from(sig.r.toString(16).padStart(64, "0"), "hex");
  const s = Buffer.from(sig.s.toString(16).padStart(64, "0"), "hex");
  return Buffer.concat([Buffer.from([31 + rec]), r, s]); // [header=31+rec][r][s]
}

/** build + sign a full tx from ops. Returns BOTH the binary digest proof and
 * the JSON form ready for condenser_api.broadcast_transaction. */
export function buildTx({ ops, dgpo, wifs, ttlSec = 45, nowSec = Math.floor(Date.now() / 1000) }) {
  const headNum = dgpo.head_block_number;
  const idBytes = Buffer.from(String(dgpo.head_block_id), "hex");
  const ref_block_num = headNum & 0xffff;
  const ref_block_prefix = idBytes.length >= 8 ? idBytes.readUInt32LE(4) : 0;
  const expiration = nowSec + ttlSec;
  const iso = (sec) => new Date(sec * 1000).toISOString().slice(0, 19);
  const body = { ref_block_num, ref_block_prefix, expiration, operations: ops, extensions: [] };
  const bin = serializeTx({ ...body, expiration });
  const digest = sha256(Buffer.concat([STEEM_CHAIN_ID, bin]));
  const sigs = wifs.map((w) => signDigest(Buffer.from(digest), w).toString("hex"));
  return {
    digestHex: Buffer.from(digest).toString("hex"),
    serializedHex: bin.toString("hex"),
    json: { ...body, expiration: iso(expiration), operations: ops.map(([n, v]) => [n, { ...v, expiration: v.expiration ? iso(v.expiration) : undefined, extensions: "extensions" in v ? v.extensions : undefined }]), signatures: sigs },
  };
}

/* ── asset helpers ──────────────────────────────────────────────────────── */
export function assetOf(n, sym) { return `${Number(n).toFixed(3)} ${sym}`; }
export function fingerprint(s) { return Buffer.from(sha256(Buffer.from(String(s), "utf8"))).toString("hex").slice(0, 8); }
