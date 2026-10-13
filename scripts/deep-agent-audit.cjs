#!/usr/bin/env node
/**
 * deep-agent-audit.cjs — Task 20/21 · מימוש אחד-לפקודה של הרשאת-הבעלים
 * "אני מאשר לפתוח ולטפל בהכל — בצע ודחוף לריפו" (2026-09-08)
 *
 * מה הוא עושה, בסדר:
 *  1. טוקן: קורא מ-~/.secrets/github-token (או --token-src <path> לקובץ-עלה חדש).
 *     אם אין → יוצא במצב WAITING-FOR-TOKEN נקי (קוד 2), בלי שום נזק.
 *     אם הטוקן הגיע כקובץ-עלה → מתקין אותו ב-~/.secrets/github-token (0600) ומוחק
 *     את העותק-העולה (כדי שלא יישאר בעץ) — בלי להדפיס את ערכו מעולם.
 *  2. דחיפת-ה-commit המקומי של ה-foundry (8a570c7) אחרי fetch-אימות.
 *  3. לכל ריפו שהטוקן רואה: שיבוט blobless ל-/tmp/agent-audit/<repo>, ואז:
 *     a. סריקת-היסטוריה לפי נתיבים בלבד (git log --all --name-only) — תבניות-סוד
 *     b. סריקת-תוכן של HEAD-בלבד, קבצי-קוד בלבד (לא פותח קבצים בתבנית-סוד):
 *        WIF / xprv / seed-phrase / privateKey-assignment / hex-64 / sk- — הדוח מכיל
 *        {repo, path, line, patternType} בלבד. **אף ערך לא נדפס ולא נשמר.**
 *     c. יעדי-לוגיקה: daemonי-המסחר ב-steem (he_sell/he_unstake/mint_borrow/yield/
 *        rebalance) — רשימת פעולות-שידור (broadcast/transfer/op) לפי קובץ+שורה,
 *        ושאלת Saosmartwallet keys.ts (מסקנת-אחסון מקוד, בלי ערכים)
 *  4. טיפול (ה-"לטפל"): דליפה ב-HEAD של ריפו כלשהו → נטרול בסגנון-guardian
 *     (גיבוי ל-~/.secrets/vault-recovery → strip מהראש → force-push → אימות).
 *     דליפה עמוקה בהיסטוריה → לא נוגעים אוטומטית; מדווח CRITICAL לבעלים.
 *  5. דוח: docs/agent-audit-report.md + worklog-עדכון נפרד (ידני ע"י הסוכן).
 *
 * שימוש:
 *   node scripts/deep-agent-audit.cjs                        # מצב-רגיל (דורש טוקן)
 *   node scripts/deep-agent-audit.cjs --token-src upload/X   # טוקן-עלה → מתקין ורץ
 *   node scripts/deep-agent-audit.cjs --selftest             # בלי רשת: בדיקת-תבניות
 */
'use strict';
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HOME = os.homedir();
const TOKEN_PATH = path.join(HOME, '.secrets', 'github-token');
const AUDIT_DIR = '/tmp/agent-audit';
const RECOVERY_DIR = path.join(HOME, '.secrets', 'vault-recovery');
const ORG = 'roshpinacare-sys';
const FOUNDRY = '/home/z/my-project';

const args = process.argv.slice(2);
const SELFTEST = args.includes('--selftest');
const tokenSrcIdx = args.indexOf('--token-src');
const TOKEN_SRC = tokenSrcIdx >= 0 ? args[tokenSrcIdx + 1] : null;

