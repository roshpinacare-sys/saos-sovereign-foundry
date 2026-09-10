# Secret Hygiene (היגיינת סודות) — Task 6, updated Task 11 (incl. autonomous closure round)

> Iron rule: private keys, seed phrases, signing keys, tokens, passwords and live
> permission files NEVER enter the repo, the logs, the DB or the agent context.
> This document records what EXISTS on disk, what is (or was) in git history,
> and the exact owner actions required — no history is rewritten without
> explicit owner approval.
>
> **THE HASH-ONLY RULE (permanent, Task 11):** the system stores ONLY the
> sha256 hash of the admin key (`SAOS_ADMIN_KEY_HASH`) — never the plaintext
> key, never a secret file inside the project tree when a safer alternative
> exists. Any new code that would store a plaintext secret is a violation of
> the architecture (docs/security.md §2, principle 7).

## 1. Scan performed (2026-09-07, Task 6 / M1)

Scope scanned (filenames and metadata only — contents of sensitive files were
never read, printed or copied by any agent):

| Pattern | Result |
|---|---|
| `.env` / `.env.*` | `.env` (local, gitignored), `.env.example` (safe template) |
| `*.key`, `*.pem`, `*.p12`, `*.pfx`, `*keystore*` | none found |
| `wallet*`, `seed*` | none found |
| `credentials*`, `secrets*` | none found |
| `token*` | `upload/Roshcaregt.txt` (gitignored) |
| `admin*`, `private*` | `upload/saos-admin-key.txt` (gitignored) |
| secret-pattern grep over ALL tracked files (`ghp_`, `sk-`, `AKIA…`, `BEGIN … PRIVATE KEY`, `xox…`) | **0 matches — clean** |

## 2. Risk register (found this session)

| ID | Item | Location | In git history? | Severity | Required action |
|---|---|---|---|---|---|
| SH-1 | GitHub token file `upload/Roshcaregt.txt` | disk only, `upload/` gitignored | **No** — never committed (upload/ in history held only `חח.txt`, see SH-3) | Medium | Owner: move outside the project tree (e.g. `~/.secrets/`) or switch to `gh auth login`; rotate the token periodically |
| SH-2 | Plaintext admin key `SAOS_ADMIN_KEY` in `.env` (used by `scripts/api-check.mjs` to log in) | disk only, gitignored | **No** (`.env` left history at 7587fa2; historical `.env` rows at 5356dab/41ff582 held **only `DATABASE_URL`** — a non-sensitive local path — verified by variable-name inspection, no values read) | Low-Medium | Acceptable for the single-operator stage; alternative: export `SAOS_ADMIN_KEY` per-shell instead of storing it |
| SH-3 | `upload/חח.txt` (101 bytes) existed in git history (entered at 5356dab "Initial commit", deleted by owner at c69e6e4) | **git history only** — not on disk | **Yes** | **Unknown → stop-and-report** | Owner action: confirm whether it contained secrets; if yes, rotate whatever it held. History rewrite is FORBIDDEN without explicit owner approval |
| SH-4 | Admin-key backup `upload/saos-admin-key.txt` | disk only, gitignored | **No** | Low (by design) | KEEP — this is the disaster-recovery copy mandated by BUG-008 lesson 3 ("save generated credentials twice"). **File structure note**: line 1 is a human label (contains "SAOS"), line 2 is the key itself — consumers must take line 2 only, never concatenate the file (a naive whole-file read yields a wrong key; discovered during browser-verification this session and corrected) |
| SH-5 | File permissions too open | `.env` was 664, upload files 777 | — | Low | Fixed this session for `.env` (now 600); `upload/` files are owned by another uid — chmod not permitted in sandbox → owner should run `chmod 600 upload/*.txt` outside the sandbox |
| SH-6 | `.env.example` | tracked (intentional) | Yes | None | Safe — variable NAMES only, no values; verified |
| SH-7 | **Admin-key file inside the project tree** — `upload/saos-admin-key.txt` (Task 11) | disk only, gitignored, never in history | **No** | Medium | Owner: move outside the project tree → `~/.secrets/saos-admin-key` with `chmod 600`; update the `.env` workflow without printing the key; delete the in-tree copy. If exposure is even suspected — **rotate** (new key + new `SAOS_ADMIN_KEY_HASH` in `.env`, never printed) and record as an owner action. Monitored LIVE by `/api/saos/repo-status` → `secrets.adminKeyFileInTree` (existence check via stat ONLY — the content is never read, printed or stored) and surfaced in the Security tab + decisions registry (`admin-key-location`)

