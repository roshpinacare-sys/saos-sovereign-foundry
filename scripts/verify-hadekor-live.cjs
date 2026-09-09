/* Task 37 — verify הדקור.txt keys against LIVE headcorner authorities (STEEM/HIVE/BLURT).
 * Safety: NEVER prints private material. Prints only: line labels, key shapes, derived PUBLIC keys, on-chain PUBLIC keys, match booleans. */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const SIGNER_NM = "/home/z/my-project/mini-services/external-signer/node_modules";
const req2 = createRequire(path.join(SIGNER_NM, "index.js"));
const steem = req2("steem");

const FILE = process.argv[2] || "/home/z/my-project/upload/הדקור.txt";
const ACCOUNT = "headcorner";

const raw = fs.readFileSync(FILE, "utf8");
const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// ── parse entries: "LABEL = VALUE"; structural lines skipped ────────────────
const entries = [];
const structural = [];
for (const ln of lines) {
  const m = ln.match(/^(.+?)\s*=\s*(\S+)$/);
  if (!m) { structural.push({ shape: ln.length, hasSpace: /\s/.test(ln) }); continue; }
  const val = m[2];
  const kind = /^P[1-9A-HJ-NP-Za-km-z]{51}$/.test(val) ? "P-SEED_OR_WIF52"
    : /^5[HJK][1-9A-HJ-NP-Za-km-z]{50}$/.test(val) ? "WIF51"
    : /^[0-9a-fA-F]{64}$/.test(val) ? "HEX64"
    : "OTHER";
  entries.push({ label: m[1].trim(), val, kind, len: val.length });
}
console.log(`structural lines: ${structural.length}; entries: ${entries.length}`);
entries.forEach((e, i) => console.log(`entry ${i + 1}: label="${e.label}" kind=${e.kind} valLen=${e.len}`));

// ── derive PUBLIC keys: interpretation A (bare WIF) + B (P-string KDF seed) ─
function pubOfWif(wif) {
  try { return steem.auth.wifToPublic(wif); } catch { return null; }
}
for (const e of entries) {
  e.pubs = [];
  const B58 = /[1-9A-HJ-NP-Za-km-z]/;
  const violations = [...e.val].map((c, i) => (B58.test(c) ? null : `${i}:${JSON.stringify(c)}`)).filter(Boolean);
  e.diag = {
    startsP: e.val.startsWith("P"),
    starts5: e.val.startsWith("5"),
    violations: violations.slice(0, 6)
  };
  if (e.kind === "WIF51" || e.kind === "P-SEED_OR_WIF52" || violations.length === 0) {
    const p = pubOfWif(e.val);
    if (p) e.pubs.push({ interp: "raw-WIF", pub: p });
  }
  if (e.kind === "P-SEED_OR_WIF52" || e.kind === "OTHER") {
    try {
      const keys = steem.auth.getPrivateKeys(e.val, ["owner", "active", "posting", "memo"]);
      for (const role of ["owner", "active", "posting", "memo"]) {
        e.pubs.push({ interp: `kdf:${role}`, pub: pubOfWif(keys[role]) });
      }
    } catch { /* not a KDF seed either */ }
  }
  e.pubs = e.pubs.filter((x) => x.pub);
}

// ── live authorities ×3 chains ───────────────────────────────────────────────
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000)
  });
  const j = await res.json();
  if (j.error) throw new Error(`${url} ${method}: ${j.error.message}`);
  return j.result;
}
function bodyOf(pub) { return pub ? pub.replace(/^(STM|BLT|TST)/, "") : null; }

async function authorities(url) {
  const accs = await rpc(url, "condenser_api.get_accounts", [[ACCOUNT]]);
  if (!accs?.length) throw new Error(`no account ${ACCOUNT} on ${url}`);
  const a = accs[0];
  return {
    owner: a.owner.key_auths?.[0]?.[0] ?? null,
    active: a.active.key_auths?.[0]?.[0] ?? null,
    posting: a.posting.key_auths?.[0]?.[0] ?? null,
    memo: a.memo_key ?? a.memo_keys ?? null
  };
}

const CHAINS = {
  STEEM: "https://api.steemit.com",
  HIVE: "https://api.hive.blog",
  BLURT: "https://rpc.beblurt.com"
};

(async () => {
  const auths = {};
  for (const [net, url] of Object.entries(CHAINS)) {
    try {
      auths[net] = await authorities(url);
      const parts = Object.keys(auths[net]).map((k) => {
        const v = auths[net][k];
        return `${k}=${v ? v.slice(0, 10) + "…" : "NULL"}`;
      });
      console.log(`LIVE ${net}: ${parts.join(" ")}`);
    } catch (e) {
      console.log(`LIVE ${net}: FETCH FAILED — ${e.message}`);
    }
  }

  console.log("\n── entry diagnostics (charset) ──");
  for (const e of entries) {
    console.log(`entry ${entries.indexOf(e) + 1} "${e.label}": startsP=${e.diag.startsP} starts5=${e.diag.starts5} derived=${e.pubs.length} violations=${e.diag.violations.length ? e.diag.violations.join(",") : "none"}`);
  }

  console.log("\n── MATCH MATRIX (derived pubkey body vs on-chain authority body) ──");
  let totalMatches = 0;
  for (const e of entries) {
    const rows = [];
    for (const d of e.pubs) {
      const b = bodyOf(d.pub);
      for (const net of Object.keys(auths)) {
        for (const role of ["owner", "active", "posting", "memo"]) {
          const target = bodyOf(auths[net][role]);
          if (b && target && b === target) { rows.push(`${net}.${role} ✓ (${d.interp}) ${d.pub}`); totalMatches++; }
        }
      }
    }
    console.log(`entry ${entries.indexOf(e) + 1} "${e.label}": ${rows.length ? rows.join(" | ") : "no live match"}`);
  }
  console.log(`\nTOTAL live matches: ${totalMatches}`);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
