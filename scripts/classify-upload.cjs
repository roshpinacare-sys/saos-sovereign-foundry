/* Safe classifier: NEVER prints raw secret material — only type/length/fingerprint. */
const fs = require("fs");
const crypto = require("crypto");

const p = process.argv[2];
if (!p) { console.error("usage: node classify-upload.cjs <file>"); process.exit(1); }
const raw = fs.readFileSync(p, "utf8");
const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(x => x.length);

function cls(v) {
  if (/^gh[pousrf]_[A-Za-z0-9]{36,255}$/.test(v)) return "GITHUB_TOKEN(classic)";
  if (/^github_pat_[A-Za-z0-9_]{20,}$/.test(v)) return "GITHUB_TOKEN(fine-grained)";
  if (/^gh[pous]_/.test(v)) return "GITHUB_TOKEN(variant)";
  if (/^P[1-9A-HJ-NP-Za-km-z]{51}$/.test(v)) return "GRAPHENE_PRIVATE(P+WIF51)";
  if (/^5[HJK][1-9A-HJ-NP-Za-km-z]{50}$/.test(v)) return "GRAPHENE_PRIVATE(WIF51)";
  if (/^STM[1-9A-HJ-NP-Za-km-z]{3,}/.test(v)) return "PUBLIC_KEY_STEEM";
  if (/^BLT[1-9A-HJ-NP-Za-km-z]{3,}/.test(v)) return "PUBLIC_KEY_BLURT";
  if (/^[a-z0-9][a-z0-9\-\.]{2,15}$/.test(v)) return "ACCOUNT_NAME_CANDIDATE";
  return "MASTER_PASSWORD_OR_OTHER";
}

console.log("bytes:", Buffer.byteLength(raw), "lines:", lines.length);
lines.forEach((l, i) => {
  const h = crypto.createHash("sha256").update(l).digest("hex").slice(0, 12);
  console.log(`line ${i + 1}: type=${cls(l)} len=${l.length} fp=sha256:${h} hasSpace=${/\s/.test(l)}`);
});