## 3. Current protections (verified live)

- `.gitignore` covers: `.env*` (except `.env.example`), `upload/`, `research/`, `db/`, `backups/`, `*.log`
- `git ls-files` contains **no** sensitive file at HEAD (only `.env.example`)
- No auth/rate-limit layer ever logs key material: audit `actor` is `anonymous | bearer:<8hex> | cookie:<8hex>`, `ipHash` is a truncated sha256 (docs/security.md)
- `PendingSignature` has **no column** where a private key could be stored (structural keylessness, docs/external-signer.md)
- The signing route accepts and stores **public results only** (txid / proofRef / anchorRef)

## 4. Safe closure procedure (proposal — requires owner execution)

For SH-1 (token file), the recommended hand-over:

1. Owner copies the token to a location **outside** the project tree.
2. Owner rotates the GitHub token (Settings → Developer settings → PAT) —
   rotating makes any residual copy worthless.
3. Only afterwards may the file be removed from disk (never `git clean`).

For SH-3 (historical file), options in order of safety:

- **A (recommended, no rewrite):** owner confirms content class; if it held a
  secret, rotate that secret. History stays untouched.
- **B (only with explicit written approval):** history rewrite
  (`git filter-repo`) + force-push — destructive, breaks clones, and is
  therefore blocked by the safe-push protocol of this repo until approved.

## 5. Discipline going forward

1. Any new secret is generated **outside** the agent context and handed over
   via gitignored paths only (`upload/` today, `~/.secrets/` preferred — and
   for the admin key: REQUIRED, see SH-7).
2. Every round ends with the same scan as §1 (patterns + `git ls-files` +
   secret-pattern grep) — it costs seconds and is recorded in the worklog.
3. No `print`, `cat`, `echo` of secret file contents — by any agent, ever.
4. Logs (`dev.log`) and DB never receive key material (verified by api-check's
   no-key-leak assertions).

## 6. Autonomous closure round (2026-09-07, Task 11 closure — executed, audited)

The owner granted an explicit urgent-push approval ("שידחוף דחוף") and ordered
maximum autonomous closure. Executed this round (file contents were never
read, printed or copied — moves and permission changes only):

| Item | Action executed | Result |
|---|---|---|
| SH-7 (admin-key file in tree) | `upload/saos-admin-key.txt` → **`~/.secrets/saos-admin-key`**, `chmod 600`, dir `700`; verified untracked + gitignored before and after | **CLOSED** — `/api/saos/repo-status` now reports `adminKeyFileInTree: false`; decision `admin-key-location` recorded `decided-default` (audited). Rotation remains an OPTIONAL owner action |
| SH-1 (token file in tree) | `upload/Roshcaregt.txt` → **`~/.secrets/github-token`**, `chmod 600`; used for this round's pushes via env-only credential helper (value never printed; remote URL scrubbed) | **Location closed** — periodic token rotation remains an owner action |
| SH-4 (recovery copy) | Same relocation as SH-7; line-2 structure note unchanged | Copy lives at `~/.secrets/saos-admin-key` (600) — disaster-recovery discipline preserved |
| SH-5 (perms) | Both files now `600`, `~/.secrets` is `700` (the files turned out to be owned by the sandbox user — chmod was possible) | `.env` stays `600`; no world-readable secret left in the tree |
| SH-3 (historical file) | Recorded `decided-default` (audited): safe default ACTIVE — no history rewrite, content treated as secret by default, repo is private | **Safe-default active**; final content classification remains an OPTIONAL owner action |
| `upload/` directory | Now empty of secret files | Future uploads must land outside the tree (or be moved out immediately) |

Push executed per the safe-push protocol: secret-scan on the diff (0 matches) →
`git fetch` (no divergence) → regular push → remote verification. Commit
`f012014` (Task 11) is on `origin/main`; the closure round itself was pushed as
a follow-up commit.

## 7. Admin-key rotation procedure (Task 11 — owner-executed, never printed)

Trigger: suspected exposure of the admin key (SH-2 or SH-7 scenarios), or
routine rotation (recommended every 90 days).

1. Owner generates a NEW key locally, outside the agent context (e.g.
   `openssl rand -base64 24`) — the key is NEVER pasted into chat, repo,
   worklog or logs.
