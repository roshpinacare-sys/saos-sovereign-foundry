# Secret Hygiene (היגיינת סודות) — Task 6, updated Task 11

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

## 6. Admin-key rotation procedure (Task 11 — owner-executed, never printed)

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
