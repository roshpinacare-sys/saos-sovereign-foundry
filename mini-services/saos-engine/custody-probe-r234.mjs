/**
 * R234 · custody-probe — operator order (trace 1a113f67a0ed4be9):
 * "מה שיש לו מפתח אטום בכספת בטוח בגיט יכול להיות בטוח לשימוש" +
 * "צריך לוודא שגם החשבונות שלנו הקיימים עושים גריד ולא לפתוח חדשים לפני זה".
 *
 * Re-derives the EXISTING army accounts' credentials from the operator's own
 * sealed sheet (hed-soldiers-source.txt inside the git vault, keysZipPass from
 * recovery-meta.json), verifies 4/4 roles against the LIVE chain, and — only
 * for accounts that PASS — writes .secrets/soldiers.json (0600) in the engine's
 * standard custody shape. KEY MATERIAL NEVER PRINTED. Verdict-only output.
 *
 * Genesis-1 (hcsoldier1/2/3) is NOT touched: LOST-NO-CUSTODY stands (T-78b,
 * 588-string sweep, 0 fingerprint hits) — 56.001 STEEM + 0.417 SBD stranded.
 * Genesis-2 (hcsoldier4/5/6) custody stays parked — the operator froze any
 * new-soldier path until the existing fleet grids (fleet-grid-first law).
 */
import fs from "node:fs";
import { SEED_ORDERS, derivePub, fingerprint } from "./steemtx.mjs";

const SHEET = "/tmp/r234-vault/sheet.txt";
const OUT = "/home/z/my-project/.secrets/soldiers.json";
const RPC = "https://api.steemit.com";
const ARMY = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const ROLES = ["owner", "active", "posting", "memo"];

async function chainAuthorities(name) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[name]], id: 1 }),
  }).then((x) => x.json());
  const a = r?.result?.[0];
  if (!a) return null;
  return {
    owner: a.owner.key_auths.map((k) => k[0]),
    active: a.active.key_auths.map((k) => k[0]),
    posting: a.posting.key_auths.map((k) => k[0]),
    memo: a.memo_key ? [a.memo_key] : [],
    vests: a.vesting_shares,
  };
}

// collect unique P-password candidates from the sheet (order-preserving)
function sheetPasswords() {
  const text = fs.readFileSync(SHEET, "utf8");
  const seen = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/P[1-9A-HJ-NP-Za-km-z]{50,52}/g) ?? [];
    for (const p of m) if (!seen.includes(p)) seen.push(p);
  }
  return seen;
}

const compose = SEED_ORDERS["name+role+pw"];

async function main() {
  const pws = sheetPasswords();
  console.log(`[probe] sheet P-password candidates: ${pws.length}`);
  const verified = [];
  for (const name of ARMY) {
    const auth = await chainAuthorities(name);
    if (!auth) { console.log(`[probe] ${name}: NO-CHAIN-ACCOUNT`); continue; }
    let best = null;
    for (const pw of pws) {
      const hits = ROLES.filter((role) => derivePub(compose(name, role, pw)) === auth[role][0] || auth[role].includes(derivePub(compose(name, role, pw)))).length;
      if (!best || hits > best.hits) best = { pw, hits };
      if (hits === 4) break;
    }
    if (best && best.hits === 4) {
      verified.push({ name, password: best.pw, fingerprint: fingerprint(best.pw), verifiedAt: new Date().toISOString(), roles: "4/4", source: "operator-sheet (git vault KEYS-ZIP-2026-09-10, sha256 24ef22b8…, R234 custody-probe)" });
      console.log(`[probe] ${name}: 4/4 MATCH (fp ${best.pw ? "ok" : "?"}, vests ${auth.vests})`);
    } else {
      console.log(`[probe] ${name}: NO-SHEET-MATCH (best ${best?.hits ?? 0}/4) — needs fleet-WIF path (chat-pass zip 09-09) or operator scroll`);
    }
  }
  if (verified.length) {
    const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { accounts: [] };
    const keep = (existing.accounts ?? []).filter((a) => !verified.some((v) => v.name === a.name));
    const merged = { accounts: [...keep, ...verified] };
    fs.mkdirSync("/home/z/my-project/.secrets", { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(merged, null, 2), { mode: 0o600 });
    console.log(`[probe] installed .secrets/soldiers.json (0600): ${merged.accounts.map((a) => a.name).join(", ")}`);
  } else {
    console.log("[probe] ZERO verified — nothing installed (honest fail-closed)");
  }
  console.log(`[probe] VERDICT: ${verified.length}/10 army accounts custody-restored`);
}

main();
