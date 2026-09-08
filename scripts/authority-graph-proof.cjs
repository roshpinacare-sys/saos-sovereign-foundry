#!/usr/bin/env node
/**
 * authority-graph-proof.cjs — הוכחת-מפתח-אחד מבוססת גרף-סמכויות (Task 18)
 *
 * השאלה של הבעלים: "אני חייב לוודא שאני יכול להתחבר להכל עם מפתח אחד של steem
 * של headcorner — המפתח הראשי."
 *
 * התשובה שהקוד עצמו נותן (לא דוחות — קוד):
 *   · agent/factory_v2.cjs (mint): כל חשבון-צי נולד עם owner.account_auths=[[headcorner,1]]
 *     ("עוגן-חילוץ · לעולם לא זומבי") — מפתח ה-owner של headcorner שולט בחשבון.
 *   · agent/linkage.cjs (87 · L9): כל חייל נושא את headcorner בסמכות-הפוסטינג
 *     (account_auths, משקל ≥ סף) — "הראש יכול לדבר דרך כל חייל".
 *   · agent/keyrotate.cjs: שומר על account_auths בכל רוטציה — העוגנים שורדים.
 *
 * המאמת הזה לא סומך על שום קובץ-דוח של המערכת — הוא קורא את הסמכויות חי
 * מהשרשרת ומחשב בעצמו. הוא גם לא דורש שום סוד: כל הנתונים ציבוריים.
 *
 * מה שהוא מוכיח לכל חשבון, לכל רשת, לכל תפקיד (owner/active/posting):
 *   REACHABLE  — headcorner מופיע ב-account_auths עם משקל ≥ weight_threshold
 *                → מפתח ה-role המתאים של headcorner מספיק לבדו לחתום בשביל החשבון.
 *   SELF       — זה חשבון headcorner עצמו (key_auths תקינים).
 *   —          — אין עוגן בתפקיד זה (הגישה דרך תפקיד אחר, למשל owner→הכל).
 *
 * שימוש: node scripts/authority-graph-proof.cjs [soldier1 soldier2 ...]
 *   בלי ארגומנטים — הרוסטר המלא מ-fleet_state.json/linkage (12 חיילים).
 * אפס-חתימות · אפס-שידורים · אפס-סודות · קריאה-בלבד.
 */
'use strict';
const https = require('https');

const HEAD = 'headcorner';
const ROLES = ['owner', 'active', 'posting'];
const CHAINS = [
  { name: 'STEEM', urls: ['https://api.steemit.com', 'https://steemapi.boylikegirl.club', 'https://api.justyy.com'] },
  { name: 'HIVE', urls: ['https://api.hive.blog', 'https://api.deathwing.me', 'https://hive-api.arcange.eu'] },
  { name: 'BLURT', urls: ['https://rpc.beblurt.com'] },
];
const DEFAULT_ROSTER = [
  'cashmachine', 'haran', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet', 'israelnews', 'powerspan',
];

function rpc(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 15000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) { reject(new Error('bad rpc response from ' + u.hostname)); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout ' + u.hostname)));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}
async function rpcAny(urls, method, params) {
  let lastErr = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const url of urls) {
      try { return await rpc(url, { jsonrpc: '2.0', method, params, id: 1 }); } catch (e) { lastErr = e; }
    }
  }
  throw lastErr || new Error('all endpoints failed');
}
const getAccount = (chain, name) =>
  rpcAny(chain.urls, 'condenser_api.get_accounts', [[name]])
    .then((r) => (Array.isArray(r) ? r[0] || null : null))
    .catch(() => null);

/** בדיקת-עצמאות של המאמת עצמו: מנגנון הפרשנות של account_auths מול סף — סינתטי */
function selfTest() {
  const mk = (threshold, accountAuths) => ({ weight_threshold: threshold, account_auths: accountAuths, key_auths: [] });
  const ok1 = mk(1, [['headcorner', 1]]);
  const ok2 = mk(2, [['headcorner', 3]]);
  const bad1 = mk(2, [['headcorner', 1]]);   // משקל מתחת לסף — לא מספיק לבדו
  const bad2 = mk(1, [['other', 1]]);
  const v = (auth) => {
    const hit = (auth.account_auths || []).find(([n]) => n.toLowerCase() === HEAD);
    return Boolean(hit && auth.weight_threshold != null && hit[1] >= auth.weight_threshold);
  };
  if (v(ok1) !== true || v(ok2) !== true || v(bad1) !== false || v(bad2) !== false) throw new Error('selftest failed');
  console.log('self-test: פרשנות account_auths≥threshold תקינה (כולל דחיית משקל-נמוך-מהסף)');
}
if (process.argv.includes('--selftest')) { selfTest(); process.exit(0); }

