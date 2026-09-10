/**
 * ONE-OFF FORENSIC EXPERIMENT (Task 30 era) — NOT part of the signer runtime.
 * Purpose: ROT1-seed candidate derivation probes for the STEEM/HIVE key
 * recovery investigation. Reads the mnemonic ONLY from $HOME (outside the
 * repo, owner custody); contains no secret material; never imported anywhere.
 * Status: superseded by Task 43 real-keys ingest (upload/הדקור.txt) — kept as
 * documented forensic history per the append-only evidence discipline.
 */
import { createHash, createHmac } from "crypto";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
const { default: steem } = await import("steem");
const MNEM = (await Bun.file(process.env.HOME + "/wallet-check/mnemonic.txt").text()).trim();
const mnN = MNEM.split(/\s+/).join(" ");
const ent = (() => { try { return Buffer.from(bip39.mnemonicToEntropy(mnN, wordlist)).toString("hex"); } catch { return null; } })();
const bipSeed = bip39.mnemonicToSeedSync(mnN);
const PWraw = (await Bun.file("/home/z/my-project/upload/בלורט.evm").text()).trim();
const PWs = [PWraw, PWraw.startsWith("P") ? PWraw.slice(1) : PWraw];
const seeds: Array<[string, string]> = [
  ["entropy", ent!], ["entropy-text", ent!], ["sha256(entropy)", createHash("sha256").update(ent!, "utf8").digest("hex")],
  ["sha256(mn)", createHash("sha256").update(mnN, "utf8").digest("hex")],
  ["bip39[0:32]", Buffer.from(bipSeed.subarray(0, 32)).toString("hex")],
  ["bip39[32:64]", Buffer.from(bipSeed.subarray(32, 64)).toString("hex")],
  ["sha256(PW)", createHash("sha256").update(PWraw, "utf8").digest("hex")]
];
const B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58enc = (buf: Buffer) => { let n = BigInt("0x" + buf.toString("hex")); let s = ""; while (n > 0n) { s = B58A[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b === 0) s = "1" + s; else break; } return s; };
const wifOf = (p: Buffer, c: boolean) => { const payload = Buffer.concat([Buffer.from([0x80]), p, Buffer.from([c ? 1 : 0])]); const ck = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4); return b58enc(Buffer.concat([payload, ck])); };
const auth = async (net: string, acct: string) => {
  const urls: Record<string, string> = { STEEM: "https://api.steemit.com", HIVE: "https://api.hive.blog", BLURT: "https://rpc.beblurt.com" };
  const r = await fetch(urls[net], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[acct]] }) });
  const a = (await r.json() as { result?: Array<Record<string, unknown>> }).result?.[0];
  return a ? { posting: a.posting as string, active: a.active as string, owner: a.owner as string, memo: a.memo_key as string } : null;
};
for (const net of ["BLURT", "STEEM", "HIVE"]) {
  const a = await auth(net, "headcorner"); if (!a) continue;
  const pre = net === "BLURT" ? "BLT" : "STM";
  const cmp = (exp: string, pub: string) => exp === pub || exp === pre + pub.slice(3);
  for (let i = 0; i < PWs.length; i++) {
    let roles: Record<string, string>;
    try { roles = steem.auth.getPrivateKeys("headcorner", PWs[i], ["posting", "active", "memo"]); } catch { continue; }
    const out = (["posting", "active", "memo"] as const).map(role => {
      const pub = steem.auth.wifToPublic(roles[role]);
      const exp = role === "memo" ? a.memo : (a as Record<string, string>)[role];
      return `${role[0]}:${cmp(exp, pub) ? "M" : "-"}`;
    }).join(" ");
    console.log(`${net} P-variant[${i}]: ${out}`);
  }
  for (const [name, seed] of seeds) {
    const sb = /^[0-9a-fA-F]{64}$/.test(seed) ? Buffer.from(seed, "hex") : Buffer.from(seed, "utf8");
    let hits = 0; const hitRoles: string[] = [];
    for (const tok of [net, net.toLowerCase()]) for (const role of ["owner", "active", "posting", "memo"] as const) {
      const label = `SAOS-ROT1/headcorner/${tok}/${role}`;
      for (const p32 of [createHmac("sha256", sb).update(label, "utf8").digest(), createHmac("sha256", Buffer.from(label, "utf8")).update(sb).digest()]) for (const c of [true, false]) {
        try { const pub = steem.auth.wifToPublic(wifOf(p32, c)); const exp = role === "memo" ? a.memo : (a as Record<string, string>)[role]; if (cmp(exp, pub)) { hits++; hitRoles.push(`${tok}/${role}`); } } catch {}
      }
    }
    console.log(`${net} ROT1[${name}]: ${hits}${hits ? " → " + hitRoles.join(",") : ""}`);
  }
}