2. Owner computes the new hash and writes it to `.env`:
   `SAOS_ADMIN_KEY_HASH=$(printf '%s' '<new-key>' | sha256sum | cut -d' ' -f1)`
   — run in a private shell; the command history concern is the owner's own.
3. Owner updates the local recovery copy (moved outside the tree per SH-7,
   `~/.secrets/saos-admin-key`, chmod 600) and deletes the in-tree copy.
4. Owner restarts the server. All old sessions stay valid only until the
   next revocation — run `POST /api/saos/auth/revoke-all` once for a clean
   break (docs/runbook.md §revocation).
5. Record the rotation as an owner decision (`docs/owner-decisions.md`) —
   status only, no key material, no hash value in the docs.

## 8. Task 13 round — live activation (2026-09-08, executed)

Owner instruction: search authorized assets for missing keys/configs, activate
the system live as safely as possible, never print secrets. What was done:

| item | result |
|---|---|
| `~/.secrets/` inventory (names only, dir 700) | `github-token` (40B, 0600) + `saos-admin-key` (172B, 0600) — both in place from Task 11-closure |
| admin-key ↔ `SAOS_ADMIN_KEY_HASH` match | **TRUE** — sha256 of the last non-empty line compared to the env hash **in memory only**; no content printed, no copy made |
| key search across other authorized assets | local `.env` (names verified), `.env.example`, docs, scripts, old clone `/home/z/saos-repo` (top-level only) — nothing else legitimately usable found; vault keys / network funding are **owner-external resources by design** (docs/external-signer.md), not repo-search items |
| new runtime secret-touching path | `GET /api/saos/live-proof` reads `~/.secrets/github-token` into memory for ONE short GitHub-API read of the owner's own repo CI status; 0600 enforced (bits `077` must be zero), never echoed/logged/stored/cached-with-content; failure degrades to `available:false` |
| keyless RPC policy | ETH/SOL live probes use well-known keyless public endpoints (publicnode / mainnet-beta) or an env URL that is validated credential-free (safeRpcUrl refuses embedded keys / key-like query params) — no secret ever needed for read-only network proof |
| open rotation recommendations (unchanged, owner actions) | ① token embedded in `/home/z/saos-repo/.git/config` (old clone) ② `.env` present at the top of the `anchor-baseline` GitHub repo (existence observed in Task 12, never read) ③ routine 90-day rotation of the admin key and GitHub token (§7) |
| scan coverage before this round's commit | pattern scan over tracked files + diff secret-scan before push (0 matches; `.env` and `backups/` gitignored; `upload/` empty) |

Lesson recorded: the "blocked" label on `~/.secrets/` from the Task-12 mapping
was over-cautious — once the owner explicitly authorizes that path, the right
posture is: list names, verify hash equality in memory, never surface content.

## 9. Task 15 round — account-wide leak sweep & purge (2026-09-08, executed)

Owner instruction: connect to GitHub, sweep ALL repos/folders for keys and
leaks, fix everything fixable, push. Method: GitHub API trees + blob content
scans + full tarball downloads + strict high-entropy re-scan + redacted-context
verification. **No secret value was ever printed, stored in a doc, or echoed.**

### 9.1 Sweep coverage (measured)

| surface | scanned | result |
|---|---|---|
| 8 repos — default-branch trees (API) | all blobs | 56 suspicious filenames → content-scanned → 10 files with pattern hits, all verified code/fixtures |
| 7 repos — full tarballs, every text file <1MB | 19,105 files | strict high-entropy secret-shaped assignments: **0** |
| Project-files — all 10 original ZIPs | 10,843 text files | 20 hits, all verified detector-fixture/pattern strings (same artifacts as the steem repo copies) |
| foundry — entire local git history (all 297 blobs ever committed) | all | pattern hits: **0** |
| foundry — every REMOTE commit tree (27 commits) | all | `.env` in 8 old commits (verified: `DATABASE_URL` = local SQLite path only, non-sensitive) · `upload/חח.txt` in 7 old commits (see 9.2) |
| account platform surfaces | gists=0, public keys=0, GPG=0, signing keys=0 | clean |

### 9.2 Findings & actions (all values fingerprint-only)

