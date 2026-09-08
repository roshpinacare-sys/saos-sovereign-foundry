# Deep Agent Audit — Task 21 · 2026-09-08T17:58:10.172Z

token account: `roshpinacare-sys` · repos audited: 11 (all private, blobless clones)
discipline: paths / line-numbers / pattern-TYPES only — **no secret value was ever printed, stored, or pushed**. Auth-header redaction choke point added to `record()`/`sh()` after a clone-error message briefly embedded the base64 header in local logs this run (sanitized in place; remote never received it).

totals: 44260 raw pattern hits → 44211 are hash-shaped hex64 (benign class, see below) · 49 structural findings.

## Verdict per repo

| repo | HEAD secret-path hits | deep history | content findings | verdict |
|---|---|---|---|---|
| saos-sovereign-foundry | `.env.example` | `.env` exists in old history (Task-19 documented benign) | 2 hex64 hits in 1 file(s) (forensic-doc hash; 1 self-match in audit script's own PEM pattern) | CLEAN — template verified placeholder-only |
| steem | `agent/fleet_keys.enc`, `agent/fleet_keys.meta.json` + 2 deep `*.env.example` research templates | **CRITICAL — 4 path(s) in parents; purge = owner decision** | 15 PEM-class blocks — all inside tests/signature-evidence fixtures; 1 `sk-` in a test file; 44067 hex64 hits in 1588 file(s) across 1,588 agent evidence files (hash-shaped) | **OWNER DECISIONS** (below) |
| Saosmartwallet | `src/app/api/developer/keys/route.ts`, `src/app/api/vault/keys/route.ts` (API route files — benign "keys/" path class) | same 2 paths in parents | 4 hex64 hits in 2 file(s) (docs/status files) | CLEAN — **keys.ts answer: `packages/core/src/vault/keys.ts` → encryption-layer present; NO localStorage/sessionStorage/file-write/CSPRNG facts in file** |
| saos-dex | `.env.example` | same in parents | 80 hex64 hits in 7 file(s) (MANIFEST.sha256, audit docs — checksums) | CLEAN |
| saos-sovereign-platform | **`scripts/anchor-sovereign-mnemonic.ts` — mnemonic-named script, NOT opened per discipline** | **CRITICAL — same in parents** | 3 hex64 hits in 2 file(s) | **ATTENTION — owner must inspect/relocate** |
| saos-jummper | `.env.example` | same in parents | 53 hex64 hits in 5 file(s) (golden_vectors test fixtures) | CLEAN |
| roshpina | — | — | 2 hex64 hits in 1 file(s) (forensic doc) | CLEAN |
| anchor-baseline | — | — | 0 | CLEAN |
| Project-files | — | — | 0 code files scanned (64MB non-code) | CLEAN |
| Sdk | clone failed — **repo empty** (created 13:07:55Z, 0KB, no commits) | — | — | UNINITIALIZED |
| Adsmarket | head clean | — | 0 hits recorded | CLEAN |

## Trading-daemon broadcast map (steem)

`he_sell.cjs`, `he_unstake.cjs`, `mint_borrow.cjs`, `rebalance102.cjs`, `yield.cjs` (two copies each under agent trees) — **0 broadcast-class calls in ALL of them** (no `.broadcast(`/`.comment(`/`.transfer(`/`transferToVesting(`/`delegateVestingShares(`/`customJson(`/`claimRewardBalance(`). The daemons are planners/logic — they do not move funds directly.

## Owner decision list (CRITICAL)

1. **steem `agent/fleet_keys.enc` (+meta)**: present in HEAD **and** parent history. Guardian + this audit both withheld auto-fix (deep-history rule). Backup at `~/.secrets/vault-recovery/guardian-*`. Options: (a) manual `git filter-repo` purge + force-push, (b) accept & archive. Owner call.
2. **saos-sovereign-platform `scripts/anchor-sovereign-mnemonic.ts`**: mnemonic-named file in HEAD+history. Never opened per discipline. Recommend owner inspection; if a real seed phrase is inside → relocate to `~/.secrets` + history purge.
3. **steem PEM/signature fixtures (15) + `sk-` test hit**: consistent with test/evidence fixtures, not live keys — owner may confirm.
4. **Token hygiene**: base64 auth header briefly appeared in local error output this run; sanitized everywhere, never pushed. Token rotation at owner discretion (standing rule: owner handles keys).

## Method
11 repos × {full-history path-pattern scan (git log --all --name-only), HEAD content scan (code ≤512KB, lockfiles skipped, secret-path files never opened), daemon broadcast map, wallet keys.ts storage-facts} — value-redacted end-to-end.

---

## CORRECTION (Task 22, 2026-09-08) — the "0 broadcast" line above is WRONG

The daemon-logic map in this report (Task 21 run) under-counted: its regex missed
real broadcast call-sites. Verified at HEAD: he_sell.cjs:134, he_unstake.cjs:103,
mint_borrow.cjs:118/126/143, yield.cjs:150 all contain broadcast-capable paths, and
runtime state shows he_unstake ran `dry:false` (09-03) and mint_borrow `mode:live`
(09-04). Only rebalance102 is planner-only. Additionally: he_sell/he_unstake default
to LIVE (`DRY = argv.includes('--dry')`, he_sell.cjs:29) — bare execution broadcasts.
Fix belongs to the steem-owning agent (P0 in NETWORK-MASTER-SUMMARY.md §7.1).
The pattern-classification methodology (paths/types only) remains valid; the
broadcast-map counting is what failed. Kept here unedited for the record.