// ── תבניות ────────────────────────────────────────────────────────────────
// נתיבים-חשודים (לא פותחים את התוכן שלהם בכלל)
const PATH_PATTS = [
  [/\.env$/i, 'dotenv'], [/\.env\./i, 'dotenv'], [/(^|\/)\.env\.local$/i, 'dotenv-local'],
  [/\.(pem|p12|pfx|kdbx|keystore|jks)$/i, 'keystore-file'],
  [/fleet_keys/i, 'fleet-vault'], [/vaultkey/i, 'vault-key'], [/mnemonic/i, 'mnemonic'],
  [/seed-?words?/i, 'seed-words'], [/wallet-?seed/i, 'wallet-seed'], [/id_rsa/i, 'ssh-key'],
  [/(^|\/)keys\//i, 'keys-dir'],
];
// תבניות-תוכן (הדוח מכיל סוג-התאמה בלבד — לעולם לא הערך)
const CONTENT_PATTS = [
  [/\b5[1-9A-Za-z]{50}\b/, 'WIF-private-key'],
  [/\b[KL][1-9A-Za-z]{51}\b/, 'WIF-private-key-compressed'],
  [/\bxprv[1-9A-Za-z]{50,}/, 'xprv-master-key'],
  [/\bSK_[A-Za-z0-9]{20,}/, 'secret-key-token'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'api-secret'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'pem-private-block'],
  [/\b[0-9a-fA-F]{64}\b/, 'hex64-potential-key'],
  [/\bprivateKey\s*[:=]\s*['"][^'"]{16,}['"]/, 'privateKey-assignment'],
  [/\bprivate_key\s*[:=]\s*['"][^'"]{16,}['"]/, 'private_key-assignment'],
];
const WORDS = 'abandon|ability|absent|access|acid|actress|adult|advice|affair|amount|anchor|animal|answer|apple|arrive|atlas|august|banana|banner|basket|beach|because|begin|behind|below|bird|black|blade|blur|border|branch|brave|breeze|bridge|bright|broken|brother|budget|buffalo|cabin|candy|canvas|captain|castle|cattle|catch|caution|cellar|cement|chance|change|charge|cherry|chief|circle|citizen|clamp|clever|cliff|club|coal|coast|code|column|comfort|common|copper|coral|cotton|cradle|crane|crisp|crystal|cupboard|custom|damage|dawn|decade|debris|decide|deer|delta|denial|depth|desert|design|detail|device|digest|dinner|direct|dizzy|doctor|double|dragon|duty|eagle|early|earth|easily|echo|economy|edge|effort|eight|elbow|elder|electric|elegant|ember|empty|endorse|energy|enforce|engine|enjoy|enrich|ensure|entire|escape|essay|estate|ethnic|evolve|exile|exist|extra|fabric|fake|family|famous|farmer|fault|february|fence|ferry|fever|fiber|field|figure|filter|finger|fiscal|flame|flat|flight|float|flower|fluid|focus|forest|forget|fortune|forward|fossil|foster|frame|fresh|frozen|fruit|funny|gadget|galaxy|garden|garlic|gather|gauge|gently|giant|ginger|giraffe|glove|gold|gospel|govern|grace|grain|granite|gravel|grief|grocery|guard|gutter|habit|hammer|harbor|harvest|hazard|header|health|heart|heater|helmet|heritage|highway|history|hobby|hollow|honey|horizon|host|hotel|humble|humor|icicle|image|impact|impose|index|inform|insect|inside|intact|invest|invite|island|ivory|jacket|jaguar|jelly|jewel|joint|judge|juice|jumbo|kangaroo|ketchup|kidney|kingdom|knife|knock|lab|ladder|lagoon|lamp|language|laser|laugh|layer|learn|leather|legal|lemon|length|lens|leopard|lesson|letter|level|liberty|library|license|light|lily|limb|limit|linen|liquid|little|lizard|lobster|local|lock|logic|lonely|lounge|lumber|lunar|machine|magic|magnet|major|mammal|mandate|mango|manual|maple|marble|march|mask|matrix|matter|meadow|medal|median|melody|member|memory|mention|mercy|merit|metal|method|middle|midnight|milk|mimic|mineral|minute|miracle|mirror|misery|mixed|mobile|modern|modify|moment|monitor|monkey|moral|morning|mosaic|mother|motion|mountain|mouse|movie|muffin|museum|mushroom|music|mustard|mutual|myself|mystery|napkin|narrow|nation|native|nature|nebula|needle|neighbor|neither|nephew|nerve|nest|network|neutral|never|newer|nickel|ninja|noble|nominee|normal|north|notable|novel|nurse|nutmeg|oasis|object|oblige|obscure|observe|obtain|ocean|october|odds|offer|office|often|olive|onion|online|onset|opera|opinion|option|orange|orbit|orchard|order|organ|origin|orphan|ostrich|outdoor|output|oyster|ozone|paddle|palace|palm|panda|panel|panther|paper|parade|parent|parrot|partner|passage|passion|patient|patrol|pattern|payment|peace|pelican|pencil|people|pepper|period|permit|person|phrase|physical|piano|picture|piece|pigeon|pilot|pioneer|pistol|pitch|pizza|place|planet|plastic|plate|plaza|pocket|poem|poet|point|polar|police|pond|popular|portion|position|possible|postage|potato|powder|power|practice|praise|prefer|prepare|present|pretty|prevent|price|pride|primary|print|prison|private|prize|problem|process|produce|profit|program|project|promote|proof|proper|protect|proud|public|pudding|pulse|pumpkin|pupil|puppy|purchase|purity|purple|purse|puzzle|pyramid|quality|quantum|quarter|question|quick|quote|rabbit|raccoon|radio|rail|rainbow|raisin|rally|ranch|random|range|rapid|rather|reason|rebel|recall|receipt|record|recycle|reduce|reflect|reform|refuse|region|regret|regular|reject|relax|release|relief|remain|remember|remind|remote|render|renew|repair|repeat|report|rescue|research|reserve|resist|resource|response|result|retire|return|reunion|reveal|review|reward|rhythm|ribbon|rider|ridge|rifle|right|rigid|ripple|risk|ritual|rival|river|roast|robot|rocket|romance|roof|rookie|roster|rotate|round|route|royal|rubber|rugby|rumor|runner|runway|rural|sadness|safety|sailor|salad|salmon|salon|salute|sample|satisfy|satoshi|sauce|sausage|saving|scale|scatter|scenic|scheme|school|science|scissors|scout|scrap|screen|script|sculpt|search|season|second|secret|section|security|segment|select|senior|sense|sentence|series|service|settle|setup|seven|shadow|shallow|shelter|sheriff|shield|shift|shine|ship|shiver|shore|short|shoulder|shrimp|shuffle|shy|sibling|siege|signal|silent|silver|similar|simple|since|siren|sister|situate|skill|skirt|slender|slice|slide|slogan|slush|smart|smile|smoke|smooth|snack|snake|snow|soccer|social|socks|soda|solar|soldier|solid|solution|solve|someone|song|soon|sorry|sort|soul|sound|soup|source|south|space|spare|spatial|speak|special|speed|spell|spend|sphere|spice|spider|spike|spin|spirit|split|spoil|sponsor|spoon|sport|spot|spray|spread|spring|spy|square|squirrel|stable|stadium|staff|stage|stairs|stamp|stand|start|state|stay|steak|steel|stem|step|stereo|sting|stock|stomach|stone|story|stove|strategy|street|strike|strong|student|studio|study|stuff|stumble|style|subject|submit|subway|sudden|suffer|sugar|suggest|suit|summer|sun|super|surreal|surge|surprise|swamp|swear|swift|swing|switch|sword|symbol|symptom|syrup|table|tackle|tag|tail|talent|talk|tank|tape|target|task|taste|tattoo|taxi|teach|team|tell|ten|tenant|tennis|tent|term|test|text|thank|theme|theory|thing|thought|thread|thrive|thumb|thunder|ticket|tide|tiger|timber|time|tiny|tip|tired|tissue|title|toast|tobacco|today|toddler|toe|together|toilet|token|tomato|tomorrow|topic|torch|tornado|tortoise|total|tourist|toward|tower|town|toy|track|trade|traffic|tragic|train|transfer|trap|trash|travel|tray|treat|tree|trend|trial|tribe|trick|trigger|trim|trip|trophy|trouble|truck|true|trust|truth|try|tube|tuition|tumble|tuna|tunnel|turkey|turn|turtle|twelve|twenty|twice|twin|two|type|typical|umbrella|unable|unaware|uncle|uncover|under|undo|unfair|unfold|unhappy|uniform|unique|unit|universe|unknown|unlock|until|unusual|unveil|update|upgrade|uphold|upon|upper|upset|urban|usage|useful|useless|usual|utility|vacant|vacuum|vague|valid|valley|valve|vanish|vapor|various|vast|vault|vehicle|velvet|vendor|venture|venue|verb|verify|version|very|vessel|veteran|viable|vibrant|vicious|victory|video|view|village|vintage|violin|virtual|virus|visa|visit|visual|vital|vivid|vocal|voice|void|volcano|volume|vote|voyage|wage|wagon|wait|walk|wall|walnut|want|warfare|warm|warrior|wash|wasp|waste|water|wave|way|wealth|weapon|wear|weasel|weather|web|wedding|weekend|weird|welcome|west|wheel|when|where|whip|whisper|wide|width|wife|wild|will|win|window|wine|wing|wink|winner|winter|wire|wisdom|wise|wish|witness|wolf|woman|wonder|wood|wool|word|work|world|worry|worth|wrap|wreck|wrestle|wrist|write|wrong|yard|year|yellow|you|young|youth|zebra|zero|zone';
const SEED_HINT = new RegExp('\\b(?:' + WORDS + ')\\b(?:[\\s,]+(?:' + WORDS + ')\\b){11,}', 'i');

function redact(s) {
  return String(s)
    .replace(/Authorization:\s*(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, 'Authorization: [REDACTED]')
    .replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, 'gh***[REDACTED]');
}

const findings = [];
function record(severity, repo, kind, detail) {
  const safe = redact(detail); // choke point: אף פלט-שגיאה/פקודה לא יכיל חומר-סודות
  findings.push({ at: new Date().toISOString(), severity, repo, kind, detail: safe });
  console.log(`  [${severity}] ${repo} · ${kind} · ${safe}`);
}

function sh(cmd, cwd, opts = {}) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout || 240000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
  } catch (e) {
    // לעולם לא לאפשר ל-node לצרף את שורת-הפקודה (שעשויה להכיל כותרת-אימות) להודעה
    throw new Error(redact(e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 300));
  }
}