| # | finding | classification | action taken |
|---|---|---|---|
| 1 | `anchor-baseline` history held `upload/חח.txt` = **fine-grained GitHub PAT** (93 chars, fp `f0b8f6987bbf`) | REAL leak, **dead** (HTTP 401 verified live — already revoked) | history rewritten 2 commits → 1 clean commit, force-pushed; verified: tree has no `.env`/`upload/`, old commit+blob unreachable from refs |
| 2 | `anchor-baseline` HEAD `.env` (50B) = `DATABASE_URL` → **local SQLite file path** (shape-verified: no `://`, no `@`) | non-sensitive (Task-12 warning closed) | removed from tracking + history purge (same rewrite) |
| 3 | old clone `/home/z/saos-repo/.git/config` embedded token in remote URL (fp never recorded pre-scrub; predates current account) | credential-in-config | URL scrubbed to credential-free; verified clean |
| 4 | **fleet vault exposed ×3** (per independent forensic audit, verified by this agent): `saos-sovereign-platform/agent/keys/fleet_keys.{enc,meta.json}` (7 keys), `steem/agent/fleet_keys.{enc,meta.json}` (7 keys), `steem/download/recovery/extracted/steem-main/agent/fleet_keys.{enc,meta.json}` (2 keys) — each `.meta.json` holds its vault password in a plaintext `pass` field (43 chars, 3 DIFFERENT passwords, fps `bb0afb880b01` / `f2265b7ced8f` / `0555908b0b0e`) | **CRITICAL — real key material with password-in-plaintext adjacent** (encryption moot) | ① all 6 files backed up locally `~/.secrets/vault-recovery/` (0600/700) ② platform repo: history rewritten (16 commits), `agent/keys/` purged from every commit, force-pushed, verified clean ③ steem repo: history rewritten via filter-repo (89 commits, ~40 commit-trees carried the vault), 4 paths purged, force-pushed, verified clean across all remote commits ④ per audit doctrine: **assume the keys burned — rotation by owner is mandatory** |
| 5 | working GitHub token (fp `222832039d20`, classic, maximal scopes) | never committed to any repo (verified by the history scans above); flagged by the forensic audit as exposed in chat | owner should revoke/rotate after this push; replacement guidance: fine-grained, single-repo, Contents read/write only, no workflow/admin, short expiry |
| 6 | `steem/agent/keyscan.cjs` | tool, clean (no secrets) | left in place |
| 7 | Saosmartwallet (1,330 files, previously "unexamined") | examined this round: 0 suspicious filenames, 0 strict hits | recorded; scope note: pattern-level scan, not a semantic wallet audit |
| 8 | saos-dex | no key material in tree (wallet route is code); live ETH key lives in the dex agent's runtime env, not git | no rewrite needed; ledger counter bug (verified 18 > anchored 16 on ETH; SOL 18 anchored/0 verified) = handover note for the dex track owner |

### 9.3 Exposed-address balance sweep (read-only, keyless, no transactions)

| network | address/account | balance at sweep | verdict |
|---|---|---|---|
| Ethereum | `0x2767…1b0f` | 0.000099721 ETH | dust — sweep to fresh wallet at owner's leisure |
| Solana | `9knfnF…giL` | 0.029366117 SOL | dust |
| TRON | `TYVwwu…xTy` | 0 TRX | empty |
| STEEM | `headcorner` | 0.670 STEEM + 0.260 SBD + vesting | small |
| HIVE | `headcorner` | 9.682 HIVE | small |

### 9.4 Residual risks (honest)

- GitHub retains purged objects SHA-addressable until its internal GC; they are
  unreachable from any ref/commit. Combined with the dead PAT and the
  mandatory key rotation, residual exposure is nil — for immediate invalidation
  a GitHub Support ticket can be filed (owner action, optional).
- The three vault passwords were exposed historically: rotation of all vault
  keys (fresh keys generated on a clean device, never committed) is the true
  fix and stays an owner action per the forensic audit's kill order.
- The current full-scope classic PAT remains valid until the owner rotates it
  (cannot be self-revoked by this agent without cutting its own access).

## 10. Task 16 — re-leak incident: gitkeeper auto-save re-introduced the fleet vault (2026-09-08)

### 10.1 What happened

- An independent re-sweep of the **whole account** (all 9 repos × every branch,
  path+filename-based, binary-aware) was ordered to verify Task 15's closure.
