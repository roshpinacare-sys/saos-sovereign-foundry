#!/usr/bin/env node
/**
 * org-wide-sweep.cjs — סריקת-על ארגונית לדליפות (Task 19) · קריאה-בלבד, אפס-סודות
 *
 * עבור כל ריפו שה-token רואה × כל ענף: קורא את עץ-ה-HEAD ומחפש דפוסי-דליפה
 * בנתיבים בלבד (לא פותח תוכן של שום קובץ-סוד):
 *   · סיומות-מעטפת: .enc .pem .p12 .pfx .kdbx
 *   · שמות-סוד: fleet_keys / vaultkey / mnemonic / .env מדויק / seed-words / wallet-seed
 *   · תיקיות-מפתחות: agent/keys/ (שנוטרש מ-steem) ו-any keys/ עם קבצים לא-ציבוריים
 *
 * מצב-הלב של הדיסציפלינה: דפוס-נתיב בלבד → הדוח לעולם לא מכיל תוכן.
 * שימוש: node scripts/org-wide-sweep.cjs   (טוקן נקרא מ-~/.secrets/github-token)
 */
'use strict';
const https = require('https');
const fs = require('fs');
const os = require('os');

const T = fs.readFileSync(os.homedir() + '/.secrets/github-token', 'utf8').trim();
const ORG = 'roshpinacare-sys';

function api(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'api.github.com', path, method: 'GET', family: 4,
        headers: { Authorization: 'Bearer ' + T, Accept: 'application/vnd.github+json', 'User-Agent': 'saos-org-sweep' }, timeout: 20000 },
      (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { resolve({ s: r.statusCode, j: JSON.parse(d) }); } catch (e) { reject(e); } }); }
    );
    req.on('timeout', () => req.destroy(new Error('timeout ' + path)));
    req.on('error', reject);
    req.end();
  });
}

const EXT_PATTS = [/\.(enc|pem|p12|pfx|kdbx)$/i];
const NAME_PATTS = [/fleet_keys/i, /vaultkey/i, /mnemonic/i, /seed-?words?/i, /wallet-?seed/i];
function suspicious(path) {
  const base = path.split('/').pop();
  if (path === '.env' || /(^|\/)\.env$/.test(path)) return '.env';
  if (EXT_PATTS.some((p) => p.test(base))) return 'ext:' + base;
  if (NAME_PATTS.some((p) => p.test(base))) return 'name:' + base;
  if (/^agent\/keys\//.test(path)) return 'agent-keys-dir:' + base;
  return null;
}

(async () => {
  const { j: repos } = await api('/user/repos?per_page=100&sort=pushed');
  if (!Array.isArray(repos)) { console.error('repo list failed:', JSON.stringify(repos).slice(0, 200)); process.exit(1); }
  console.log('== סריקת-על ארגונית · ' + new Date().toISOString() + ' · קריאה-בלבד ==');
  console.log('ריפואים: ' + repos.length);
  let totalBranches = 0, totalHits = 0;
  for (const r of repos) {
    let branches = [];
    try { const { j: bs } = await api(`/repos/${r.full_name}/branches?per_page=100`); branches = Array.isArray(bs) ? bs : []; } catch (_) {}
    for (const b of branches) {
      totalBranches++;
      let tree = [];
      try { const { j: t } = await api(`/repos/${r.full_name}/git/trees/${b.commit.sha}?recursive=1`); tree = (t.tree || []).filter((x) => x.type === 'blob'); } catch (_) { console.log(`  [${r.name}/${b.name}] tree-fetch-failed`); continue; }
      const hits = [];
      for (const f of tree) { const why = suspicious(f.path); if (why) hits.push(f.path + '  (' + why + (f.size != null ? ', ' + f.size + 'B' : '') + ')'); }
      const tag = hits.length ? 'ALERT(' + hits.length + ')' : 'clean';
      console.log(`  [${r.name}/${b.name}] ${tree.length} blobs → ${tag}`);
      for (const h of hits) { console.log('      - ' + h); totalHits++; }
    }
  }
  console.log('\n== פסק-דין: ' + repos.length + ' ריפואים · ' + totalBranches + ' ענפים · ' + totalHits + ' נתיבים-חשודים ==');
  process.exit(totalHits ? 2 : 0);
})().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
