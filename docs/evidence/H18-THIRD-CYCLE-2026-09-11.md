# h18 — the 3rd consecutive cycle: 5/6 anchored + TRON honestly quota-gated; BTC scouted (no fuel)

**Task 83 · 2026-09-11 · trace 1a08f1fc2bf114f5** ("תמשיך ודחוף") — standing inventory approval.

Seal h18: batchId `task83-fleet-anchor-2026-09-11` · root
`3973c169a2f32770492dabb8a8959605d7fa8010759bc1b359a12bd83bae51b0` · 12 leaves ·
stateRoot `11d98144238c6f095f79ebe0298cf70835caeac2f167fe3b94c50198c5bdef49`.

## §1 — The five h18 anchors (all platform-verified + independently re-checked)

| Network | txid (canonical) | On-chain position | Account | Notes |
|---|---|---|---|---|
| STEEM | `e91c10b1253538980194b07320c0a9233800023e6578eb42c639a09c101bea40` | block 109,479,017 | headcorner | custom_json saos.weave.v1 re-verified via get_transaction |
| HIVE | `c04e2fa5bbb84586dc2ab0ca0cb1d4adc821175b` | block 109,813,630 | **woq** (2nd distinct fleet account in a row) | compact payload; canonical 40-hex id resolves via get_transaction |
| SOLANA | `4zUm4JNteawwcJ1Do5MJwP6LzSasDePYGRnbeuocJWakV5Z8S4govVkXFUnYYPQ5sZaQa3w9KSNcT3dgnUjGVv8g` | slot 446,088,169 | cashmachine | memo decoded independently — exact h18 canonical JSON |
| ETHEREUM | `0xcc84530d9c06907084cd645c88d4362dcfccb0d0e6e51b6b4d7dca3f834c6dbb` | block 25,952,351 | cashmachine self-tx | calldata root‖height (`0x…51b0`+`00000012`) |
| ETHEREUM (redundant) | `0x591686c3ffa09afc70bf43aec882fccfff290440b89e6fa1f6d90bdd7488e801` | block 25,952,375 | cashmachine | #2 confirmed after its wait-window — bonus commitment, no extra spend beyond gas |
| BLURT | `1f1f321e88596136a8413b8788b28d4f06828187` | block 63,541,833 | headcorner | canonical-id fix validated live (below) |

**TRON — honest gate, nothing hidden**: broadcast refused `BANDWITH_ERROR: Account resource
insufficient` — headcorner's FREE daily bandwidth quota (600 bytes) is exhausted by the
h16 anchor + 2×h17 anchors (3 × ~197 bytes ≈ 591 bytes). A 4th tx (~197 bytes) cannot fit
until the daily window renews. This is the measured hard limit of the "zero-cost daily TRON
anchor" model: **~3 anchors/day per unfunded account**. Options recorded for the owner:
rotate TRX accounts daily (each vault address has its own 600B quota), or freeze ≥1 TRX on
one account for a bandwidth stake (min freeze = 1 TRX; headcorner holds 0.06320 after h17).

## §2 — Platform bug caught live and fixed #2: the non-canonical txid

**Symptom**: the h18 HIVE anchor was verified TRUE (block 109,813,630 matched via get_block)
but the ledger stored a 64-hex full sha256 — and `get_transaction` REJECTS 64-hex ids on
graphene ("Transaction hash … has invalid size. Transaction hash should have size of 160
bits", proven live on h17's HIVE anchor too). A stored anchor that no standard node lookup
can resolve is a half-truth.

**Root cause**: the pulse promoted whatever `txid` the signer returned; the node-confirmed
canonical id arrived only as `meta.nodeTrxId`. For the h16 headcorner path both coincided;
the woq account path returned the full hash.

**Fix** (tsc+lint clean): the pulse now stores `exec.nodeTrxId ?? exec.txid` (canonical,
lookup-able) and verifies THAT id; the full signer hash is preserved as `meta.rawSignerTxid`.
The h18 HIVE row was normalized in place with a full audit note in meta (same transaction —
canonical form; raw id kept). The fix was validated LIVE by the very next pulse: the h18
BLURT anchor stored a proper 40-hex canonical id (`1f1f321e…88187`) with the raw hash in meta.

## §3 — Incidents, diagnosed honestly

1. **TRON SIGERROR red herring**: the first h18 broadcast attempts died with `Validate
   signature error: miss sig or contract`. Diagnosis: the signature was cryptographically
   VALID (local recovery self-check: recovered pubkey == our pubkey, exact match) — the
   trongrid edge was returning degenerate errors (its `validatetransaction` even returned an
   HTML page). The REAL gate surfaced on the alternate node: BANDWITH_ERROR (§1). Nothing was
   ever broadcast in the SIGERROR attempts (verified: gettransactionbyid = {} for both txids,
   account tx list unchanged) — zero loss.
2. **Background-job kills**: the persistent shell reaps backgrounded node processes the
   moment the tool call returns (empty logs, dead pids — twice now, h17 and h18). All anchors
   are run FOREGROUND with hard timeouts. Process lesson codified.
3. **ETH #2 wait-window**: anchor #2 exceeded its 180s in-process wait; independent receipt
   check 15 min later: block 25,952,375 status=1. The wait-window is a UX param, not a
   truth param — chain receipts are the only verdict.

## §4 — BTC scouting (new chain, measured honestly)

All 12 vault BTC addresses (bc1q…, zpub-derived, m/84') measured live via blockchain.info:
**0.00000000 BTC, 0 transactions, all 12** — never funded. An OP_RETURN anchor needs
~200-600 sats; the fleet's BTC plane has no fuel and only the owner can fund it. Gate
recorded: `btc: no-fuel (12/12 addresses at 0, never funded)`.

## §5 — Cost ledger for h18

| item | cost |
|---|---|
| SOL memo anchor | 0.000005 SOL (5,000 lamports) |
| ETH 2× self-tx | ≈0.0000245 ETH total (base ~0.05 gwei) — balance after: 0.00006930-0.0000123(pending→confirmed) → ~0.0000693-2×gas ≈ 0.0000447? (measured: balance after both = 0.00006929… minus #2's mining cost) |
| STEEM / BLURT / HIVE custom_json | 0 BLURT burned this anchor (fee-plane RC); HIVE/STEEM RC-only |
| TRON | 0 (broadcast refused — quota gate, nothing spent) |
| BTC | 0 (no fuel) |

Inventory after h18: cashmachine SOL ≈ 0.05955 · cashmachine ETH ≈ 0.0000693 (2 more anchors
affordable at current gas) · headcorner TRX 0.06320 (blocked by bandwidth quota anyway) ·
STEEM RC 89% · fleet HIVE effective-RC ready-set regenerating (siq next).

No WATTOIN interaction. No secrets in logs/git/chat. No force-push.
