# h17 — FULL-MATRIX REPEAT (6/6): the engine is operational, not a one-off

**Task 82 · 2026-09-11 · trace 1a08f05aff2cd2d1** ("תמשיך ודחוף") — standing on the owner's
explicit inventory approval ("אין בעיה אני מאשר להשתמש ולהתייעל ככל הניתן עם מה שיש במלאי").

h16 proved the first 6/6 matrix. **h17 proves it REPEATS**: two consecutive seals anchored
on all six networks, all verified against public RPCs by the platform itself (truth contract:
a txid enters the ledger only after server-side re-verification — nothing trusted from the
broadcaster).

Seal h17: batchId `task82-fleet-anchor-2026-09-11` · root
`b9746afcf690f0964605098a4175d03341eecbcb058cb72705a3f6ce66a3618e` · 12 leaves ·
stateRoot `7f44fa10b22e9cf07d58f3f4e29f9dfeb6cf3e7a46c468c802faae5250582b84`.

---

## §1 — The six h17 anchors (ledger truth)

| Network | txid | On-chain position | Account | Verification |
|---|---|---|---|---|
| STEEM | `a4782b39b55102e41eeaf79d138d1d1df984c3552325b3ea0f09406b74caea7f` | block 109,478,392 | headcorner | pulse-verified (custom_json saos.weave.v1) |
| BLURT | `49abca9619058830b0fafbd5edec797a4714fca045048a4c85826f1e864f5bc9` | block 63,541,138 | headcorner | pulse-verified |
| SOLANA | `3RXaKCD937GRA9vWA5e1vUmHXp5wBymWsZsNd8Wg2Q4rVXbD6N98uSQnoE2GyPP8GgBSxBhuwMTxBfr1n1LePjgp` | slot 446,083,569, **finalized** | cashmachine | memo decoded independently from `getTransaction` — contains the exact canonical JSON with height 17 + root |
| ETHEREUM | `0x35a4355c08195ac4cbc6cec46aaf8540abaa847a752f178d78258f0e6fe3d8fe` | block 25,952,255 | cashmachine self-tx | status=1, calldata = root‖height (0x…618e + `00000011`) |
| ETHEREUM (×2 redundant) | `0xc0f6d2fd62aa9e637fc5cac09620b60e8bea760d410f15759439ba3575973354` | block 25,952,262 | cashmachine | status=1 |
| ETHEREUM (×3 redundant) | `0xbf543b8b21898a257f3c00c661fdb25297310b16f416ca1918f7be7aa12aa57a` | block 25,952,265 | cashmachine | status=1 |
| TRON | `a7aedd6f89277c84dadd5ceb4099059714d5b0ce33f266af4e198089c9523e64` | block 86,144,962 | headcorner | SUCCESS, amount **47476 sun = 0xb974 = root[0:4]** → blackhole-null `41‖00…00` |
| TRON (redundant — see §5) | `4c61fd63f9eceddf48054bc2c9f71f5ce8374fb91d3b5b6b8752144cc9fa1b06` | block 86,144,985 | headcorner | SUCCESS, same 47476 encoding |
| HIVE | `432e8abde04e66829a157eaf44f0f235a6b66eef36834164992d334e6e9c7579` | block 109,813,318 | **wic** (first-ever HIVE anchor from wic) | pulse-verified, active authority matched live |

Ingest verification (server-side, independent RPCs):
- SOLANA → verifiedBy `api.mainnet-beta.solana.com`
- ETHEREUM → verifiedBy `ethereum-rpc.publicnode.com`
- TRON → verifiedBy `api.trongrid.io/wallet/gettransactionbyid`

---

## §2 — Inventory truth discovered live (fuel map changed)

**The h16 ETH fleet is drained.** Measured live via `eth_getBalance` (publicnode):
`israelnews/lsa` nonce=3, `macrame/siq/tov/wic/wog/woq` nonce=2 — **all 8 at exactly 0 ETH**.
h16 was their final anchor; the "0.0002-funded fresh addresses" era is over.
**cashmachine is now the only funded ETH wallet** (nonce 58, was 0.00011818 ETH).