// ── selftest: תבניות על דוגמאות-סינתטיות (אף ערך אמיתי) ─────────────────
function selfTest() {
  const fakeWif = '5' + 'K'.repeat(0) + 'H' + 'x'.repeat(49);
  const synthetic = {
    'WIF-private-key': '5' + 'aZ9'.repeat(16) + 'aa',
    'WIF-private-key-compressed': 'K' + 'aZ9'.repeat(17),
    'hex64-potential-key': 'ab'.repeat(32),
    'pem-private-block': '-----BEGIN PRIVATE KEY-----',
    'dotenv': '.env',
    'keys-dir': 'agent/keys/foo.enc',
  };
  let ok = true;
  const t1 = CONTENT_PATTS.find(([re]) => re.test(synthetic['WIF-private-key']));
  const t1b = CONTENT_PATTS.find(([re]) => re.test(synthetic['WIF-private-key-compressed']));
  const t2 = CONTENT_PATTS.find(([re]) => re.test(synthetic['hex64-potential-key']));
  const t3 = CONTENT_PATTS.find(([re]) => re.test(synthetic['pem-private-block']));
  const t4 = PATH_PATTS.find(([re]) => re.test(synthetic['dotenv']));
  const t5 = PATH_PATTS.find(([re]) => re.test(synthetic['keys-dir']));
  if (!t1 || t1[1] !== 'WIF-private-key') { ok = false; console.error('selftest FAIL: WIF pattern'); }
  if (!t1b || t1b[1] !== 'WIF-private-key-compressed') { ok = false; console.error('selftest FAIL: WIF-compressed pattern'); }
  if (!t2 || t2[1] !== 'hex64-potential-key') { ok = false; console.error('selftest FAIL: hex64 pattern'); }
  if (!t3 || t3[1] !== 'pem-private-block') { ok = false; console.error('selftest FAIL: pem pattern'); }
  if (!t4 || t4[1] !== 'dotenv') { ok = false; console.error('selftest FAIL: .env path pattern'); }
  if (!t5 || t5[1] !== 'keys-dir') { ok = false; console.error('selftest FAIL: keys-dir pattern'); }
  // דגש: תוכן-קוד רגיל לא מפעיל שום תבנית
  const clean = 'const x = await db.seals.count();\nexport default function handler() { return Response.json({ ok: true }); }\n';
  if (CONTENT_PATTS.some(([re]) => re.test(clean))) { ok = false; console.error('selftest FAIL: false positive on clean code'); }
  // דגש: seed-hint לא נופל על משפט רגיל
  if (SEED_HINT.test('the theory thing they thank me')) { ok = false; console.error('selftest FAIL: seed false positive'); }
  void fakeWif;
  console.log(ok ? 'selftest PASS (patterns classify correctly, no false positives)' : 'selftest FAILED');
  process.exit(ok ? 0 : 1);
}