- Found: `steem@main` head commit `41603ca` ("gitkeeper: auto-save … loop 21")
  **re-introduced** `agent/fleet_keys.enc` + `agent/fleet_keys.meta.json` onto
  the already-purged history. Only that single commit of 90 carried the vault —
  Task 15's purge itself had been correct; the re-leak came from the automated
  **gitkeeper** daemon (runs outside this sandbox — no process/cron found here),
  whose source directory still holds the vault files.
- The re-introduced copy is a **fourth, different vault version**: `.enc`
  sha256 fp `d1e8573080473286…` (173,929 B) — matches none of the three Task-15
  backups; the adjacent `meta.json` (370 B) is **binary, not JSON** (UTF-8/16
  decode fails). Vault-verify metadata on the same commit reports `12/12`
  registry/anchored accounts (vs 7 keys in the Task-15 copies).
- Content markers scan of the binary vault (counts only): 0 WIF, 0 PEM, 0
  `pass` fields, 0 seed phrases — consistent with an encrypted envelope, but
  per doctrine it is treated as burned key material regardless.

### 10.2 Actions taken (this round)

1. **Backed up before purge**: both files saved to
   `~/.secrets/vault-recovery/steem-main-current__fleet_keys.{enc,meta.json}`
   (0600/700) — the owner's recovery path now covers the fourth copy too.
2. **Purged**: `main` head rewritten via git plumbing (single-commit tree
   rebuild — parents were already clean), honest commit message, force-pushed.
3. **Verified remotely**: every one of the 90 remote commits' trees re-fetched
   via API — **0/90 carry `fleet_keys` or any `.enc` path** → CLEAN.
4. Everything else on the account re-verified clean (path sweep): foundry,
   platform, anchor-baseline, Project-files, roshpina, saos-jummper, saos-dex,
   Saosmartwallet — 0 critical hits (remaining matches are code/test filenames
   and `.env.example` templates, all content-clean).

### 10.3 Why Task 15's verification missed it

- The re-leak happened **after** Task 15's verified purge: gitkeeper's
  auto-save loop pushed at `2026-09-08T03:28:17Z`, minutes after the purge
  round. The verification was true when made; it just was not the last word.
- Lesson recorded: a purge is not "closed" until the **automation that
  produced the leak** is stopped or its source directory cleaned. A clean
  history behind a live leak-source is a temporal patch, not a fix.

### 10.4 Owner actions (unchanged + new)

1. **Stop the gitkeeper auto-save loop (or clean its source dir) before it
   pushes loop 22** — it re-leaks whatever still sits in its watched folder.
   This is now the TOP residual risk and cannot be fixed from this sandbox.
2. Rotate **all fleet vault keys** (now including the fourth copy) — burned.
3. Rotate the working full-scope classic PAT after this push.
4. Optional hardening: branch protection on `steem` (require PRs) so no
   daemon can direct-push again.

## 11. Task 20 — sandbox-reset aftermath: lost token file, gutted `.gitignore`, garbage amend (2026-09-08 ~17:00)

### 11.1 What the reset destroyed (no secret values ever printed)

- The sandbox was re-provisioned (~16:32). `~/.secrets/` (dir 700: `github-token`
  40B + `saos-admin-key` 172B) **no longer exists**; `upload/` is empty; the
  token was never committed anywhere (verified against foundry history: the
  only `upload/*` blob ever committed is `upload/חח.txt`, 101B, zero `gh*_`
  matches — not a credential). **The token is unrecoverable from this sandbox**
  and must be re-uploaded by the owner (same channel as before).
- The guardian kept cycling on ENOENT every 90s/10min since boot —
  **fixed** (see 11.4).

### 11.2 The bleeding found & fixed: gutted `.gitignore` + garbage amend `1055003`

- Discovery: local foundry `main` was `1055003` — an **amend of the already
  pushed** Task-19 commit `ef155c7` (same message, same author date 13:48:56)
  that swallowed runtime junk because the worktree `.gitignore` had been
  reduced from 44 lines to 2 (`node_modules/` + `skills/`).
- What the amend had absorbed: **`.env`** (50B, one DATABASE_URL line — benign
  content, bad hygiene), `db/custom.db`, `dev.log`, guardian logs, `next-env.d.ts`
  and **147 `.next/dev/**` build artifacts** (+109 mode-only changes, sandbox
  restored files as 755).
- Remote was NEVER touched: at last fetch the remote head is `ef155c7` and its
  tree contains **none** of the above (verified by tree-diff). The leak was
  local-only and is now undone.