h17 ETH strategy adapted (owner's efficiency directive): 3 sequential self-tx anchors from
cashmachine (not 8 addresses) — same root‖height calldata, blocks 25,952,255/262/265,
gasUsed 22,350 each, **total cost ≈ 0.0000366 ETH at base fee 0.058 gwei** (maxFee
0.613 gwei). Balance after: **0.00008156 ETH** — enough for ~6 more anchors at current gas.

SOL after h17: cashmachine ≈ 0.05955 SOL (fee 5,000 lamports per memo anchor).
TRX after h17: headcorner **0.07791 TRX** (2 × 0.047476 burned) — still enough for any h18
anchor (max possible encoding 0.065535 TRX).

---

## §3 — Platform bug caught live and fixed: the fleet-account deadlock

**Symptom**: HIVE pulse with `account=ynet` (2051M effective RC, the richest account) was
definitively refused — `authority-mismatch: ynet envelope-active derives STM5ct91t63… but
HIVE active authority is STM4tXiBSDN… (fail-closed, nothing broadcast)`. A retry with
`account=wic` (174.5M effective RC) returned **409 account-conflict** — and stayed 409 even
with `confirmFresh:true`.

**Root cause** (code order-of-checks): in `anchor-pulse/route.ts` the account-conflict 409 ran
**before** the confirmFresh branch. Once the FIRST attempted fleet account ended in a
definitive refusal, the (seal,network) write-ahead intent was trapped on that account
**forever** — one bad account deadlocks the whole network's anchor for the seal. A latent
live-fleet deadlock, caught on its first exposure.

**Fix** (Task 82, tsc+lint clean):
1. `existing.txid` checked FIRST (already anchored → return recorded anchor, never re-broadcast);
2. human-confirmed supersede (`confirmFresh:true`) now runs before the conflict 409 — allowed
   ONLY while the old intent has no txid (provably nothing in flight), marks the old row
   `failed` + `superseded:true` (full audit trail in meta), and mints a FRESH requestId so the
   signer's idempotency ledger cannot replay the original account's verdict;
3. the anti-hijack 409 default stays intact without confirmFresh.

Then HIVE anchored immediately from wic — first try after the fix.

**Bonus discovery**: ynet's on-chain HIVE active authority (`STM4tXiBSDN…`) does not match the
envelope-derived key (`STM5ct91t63…`). ynet is the first fleet account proven NOT signer-usable
on HIVE (its 2.05G RC is unreachable through our envelope). Recorded for the fleet authority map.

---

## §4 — Operational knowledge: effective RC ≠ stored RC (regen model)

`find_rc_accounts` returns the STORED mana (updates only on account activity). Real budget =
`min(max_rc, stored + max_rc/432000 × elapsed_seconds)` (full regen ≈ 5 days). Measured at h17:

| account | stored | **effective** | vs 108M compact cost |
|---|---|---|---|
| ynet | 1722.2M | 2051.8M | 19.0× (but authority-mismatch) |
| wic | 1.7M | **174.5M** | 1.62× → anchored h17 |
| woq | 23.7M | 162.9M | 1.51× |
| siq | 10.8M | 150.8M | 1.40× |
| israelnews | 1.6M | 96.2M | 0.89× |
| lsa | 46.2M | 94.5M | 0.87× (h16 launcher, drained) |

Lesson: accounts that LOOK dry (wic stored 1.7M!) are anchor-ready. The fleet's HIVE capacity
is ~4-5 anchor-ready accounts per cycle when the regen model is applied. No more waiting on lsa.

---

## §5 — Honest incident log

1. **TRON double anchor**: the h17 broadcast landed SUCCESS at block 86,144,962 but the script's
   20-poll window (≈100s) expired before its own confirmation logic saw it; a re-run built and
   broadcast a SECOND identical anchor (block 86,144,985). Both landed; both are valid h17
   commitments; the extra cost is 0.047476 TRX burned to the canonical null-address (no third
   party profited). Process lesson now codified: **always re-query the chain's account-tx list
   before any re-broadcast** — the tx WAS confirmed, the polling window was just too short.
2. **SOL ambiguity resolved the right way**: the engine's own poll reported `confirmed=false`
   (rate-limited status polling), but the tx had been accepted (signature returned). Independent
   verification via a second RPC proved `finalized` + exact memo. The write-ahead/verify-
   independently discipline caught what the in-process poll missed — exactly the pattern that
   Task 80's lean script encoded.
3. **task79 engine ETH path** still carries the pre-task-80 fee bug (`priorityFee > maxFee`
   rejection) — all 8 attempts were refused LOCALLY before signing (zero loss, zero broadcast).
   h17 used the fixed script (baseFee×2+tip from the live block). The stale engine file stays
   out of the repo; its lesson is already in the task-80 evidence.

---

## §6 — Cost ledger for h17 (owner efficiency directive)

| item | cost | note |
|---|---|---|
| SOL memo anchor | 0.000005 SOL | fee 5,000 lamports |
| ETH 3× self-tx | ≈0.0000366 ETH | 22,350 gas × ~0.55 gwei effective each |
| TRON 2× (1 intended + 1 incident) | 0.094952 TRX | blackhole-null, zero bandwidth burn |
| STEEM custom_json | 0 (RC only) | headcorner STEEM RC was 89% |
| BLURT custom_json | 0 BLURT (RC fee-plane) | balance untouched: 30.935 BLURT |
| HIVE custom_json | 0 (RC only) | wic compact payload |

No WATTOIN interaction (headcorner EVM nonce unchanged policy — no approvals, no transfers,
no swaps). No secrets in logs/git/chat. No force-push anywhere.