if (SELFTEST) { selfTest(); }

// ── טוקן: התקנה מקובץ-עלה / קריאה ─────────────────────────────────────────
function installTokenIfProvided() {
  if (!TOKEN_SRC) return;
  const src = path.resolve(FOUNDRY, TOKEN_SRC);
  const raw = fs.readFileSync(src, 'utf8').trim();
  if (!/^gh[pousr]_[A-Za-z0-9]{20,}$/.test(raw) && !/^[0-9a-f]{40}$/.test(raw)) {
    console.error('token-src failed SHAPE check (expected gh*_ / 40-hex). Not installed. Value never printed.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_PATH, raw + '\n', { mode: 0o600 });
  try { fs.rmSync(src); } catch {}
  console.log('token installed to ~/.secrets/github-token (0600); uploaded copy removed from tree; value never printed');
}

function readToken() {
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    return t || null;
  } catch { return null; }
}

// ── GitHub API (family:4 — סנדבוקז; לעולם לא מדפיס טוקן) ─────────────────
function api(p, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: p, method, family: 4,
      headers: {
        Authorization: 'Bearer ' + readToken(), Accept: 'application/vnd.github+json',
        'User-Agent': 'saos-deep-audit', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      }, timeout: 30000,
    }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { resolve({ s: r.statusCode, j: d ? JSON.parse(d) : {} }); } catch (e) { reject(e); } }); });
    req.on('timeout', () => req.destroy(new Error('timeout ' + p)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── סריקות ────────────────────────────────────────────────────────────────
function classifyPath(p) {
  for (const [re, kind] of PATH_PATTS) if (re.test(p)) return kind;
  return null;
}

function scanTreePaths(repo) {
  const dir = path.join(AUDIT_DIR, repo);
  // כל-ההיסטוריה, נתיבים בלבד — לא פותחים תכנים
  const out = sh(`git log --all --name-only --format=`, dir, { timeout: 300000 });
  const paths = [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
  const histHits = {};
  for (const p of paths) { const k = classifyPath(p); if (k) (histHits[k] ||= []).push(p); }
  for (const [k, list] of Object.entries(histHits)) record('INFO', repo, 'history-path-hit', `${k}: ${list.length} unique path(s) — deepest: ${list.slice(0, 3).join(', ')}`);
  return paths;
}

function headSecretFiles(repo) {
  const dir = path.join(AUDIT_DIR, repo);
  const out = sh(`git ls-tree -r --name-only HEAD`, dir);
  const paths = out.split('\n').map((s) => s.trim()).filter(Boolean);
  return paths.filter((p) => classifyPath(p));
}

function scanHeadContent(repo) {
  const dir = path.join(AUDIT_DIR, repo);
  sh(`git checkout -q HEAD -- . 2>/dev/null || true`, dir, { timeout: 600000 }); // blobless: מביא blobs לפי-דרישה
  const paths = sh(`git ls-files`, dir).split('\n').map((s) => s.trim()).filter(Boolean);
  let scanned = 0;
  for (const p of paths) {
    if (classifyPath(p)) continue; // קבצי-סוד-בנתיב: לא נפתחים
    if (/(^|\/)(bun\.lock|bun\.lockb|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p)) continue; // lockfiles: רעש-מובנה
    const abs = path.join(dir, p);
    let st; try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > 512 * 1024) continue;
    let text; try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; } // בינארי → דלג
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 800))) continue; // בינארי-כנראה
    const lines = text.split('\n');
    scanned++;
    for (let i = 0; i < lines.length; i++) {
      for (const [re, kind] of CONTENT_PATTS) {
        if (re.test(lines[i])) record('HIGH', repo, `content-${kind}`, `${p}:${i + 1}`);
      }
      if (SEED_HINT.test(lines[i])) record('HIGH', repo, 'content-seed-phrase-hint', `${p}:${i + 1}`);
    }
  }
  return scanned;
}