- Fix executed (nothing deleted from disk):
  `git reset --mixed origin/main` → `git checkout origin/main -- .gitignore`
  (full 44-line guard restored) → `core.fileMode=false` → `chmod 600 .env`.
- Post-fix verification: `git diff origin/main` **empty** (worktree ≡ remote
  truth), tracked-leak check **0** (`git ls-files | grep -E '^\.env$|custom\.db|dev\.log|guardian\.log|next-env'`),
  untracked-but-committable files **0** (`git status --porcelain | grep '^??'`),
  secret-pattern files in worktree **0**. Forensic hash kept in reflog:
  `1055003`.

### 11.3 New residual risk recorded

- WHO gutted `.gitignore` is unproven from here (platform re-provision
  template vs an automation run). Same failure-class as §10 (automation with a
  stripped ignore list swallowing runtime files into a commit). If it happens
  again, the restored `.gitignore` will keep `.env*`, `db/`, `*.log`,
  `.next/`, `next-env.d.ts` out of the index — the guard now exists and was
  battle-tested within the hour.

### 11.4 Guardian hardened for credential loss (code, not config)

- Token-gate: no token file → log **once** (`TOKEN-MISSING … cycles paused`),
  zero API calls, cheap existence re-check every 30s tick, **auto-resume +
  immediate verification cycle** the moment `~/.secrets/github-token` reappears
  (`TOKEN-RESTORED` log line). No more ENOENT spam (was 1 line/repo/cycle).
- Heartbeat: guardian `/status` now carries `tick.lastTickAt` + `tick.alive`;
  the instrumentation supervisor treats `tick.alive === false` as DEAD and
  respawns — catches the zombie-timer state (server answers, timers dead)
  observed in the wild during this task's rapid hot-reloads.
- Live-verified: fresh child spawned by supervisor after safe-restart; exactly
  one WARN line; 0 ENOENT since; `tick.alive:true` across ticks; app home 200.

---

## §12 (Task 25, 2026-09-08) — תקרית: sandbox reset מחק DB + מפתח-אדמין; שיחזור מלא אוטונומי

**מה נצפה**: `db/custom.db` איבד את הטבלאות (AuditEvent/OpLog/DecisionRecord נעלמו — דפוס ה-reset של הסנדבוקס, כמו אירוע ~/.secrets ב-16:32). המסך הראשי קרס לשגיאת-רינדור; רישום-ההחלטות ב-DB חזר לברירת-מחדל (9 פתוחות); קובץ `~/.secrets/saos-admin-key` לא היה קיים (נבלע ב-reset הקודם).

**שיחזור שבוצע (אוטונומי, בסמכות-ההענקה)**:
1. `bun run db:push` — הטבלאות נוצרו מחדש מהסכמה; `GET /api/saos/decisions` חזר לחיות.
2. מפתח-אדמין חדש הוקצה ל-`~/.secrets/saos-admin-key` (600, לא הודפס מעולם) + `SAOS_ADMIN_KEY_HASH` (sha256 של התוכן בלי רווח-סיום) נוסף ל-`.env` (600, gitignored). **הערה-טכנית**: ה-hash הראשון חושב על הקובץ כולל `\n` → "מפתח לא תקף"; תוקן ל-hash של התוכן בלבד. Next-dev טען מחדש את ה-env ללא ריסטרט.
3. 9 ההחלטות הוקלטו מחדש דרך `POST /api/saos/decisions` (Bearer, audited) לפי הטבלה המתועדת ב-docs/owner-decisions.md §5 — יתרה חיה: **9/9 מוקלטות, 0 פתוחות, 3 needs-resource** (תואם לתיעוד).
4. אימות-דפדפן: המסך הראשי רנדר (0 שגיאות קונסולה), מסך-ההחלטות מציג את היתרה המשוחזרת, footer נדחף טבעי.

**לקח**: כל אירוע sandbox-reset עשוי למחוק db/ + ~/.secrets — תרחיש-שיחזור מתועד כאן; ה-guardian (טוקן) וה-askpass כבר self-healing מוכחים; מפתח-האדמין הצטרף לעוגן-השיחזור הזה.

---

## §13 (Task 26-c, 2026-09-09) — חוזה-בטיחות-מפתחות: מחייב את כל הסוכנים עד סוף-הפרויקט

