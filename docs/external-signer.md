# External Signer (חותם חיצוני ללא-מפתחות) — Task 5 + Task 6

> The golden architecture: **the system produces everything needed to sign
> EXCEPT the key.** It never holds, stores, prints or transmits private keys,
> seeds, signing secrets or wallet permissions — there is no column, no field,
> no env var and no log line where such material could even exist.

## 1. Signer registry (honest states)

| kind | status | detail |
|---|---|---|
| `manual` | **ready** | the system prepares payload+digest; a human signs in an external tool and returns the public txid |
| `external` | disconnected | interface defined (JSON over HTTPS, future) — nothing attached |
| `hardware` | disconnected | interface defined (device approval, future) — nothing attached |
| `none` | disconnected | default — sign-request creation for this kind is refused |

`signerReady` (preflight) = manual available for preparation.
`externalSignerConnected` (preflight) = **false** until an external/hardware signer is really attached.

## 2. SignRequest — what the system emits

```json
{
  "id": "sig-<uuid>",
  "network": "STEEM | BLURT | HIVE | TRON",
  "kind": "weave | checkpoint",
  "payload": "{...canonical JSON, public by construction}",
  "payloadHash": "sha256(payload)",
  "digestToSign": "the exact hash to sign out-of-band",
  "metadata": { "sealHeight", "sealRoot", "stateRoot", "createdAt", "expiresAt", "instructions" }
}
```

No key material in any field — structurally impossible (schema has no such column).

## 3. Lifecycle (Task 6 mission 3)

```
pending ──(manual)──▶ awaiting-approval ──(public result)──▶ signed-externally
   │                        │                                    │
   │ (expiresAt)            │ (expiresAt)                        ├─(verify:true ∧ verified)─▶ recorded
   ▼                        ▼                                    └─(verify:true ∧ ¬verified)─▶ stays
 expired                  expired                                 signed-externally (honest unverified)

awaiting-approval ──(action:cancel)──▶ cancelled
awaiting-approval ──(action:fail)───▶ failed
```

- Terminal states: `recorded | failed | expired | cancelled` — no further mutation.
- Expiry is **lazy**: a pending/awaiting-approval row past `expiresAt` reads as
  `expired` (computed by `effectiveStatus()`; the stored status is rewritten
  only by explicit PATCH or the retention script).
- Immutability: once a txid is recorded it can never be overwritten or cancelled
  ("רישום הוא בלתי-הפיך" — like the chain itself).
- Cancel/fail only before any public result exists; reason is public text.

## 4. API surface (`/api/saos/signer`)

| Method | Auth | Body | Result |
|---|---|---|---|
| GET | public | — | registry + last 20 requests with lifecycle status + per-status counts |
| POST | **required** | `{network, signer?, kind?, height?/sealId?}` | SignRequest (manual→`awaiting-approval`, else `pending`); duplicate open request ⇒ idempotent |
| PATCH | **required** | `{id, txid, proofRef?, anchorRef?, verify?}` | record public result → `signed-externally`; with `verify:true` → `recorded` (verified) or stays `signed-externally` (honest unverified) |
| PATCH | **required** | `{id, action:"cancel", reason?}` | `cancelled` (only pre-result) |
| PATCH | **required** | `{id, action:"fail", reason}` | `failed` (only pre-result) |

All sensitive operations: auth + rate-limit + AuditEvent (`signer-create`,
`signer-result`, `signer-cancel`, `signer-fail`, `sensitive-denied`).

## 5. Public-only result fields (Task 6 mission 4)

Accepted back from the human — **public data only**:

| field | meaning |
|---|---|
| `txid` | public on-chain transaction id (8..128 chars, `[\w.-]`) |
| `proofRef` | raw public proof reference (explorer URL / block ref) |
| `anchorRef` | public anchor reference (permlink / block height / op ref) |

Refused always: anything resembling key material has no field to land in;
`verified` / `verificationSource` / `verifiedAt` are computed by the system,
never client-asserted.

## 6. Public txid verification (read-only)

`verifyTxidPublic(network, txid)` — opt-in (`verify:true`), 5s timeout,
**read-only probes of public endpoints** (never a broadcast, never a transaction):

| network | endpoint |
|---|---|
| STEEM | `https://api.steemit.com` (condenser_api.get_transaction) |
| HIVE | `https://api.hive.blog` |
| BLURT | `https://rpc.blurt.world` |
| TRON | `https://api.trongrid.io/wallet/gettransactionbyid` |

Outcome honesty:
- reachable ∧ txid known ⇒ `verified:true`, source = endpoint, status → `recorded`
- anything else (unreachable / unknown / timeout) ⇒ `verified:false` + the exact
  reason in `verificationSource`, status stays `signed-externally` — and the UI,
  the API and this doc all agree: **unverified is NOT a final anchor**.
- Sandbox reality (measured): outbound RPC blocked ⇒ honest unverified with the
  timeout reason. If a deployment has open egress, real verified anchors become
  possible through the exact same code path.

## 7. Keystore-recovery warning (the standing rule)

The correct route for any future vault recovery is the one this module enforces:

1. The system emits the transaction content + digest to sign.
2. The human signs on THEIR system (offline tool, hardware wallet, external service).
3. The system receives ONLY the public result (txid / proof).

Never: importing keys into the agent, the repo, working files, logs or any
uncontrolled networked server. Any request that would require the system to
hold a key is refused by design and recorded as "דורש אישור חיצוני".