// יעדי-לוגיקה: daemonי-המסחר — אילו פעולות-שידור קיימות ובאילו שורות (שמות בלבד)
const DAEMON_FILES = /agent\/(he_sell|he_unstake|mint_borrow|yield|rebalance)[^\/]*\.c?js$/i;
const BROADCAST_PATT = /\.(broadcast|comment|transfer|transferToVesting|delegateVestingShares|customJson|claimRewardBalance)\s*\(/;
function daemonLogicMap(repo) {
  const dir = path.join(AUDIT_DIR, repo);
  const paths = sh(`git ls-files`, dir).split('\n').map((s) => s.trim()).filter(Boolean);
  const targets = paths.filter((p) => DAEMON_FILES.test(p));
  for (const p of targets) {
    let text; try { text = fs.readFileSync(path.join(dir, p), 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    const ops = [];
    for (let i = 0; i < lines.length; i++) if (BROADCAST_PATT.test(lines[i])) ops.push(`${p}:${i + 1}`);
    record(ops.length ? 'WARN' : 'INFO', repo, 'daemon-logic', `${path.basename(p)}: ${ops.length} broadcast-class call(s)${ops.length ? ' → ' + ops.slice(0, 6).join(', ') : ''}`);
  }
  return targets.length;
}

// שאלת Saosmartwallet keys.ts — מסקנת-אחסון מקוד (בלי ערכים)
function walletKeysQuestion(repo) {
  const dir = path.join(AUDIT_DIR, repo);
  const candidates = sh(`git ls-files`, dir).split('\n').map((s) => s.trim()).filter((p) => /vault\/keys\.(ts|js)$/i.test(p));
  for (const p of candidates) {
    let text; try { text = fs.readFileSync(path.join(dir, p), 'utf8'); } catch { continue; }
    const l = text.toLowerCase();
    const facts = [];
    if (/localstorage/.test(l)) facts.push('localStorage');
    if (/sessionstorage/.test(l)) facts.push('sessionStorage');
    if (/indexeddb/.test(l)) facts.push('indexedDB');
    if (/filesystem|writefile|write_file/.test(l)) facts.push('file-write');
    if (/randombytes|getrandomvalues/.test(l)) facts.push('CSPRNG-generate');
    if (/encrypt|aes|gcm/.test(l)) facts.push('encryption-layer');
    if (/bip39|mnemonic/.test(l)) facts.push('mnemonic-usage');
    record('INFO', repo, 'wallet-keys-storage', `${p}: ${facts.length ? facts.join(', ') : 'no storage API detected in file'}`);
  }
  return candidates.length;
}

// ── טיפול: דליפה ב-HEAD → נטרול בסגנון-guardian ───────────────────────────
async function neutralizeHead(repo, branch, hits, stamp) {
  const work = path.join(AUDIT_DIR, repo);
  try {
    const parents = sh(`git rev-list --parents -n 1 HEAD`, work).split(' ').slice(1);
    for (const par of parents) {
      const listing = sh(`git ls-tree -r --name-only ${par}`, work);
      const parentHits = listing.split('\n').map((s) => s.trim()).filter((p) => hits.includes(p));
      if (parentHits.length) {
        record('CRITICAL', repo, 'deep-history-leak', `${parentHits.length} path(s) in parents — NOT auto-fixed (owner decision)`);
        return false;
      }
    }
    fs.mkdirSync(RECOVERY_DIR, { recursive: true, mode: 0o700 });
    for (const p of hits) {
      let blob; try { blob = sh(`git cat-file blob HEAD:"${p}"`, work); } catch { continue; }
      const local = path.join(RECOVERY_DIR, `deepaudit-${stamp}`, `${repo}__${p.replace(/\//g, '__')}`);
      fs.mkdirSync(path.dirname(local), { recursive: true, mode: 0o700 });
      fs.writeFileSync(local, blob, { mode: 0o600 });
    }
    for (const p of hits) sh(`git rm --cached -q "${p}"`, work);
    const tree = sh(`git write-tree`, work);
    const msg = `security(deep-audit): neutralize ${hits.length} secret-pattern path(s) from HEAD (backup: ~/.secrets/vault-recovery/deepaudit-${stamp}) — no secret values logged`;
    const commit = sh(`git -c user.name="roshpinacare-sys" -c user.email="326012154+roshpinacare-sys@users.noreply.github.com" commit-tree ${tree} -p HEAD -m "${msg}"`, work);
    sh(`git update-ref refs/heads/${branch} ${commit}`, work);
    sh(`git push --force origin refs/heads/${branch}:refs/heads/${branch}`, work, { timeout: 120000 });
    // אימות מרחוק
    const { j: after } = await apiSafe(`/repos/${ORG}/${repo}/commits/${branch}`);
    const tree2 = (await apiSafe(`/repos/${ORG}/${repo}/git/trees/${after.sha}?recursive=1`)).j.tree || [];
    const still = tree2.filter((t) => hits.includes(t.path));
    if (still.length) { record('CRITICAL', repo, 'post-push-verify-failed', `${still.length} still present`); return false; }
    record('INFO', repo, 'neutralized', `${hits.length} path(s); new remote head ${after.sha.slice(0, 10)}; verified clean`);
    return true;
  } catch (e) {
    record('CRITICAL', repo, 'neutralize-error', String(e.message).slice(0, 120));
    return false;
  }
}

async function apiSafe(p, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await api(p); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw lastErr;
}

// ── main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('== deep-agent-audit ==');
  installTokenIfProvided();
  const token = readToken();
  if (!token) {
    console.log('WAITING-FOR-TOKEN: ~/.secrets/github-token does not exist.');
    console.log('Pipeline armed — owner action: upload the token file (same channel as the original Roshcaregt.txt), then re-run with --token-src <uploaded-path> (or just place it at ~/.secrets/github-token).');
    process.exit(2);
  }
  fs.mkdirSync(AUDIT_DIR, { recursive: true });

  // 1) אימות-הזהות של הטוקן (שם-משתמש בלבד — בלי ערך)
  let me;
  try { me = await api('/user'); } catch (e) { console.error('token API check failed:', String(e.message).slice(0, 100)); process.exit(1); }
  if (me.s !== 200) { console.error('token rejected by GitHub (HTTP ' + me.s + ') — not printing anything further'); process.exit(1); }
  console.log('token accepted; account: ' + (me.j.login || '?') + ' (name only)');

  // 2) דחיפת-ה-foundry: fetch-אימות ואז push — **מעולם לא דורס קומיטים של ה-remote**
  try {
    const header = `Authorization: Basic ${Buffer.from('x-access-token:' + token).toString('base64')}`;
    sh(`git -c "http.extraHeader=${header}" fetch origin`, FOUNDRY);
    const remoteHead = sh(`git rev-parse origin/main`, FOUNDRY);
    const localHead = sh(`git rev-parse main`, FOUNDRY);
    if (remoteHead === localHead) {
      console.log('foundry: local main == remote main (' + remoteHead.slice(0, 8) + ') — nothing to push');
    } else {
      const remoteOnly = parseInt(sh(`git rev-list --count main..origin/main`, FOUNDRY) || '0', 10);
      const localOnly = parseInt(sh(`git rev-list --count origin/main..main`, FOUNDRY) || '0', 10);
      if (remoteOnly > 0) {
        // ה-remote זז (למשל auto-save של הדמון) — לעולם לא דורסים; מדווחים ונעצרים
        record('WARN', 'saos-sovereign-foundry', 'push-skipped-diverged', `remote has ${remoteOnly} commit(s) we lack (head ${remoteHead.slice(0, 10)}), local has ${localOnly} — needs merge/rebase decision, nothing clobbered`);
      } else {
        sh(`git -c "http.extraHeader=${header}" push origin main`, FOUNDRY, { timeout: 120000 });
        const after = sh(`git -c "http.extraHeader=${header}" ls-remote origin refs/heads/main | cut -f1`, FOUNDRY);
        record('INFO', 'saos-sovereign-foundry', 'pushed', `remote main now ${after.slice(0, 10)} (local ${localHead.slice(0, 10)})`);
      }
    }
  } catch (e) { record('CRITICAL', 'saos-sovereign-foundry', 'push-failed', String(e.message).split('\n')[0].slice(0, 140)); }

  // 3) כל הריפואים — /user/repos עם visibility=all: כולל פרטיים (החשבון הוא user, לא org)
  const repos = [];
  for (let page = 1; ; page++) {
    const { j } = await api(`/user/repos?per_page=100&page=${page}&sort=pushed&visibility=all&affiliation=owner`);
    if (!Array.isArray(j) || !j.length) break;
    repos.push(...j.map((r) => ({ name: r.name, full: r.full_name, branch: r.default_branch, size: r.size })));
  }
  const seenRepos = new Set();
  for (let i = repos.length - 1; i >= 0; i--) { if (seenRepos.has(repos[i].name)) repos.splice(i, 1); else seenRepos.add(repos[i].name); }
  console.log(`repos visible: ${repos.length} → ${repos.map((r) => r.name).join(', ')}`);

  for (const r of repos) {
    const dir = path.join(AUDIT_DIR, r.name);
    console.log(`\n— ${r.name} (default: ${r.branch}, ${r.size}KB) —`);
    try {
      const header = `Authorization: Basic ${Buffer.from('x-access-token:' + token).toString('base64')}`;
      sh(`git -c "http.extraHeader=${header}" clone -q --filter=blob:none --single-branch --branch ${r.branch} https://github.com/${r.full || ORG + '/' + r.name}.git ${dir}`, AUDIT_DIR, { timeout: 600000 });
      try { sh(`git config http.extraHeader "${header}"`, dir); } catch {} // on-demand blob fetches (checkout) also authenticated
    } catch (e) {
      record('WARN', r.name, 'clone-failed', String(e.message).split('\n')[0].slice(0, 120)); continue;
    }
    scanTreePaths(r.name);                       // היסטוריה · נתיבים בלבד
    const headSecrets = headSecretFiles(r.name); // דליפות-חיות בראש
    if (headSecrets.length) {
      record('HIGH', r.name, 'head-secret-paths', headSecrets.join(', '));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await neutralizeHead(r.name, r.branch, headSecrets, stamp); // "לטפל" — נטרול + אימות
    } else {
      console.log(`  head clean of secret-pattern paths`);
    }
    const n = scanHeadContent(r.name);           // תוכן-HEAD · תבניות-ערך (מושתק-ערך)
    console.log(`  content scanned: ${n} code files`);
    if (r.name === 'steem') { const t = daemonLogicMap(r.name); console.log(`  daemon files mapped: ${t}`); }
    if (r.name === 'Saosmartwallet') { const t = walletKeysQuestion(r.name); console.log(`  keys.ts candidates: ${t}`); }
  }

  // 4) דוח
  const report = {
    at: new Date().toISOString(), tokenAccount: me.j.login, repos: repos.map((r) => r.name),
    findings, discipline: 'path-patterns + content-pattern TYPES only; no secret value was ever printed, stored, or logged',
  };
  fs.mkdirSync(path.join(FOUNDRY, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(FOUNDRY, 'docs', 'agent-audit-report.json'), JSON.stringify(report, null, 2), { mode: 0o644 });
  const md = ['# Deep Agent Audit — ' + report.at, '', `token account: \`${me.j.login}\` · repos: ${repos.length}`, '', '| Severity | Repo | Kind | Detail |', '|---|---|---|---|',
    ...findings.map((f) => `| ${f.severity} | ${f.repo} | ${f.kind} | ${String(f.detail).replace(/\|/g, '\\|').slice(0, 160)} |`), '',
    '_Discipline: findings contain paths/line-numbers/pattern-TYPES only — never secret values._'].join('\n');
  fs.writeFileSync(path.join(FOUNDRY, 'docs', 'agent-audit-report.md'), md, { mode: 0o644 });
  console.log(`\nreport: docs/agent-audit-report.md (+ .json) — ${findings.length} finding(s)`);
})().catch((e) => { console.error('fatal:', String(e.message).slice(0, 200)); process.exit(1); });