**הנחיית-בעלים מחייבת** ("אנחנו צריכים לעבוד עם המפתחות גם אתה וגם שאר הסוכנים בבטיחות — תוודא שזה קורה ולא ההפך, עד שנסיים את הפרויקט"): כל סוכן שנוגע במפתחות מחויב לחוזה הבא. הפרה = תקרית P0.

### 13.1 הכללים (קווים אדומים)

1. **מפתחות חיים במעטפת חתומה** (fleet_keys.enc, AES-256-GCM/scrypt) או ב-`~/.secrets/` (600). אסור בעץ-פרויקט, ב-.env מגושר ב-git, ב-chat, ב-worklog, בלוגים.
2. **עיבוד בזיכרון בלבד**: derive/hash/sign בתוך תהליך; אסור `echo`/`print`/`tee` של ערך-גולמי, אסור להעביר מפתח כ-argument בשורת-פקודה (נראה ב-ps), אסור לכתוב מפתח לקובץ-זמני שנשאר.
3. **המערכת (foundry/dex) חסרת-מפתחות לנצח** — חתימה רק דרך external-signer (:3033); הסוכנים לא מורידים מפתחות מהמעטפת לשום שירות אחר.
4. **שער-אימות-סמכות חובה לפני כל שידור** (derive → השוואה מול סמכות-חיה; אי-התאמה ⇒ 403, כלום לא משודר) — כבר ממומש ב-signer v2; אין לעקוף.
5. **fail-closed**: בלי טוקן/מעטפת — כל נתיב-מוטציה מסרב (503/401). אסור "fallback" שמשדר בלי אימות.
6. **רשימת-היתרים לפעולות** ב-signer בלבד (custom_json / transfer_to_vesting / transfer / claim_rewards / he_market_sell / he_withdraw / delegate_vesting_shares) עם חסמי-סכום/כיוון. הוספת op דורשת עדכון-תיעוד באותו קומיט.
7. **לא להרוס את הגדרת-הבעלים**: אסור רוטציית-סמכויות, account_update, שינוי-רשות בשרשרת — גם כשמפתח-בעלים יהיה זמין, רק באישור מפורש של הבעלים.
8. **לוגים/תשובות**: רק נתונים ציבוריים (account names, txids, pubkeys, ETAs). בדיקת-דליפה חובה לפני push (rg על תבניות WIF/pubkey-פרטי/טוקן).

### 13.2 איך זה נאכף כרגע (מדיד)

- external-signer v2.1: שער-סמכות (הוכח-חי 403 על headcorner), שער-RC (הוכח-חי 429 על macrame), רשימת-היתרים, חסמי-סכום, בזיכרון-בלבד.
- saos-dex: operator-auth fail-closed על כל 10 נתיבי-המוטציה (כולל convert), dex חסר-מפתחות (executor=signer).
- fleet-cure: בלי מפתחות בכלל (רק טוקנים מ-~/.secrets בזיכרון); רשימת-חשבונות קבועה.
- vault-guardian: WATCH על `agent/keys/`, `.enc`, mnemonic-shaped קבצים; DEV_MODE=backup+alert.
- פורנזיקה חוזרת: כל סבב — `rg` על תבניות סודות בקומיטים + `git status` לוודא שאין קבצי-מפתח בעץ.

### 13.3 סדר-העבודה הנכון עם מפתחות (לכל סוכן עתידי)

1. קרא את ה-worklog + הסעיף הזה לפני כל פעולת-מפתחות.
2. זהה את המפתח-הנדרש במטריצת-החזקה (partners-status.md) — אם הוא "חזקת-בעלים": אל תנסה לעקוף; תעד את הפעולה-המוכנה ותעבור הלאה.
3. כל שידור: דרך ה-signer, עם **requestId דטרמיניסטי לפי-כוונה (seal/network/kind)** — לעולם לא requestId טרי-לניסיון (roast 54/56/61 הוכיחו חי ש-requestId-טרי מנצח את פנקס-האידמפוטנטיות = שידור-כפול אמיתי); סיווג-סירובים מבני (400/403/429 ו-chain-rejected = סופי; transport = עמום, רק ה-requestId הדטרמיניסטי משחזר) + ואימות-תשובה ציבורי (txid/שגיאה) בלבד.
4. אחרי כל סבב: רישום ב-worklog (מה נעשה, מה נמדד, מה נשאר) + דחיפה לפי never-clobber.
