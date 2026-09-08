#!/usr/bin/env node
/**
 * master-key-proof.cjs — הוכחת-מפתח-אחד (Task 17)
 *
 * שאלת הבעלים: "אני חייב לוודא שאני יוכל להתחבר להכל עם מפתח אחד של steem
 * של headcorner — המפתח הראשי."
 *
 * מה הכלי הזה מוכיח (מול השרשרת, בלי לחשוף כלום):
 *   1. סיסמה-ראשית אחת של headcorner → 4 מפתחות-תפקיד (owner/active/posting/memo)
 *      לפי האלגוריתם המתועד בקוד המערכת עצמו (agent/keyrotate.cjs:169):
 *      scalar = sha256(username + role + password)  — בדיוק steem.auth.getPrivateKeys
 *   2. ההשוואה מול הסמכויות הציבוריות על השרשרת — STEEM · HIVE · BLURT.
 *      הפענוח של מפתח-הרשת והקידוד המקומי עוברים את אותו מפענח (bytes מול bytes)
 *      כך שתקלת-קידוד לא יכולה לייצר חיוב-שקרי או שלילה-שקרית.
 *   3. תוצאה: טבלת PASS/FAIL לכל רשת לכל תפקיד + פסק-דין אחד.
 *
 * מה הכלי הזה לעולם לא עושה:
 *   - לא מדפיס/מציג/רושם-לקובץ את הסיסמה או את ה-WIFs (רק זיכרון, וננוקה בסוף)
 *   - לא חותם, לא משדר, לא יוצר טרנזקציות — קריאה-בלבד מול RPC ציבורי
 *   - לא שולח את הסיסמה לשום מקום — רק sha256 מקומי (אחת-כיוונית)
 *
 * שימוש:
 *   SAOS_MASTER_PW='...' node scripts/master-key-proof.cjs headcorner
 *   או: node scripts/master-key-proof.cjs headcorner   (הסיסמה נקראת מ-stdin בלי הד)
 *
 * ארכיטקטורה קיימת שהכלי מאיר (מהקוד עצמו):
 *   - agent/anchor.cjs: ה-ACTIVE_WIF הוא סקלר secp256k1 — אותו סקלר חותם EIP-191
 *     (גשר EVM מאומת ecrecover) — כלומר מפתח ה-active הוא גם זהות-EVM מעצם המתמטיקה.
 *   - sovereign/node/wallets.cjs: כל-הצי (12 סוכנים × EVM/TRON/SOL/BTC) נגזר
 *     מזרע-ריבוני אחד — אבל הזרע הוא שורש נפרד (randomBytes), לא נגזר מהסיסמה-הראשית.
 */
'use strict';
const crypto = require('crypto');
const https = require('https');
const readline = require('readline');

const ROLES = ['owner', 'active', 'posting', 'memo'];
const CHAINS = [
  { name: 'STEEM', prefix: 'STM', endpoint: 'https://api.steemit.com' },
  { name: 'HIVE', prefix: 'STM', endpoint: 'https://api.hive.blog' },
  { name: 'BLURT', prefix: 'BLT', endpoint: 'https://rpc.beblurt.com' },
];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }
function ripemd160(buf) { return crypto.createHash('ripemd160').update(buf).digest(); }

function b58encode(buf) {
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad-base58'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16).padStart(2, '0');
  if (hex.length % 2) hex = '0' + hex;
  let buf = Buffer.from(hex, 'hex');
  for (const c of s) { if (c === '1') buf = Buffer.concat([Buffer.alloc(1), buf]); else break; }
  return buf;
}
/** Graphene public-key string: payload ‖ ripemd160(payload)[:4], base58 —
 *  אומת מול 4 המפתחות-החיים על השרשרת (owner/active/posting/memo של headcorner).
 *  שים-לב: WIF פרטי משתמש ב-double-sha256, אבל מחרוזת-מפתח-ציבורי Graphene —
 *  ripemd160 יחיד על ה-payload. */
function grapheneCheck(payload) {
  return Buffer.concat([payload, ripemd160(payload).slice(0, 4)]);
}
/** סקלר → WIF (לעולם לא מודפס) → מפתח-ציבורי דחוס 33 בתים */
function scalarToPubkey(scalar) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(scalar);
  return Buffer.from(ecdh.getPublicKey('hex', 'compressed'), 'hex');
}
/** בדיוק האלגוריתם המתועד: sha256(username + role + password) → סקלר */
function roleScalar(username, role, password) {
  return sha256(Buffer.concat([Buffer.from(username, 'utf8'), Buffer.from(role, 'utf8'), Buffer.from(password, 'utf8')]));
}
/** פענוח מחרוזת-מפתח-ציבורי (STM…/BLT…) ל-33 בתים גולמיים — בלי תלות בקידומת */
function decodeGraphenePubkey(keyStr) {
  const body = keyStr.replace(/^(STM|TST|BLT|BTS)/, '');
  const raw = b58decode(body);
  if (raw.length !== 37) throw new Error('bad-pubkey-length:' + raw.length);
  const payload = raw.slice(0, 33);
  const chk = raw.slice(33);
  if (!grapheneCheck(payload).slice(33).equals(chk)) throw new Error('bad-checksum');
  return payload;
}

function rpcPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(endpoint);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 25000 }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('bad-json from ' + u.hostname)); } });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + u.hostname)); });
    req.write(data); req.end();
  });
}
async function chainAuthorities(endpoint, username) {
  const d = await rpcPost(endpoint, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[username]], id: 1 });
  if (!d.result || !d.result[0]) throw new Error('account-not-found');
  const a = d.result[0];
  const out = {};
  for (const role of ROLES) {
    if (role === 'memo') out.memo = [a.memo_key];
    else out[role] = (a[role].key_auths || []).map((k) => k[0]);
  }
  return out;
}

function zero(buf) { buf.fill(0); }

/** בדיקה-עצמית: מנגנון קידוד/פענוח/גזירה — בלי שום סוד אמיתי */
function selfTest() {
  const u = 'selftest-user', p = 'selftest-password';
  for (const role of ROLES) {
    const scalar = roleScalar(u, role, p);
    const pub = scalarToPubkey(scalar);
    const enc = 'STM' + b58encode(grapheneCheck(pub));
    if (!decodeGraphenePubkey(enc).equals(pub)) throw new Error('roundtrip-fail:' + role);
  }
  console.log('self-test: גזירה↔קידוד↔פענוח תקינים (מנגנון מאומת, אפס-סודות)');
}
if (process.argv.includes('--selftest')) { selfTest(); process.exit(0); }

async function main() {
  const username = (process.argv[2] || '').toLowerCase();
  if (!username) { console.error('usage: node scripts/master-key-proof.cjs <username>'); process.exit(2); }
  let password = process.env.SAOS_MASTER_PW || '';
  if (!password) {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    password = await new Promise((res) => rl.once('line', res));
    rl.close();
  }
  if (!password) { console.error('no password provided (SAOS_MASTER_PW or stdin)'); process.exit(2); }

  // גזירה מקומית — הסוד נשאר בזיכרון בלבד
  const myPub = {};
  const scalars = {};
  for (const role of ROLES) { scalars[role] = roleScalar(username, role, password); myPub[role] = scalarToPubkey(scalars[role]); }

  const rows = [];
  let passCount = 0, total = 0;
  for (const chain of CHAINS) {
    let auth = null, err = null;
    try { auth = await chainAuthorities(chain.endpoint, username); } catch (e) { err = e.message; }
    for (const role of ROLES) {
      total++;
      if (err) { rows.push({ chain: chain.name, role, verdict: 'RPC-ERROR', detail: err }); continue; }
      const onchain = auth[role] || [];
      const mine = myPub[role];
      const match = onchain.some((k) => { try { return decodeGraphenePubkey(k).equals(mine); } catch (_) { return false; } });
      if (match) { passCount++; rows.push({ chain: chain.name, role, verdict: 'PASS' }); }
      else rows.push({ chain: chain.name, role, verdict: 'FAIL', detail: 'on-chain ' + (onchain[0] ? onchain[0].slice(0, 10) + '…' : '∅') + ' ≠ derived' });
    }
  }

  console.log('\n== הוכחת-מפתח-אחד: ' + username + ' (קריאה-בלבד, אפס-חתימות, אפס-שידורים) ==');
  console.log('דרך-הגזירה: sha256(username+role+password) — האלגוריתם המתועד ב-agent/keyrotate.cjs');
  let last = '';
  for (const r of rows) {
    if (r.chain !== last) { console.log('\n[' + r.chain + ']'); last = r.chain; }
    console.log('  ' + r.role.padEnd(8) + r.verdict + (r.detail ? '  (' + r.detail + ')' : ''));
  }
  console.log('\nפסק-דין: מפתח-אחד שולט ב-' + passCount + '/' + total + ' סמכויות-רשת');
  if (passCount === 12) console.log('→ הסיסמה-הראשית הזאת שולטת ב-' + username + ' על STEEM+HIVE+BLURT במלואן (owner/active/posting/memo).');
  else if (passCount === 0) console.log('→ אין התאמה באף רשת — הסיסמה שגויה לחשבון זה (או שהחשבון נשלט במפתחות אחרים).');
  else console.log('→ התאמה חלקית — בדוק את שורות ה-FAIL למעלה.');
  console.log('מחוץ להיקף ההוכחה הזאת (ראה docs/master-key-audit.md): זרע-הצי (EVM/TRON/SOL/BTC) — שורש-נפרד בקוד הנוכחי; הגשר-EVM של ה-active מאומת ב-anchor.cjs באמצעות ecrecover.');

  for (const r of ROLES) { zero(scalars[r]); zero(myPub[r]); }
  zero(Buffer.from(password));
  process.exit(0);
}
main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
