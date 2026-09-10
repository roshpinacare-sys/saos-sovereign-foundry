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
const OUT: string[] = [];
const MNEM = (await Bun.file(process.env.HOME + "/wallet-check/mnemonic.txt").text()).trim();
const mnN = MNEM.split(/\s+/).join(" ");
const ent = (() => { try { return Buffer.from(bip39.mnemonicToEntropy(mnN, wordlist)).toString("hex"); } catch { return null; } })();
const bipSeed = bip39.mnemonicToSeedSync(mnN);
const PWraw = (await Bun.file("/home/z/my-project/upload/בלורט.evm").text()).trim();
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
for (const net of ["STEEM", "HIVE"]) {
  const url = net === "HIVE" ? "https://api.hive.blog" : "https://api.steemit.com";
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(12000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [["headcorner"]] }) });
    const row = (await r.json() as { result?: Array<Record<string, unknown>> }).result?.[0];
    if (!row) { OUT.push(`${net}: rpc empty`); continue; }
    const a = { posting: row.posting as string, active: row.active as string, owner: row.owner as string, memo: row.memo_key as string };
    const cmp = (exp: string, pub: string) => exp === pub || exp === "STM" + pub.slice(3);
    for (const [name, seed] of seeds) {
      const sb = /^[0-9a-fA-F]{64}$/.test(seed) ? Buffer.from(seed, "hex") : Buffer.from(seed, "utf8");
      let hits = 0; const hr: string[] = [];
      for (const tok of [net, net.toLowerCase()]) for (const role of ["owner", "active", "posting", "memo"] as const) {
        const label = `SAOS-ROT1/headcorner/${tok}/${role}`;
        for (const p32 of [createHmac("sha256", sb).update(label, "utf8").digest(), createHmac("sha256", Buffer.from(label, "utf8")).update(sb).digest()]) for (const c of [true, false]) {
          try { const pub = steem.auth.wifToPublic(wifOf(p32, c)); const exp = role === "memo" ? a.memo : a[role]; if (cmp(exp, pub)) { hits++; hr.push(`${tok}/${role}`); } } catch {}
        }
      }
      if (hits) OUT.push(`${net} ROT1[${name}]: ${hits} → ${hr.join(",")}`);
    }
    OUT.push(`${net}: scanned`);
  } catch (e) { OUT.push(`${net}: ${String((e as Error).message).slice(0, 60)}`); }
}
await Bun.write("/tmp/rot1-results.txt", OUT.join("\n") || "no matches at all");