async function main() {
  const argRoster = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const roster = argRoster.length ? argRoster : DEFAULT_ROSTER;
  const targets = [HEAD, ...roster];

  const rows = [];
  const reach = {}; // chainRole -> count
  for (const chain of CHAINS) {
    for (const role of ROLES) reach[chain.name + ':' + role] = { yes: 0, exists: 0 };
  }

  for (const name of targets) {
    for (const chain of CHAINS) {
      const acc = await getAccount(chain, name);
      if (!acc) {
        for (const role of ROLES) rows.push({ chain: chain.name, name, role, verdict: 'ABSENT', detail: 'not found on ' + chain.name });
        continue;
      }
      for (const role of ROLES) {
        const auth = acc[role] || {};
        const threshold = auth.weight_threshold;
        const hit = (auth.account_auths || []).find(([n]) => String(n).toLowerCase() === HEAD);
        const keyCount = (auth.key_auths || []).length;
        if (name === HEAD) {
          reach[chain.name + ':' + role].exists++;
          rows.push({ chain: chain.name, name, role, verdict: keyCount ? 'SELF' : 'NO-KEYS', detail: `threshold=${threshold} · key_auths=${keyCount} · account_auths=${(auth.account_auths || []).length}` });
          continue;
        }
        const reachable = Boolean(hit && threshold != null && hit[1] >= threshold);
        reach[chain.name + ':' + role].exists++; // כל חשבון-קיים נספר במכנה
        if (reachable) { reach[chain.name + ':' + role].yes++; rows.push({ chain: chain.name, name, role, verdict: 'REACHABLE', detail: `weight=${hit[1]} ≥ threshold=${threshold} · key_auths=${keyCount}` }); }
        else { rows.push({ chain: chain.name, name, role, verdict: 'NO-ANCHOR', detail: hit ? `weight=${hit[1]} < threshold=${threshold}` : `no headcorner in account_auths · threshold=${threshold}` }); }
      }
    }
  }

  console.log('\n== הוכחת-גרף-סמכויות: ' + HEAD + ' → צי (קריאה-בלבד · אפס-סודות · חישוב עצמאי מהשרשרת) ==');
  let lastChain = '';
  for (const r of rows) {
    if (r.chain !== lastChain) { console.log('\n[' + r.chain + ']'); lastChain = r.chain; }
    console.log('  @' + r.name.padEnd(12) + r.role.padEnd(8) + r.verdict.padEnd(11) + (r.detail || ''));
  }

  console.log('\n== סיכום הישג-מפתח-אחד (מכנה = חיילים-קיימים ברשת, headcorner עצמו מוחרג) ==');
  for (const chain of CHAINS) {
    const parts = [];
    for (const role of ROLES) {
      const r = reach[chain.name + ':' + role];
      parts.push(role + ': ' + r.yes + '/' + Math.max(0, r.exists - 1));
    }
    console.log('  ' + chain.name.padEnd(6) + 'headcorner מגיע דרך account_auths → ' + parts.join(' · '));
  }
  const ownerReach = CHAINS.reduce((s, c) => s + reach[c.name + ':owner'].yes, 0);
  const postReach = CHAINS.reduce((s, c) => s + reach[c.name + ':posting'].yes, 0);
  console.log('\nפסק-דין:');
  console.log('  · מפתח ה-owner של headcorner = שליטה מלאה (שחזור/החלפת-מפתחות/כל-תפעול) ב-' + ownerReach + ' חשבונות-צי עם עוגן-owner.');
  console.log('  · מפתח ה-posting של headcorner = פרסום דרך ' + postReach + ' חשבונות-צי עם עוגן-posting ("הראש דובר דרך כל חייל").');
  console.log('  · חשבונות ABSENT לא קיימים ברשת זו (לא כשל-סודות). NO-ANCHOR = הגישה דרך תפקיד אחר בלבד.');
  console.log('  · זה לא נגיעה בשום מפתח — הוכחת מבנה-סמכויות חיה בלבד. הצירוף עם master-key-proof.cjs (סיסמה→מפתחות) סוגר את השרשרת המלאה.');
  process.exit(0);
}
main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
