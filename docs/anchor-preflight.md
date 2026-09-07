# Anchor Preflight (טיסה-מקדימה לעוגן) — Task 6

> `GET /api/saos/anchor-preflight` — the read-only flight check that answers
> ONE question honestly: **is the system ready for a real anchor right now**,
> without performing one, without broadcasting, without touching keys.
> A single blocker ⇒ NOT ready, and the output says exactly what is missing.

## 1. Contract

- **Method**: `GET` (read-only; no auth needed — no secret in the response; rate-limited 30/min)
- **Optional query**: `?network=STEEM|BLURT|HIVE|TRON` — scope the resource check
  to one network. Unknown value ⇒ `ok:false` (fail-closed, never silently "all").
- **Never**: anchors, broadcasts, transactions, state mutation, key access.

### Required output fields

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | request itself succeeded (readiness is `readyForAnchor`) |
| `readyForAnchor` | boolean | **the verdict** — false if ANY check fails |
| `mode` | string | current operation mode (dry-run/safe/live/maintenance) |
| `liveGateReady` | boolean | mirrors `readyForAnchor` (consistency with /live-gate) |
| `backupFresh` / `backupVerified` | boolean | fresh (<7d) verified backup exists |
| `authReady` | boolean | `SAOS_ADMIN_KEY_HASH` configured |
| `rateLimitReady` | boolean | limiter active on all /api/saos/* |
| `signerReady` | boolean | at least one signer available for preparation (manual = ready-to-prepare) |
| `externalSignerConnected` | boolean | external/hardware signer actually attached — **false** in this stage, honest |
| `pendingSignatureQueue` | object | counts: open / signedExternally / recorded / expired / cancelled / failed |
| `chainStatus` | object | receipt-chain ok, seal count, receipt count, disclosed forks |
| `networks[]` | array | per-network status, isReadyForAnchor, isDryRunOnly, lastChecked |
| `target` | string | requested scope ("all" or the network) |
| `blockers[]` / `warnings[]` | array | fail / warn checks with exact details |
| `checks[]` | array | the 10 checks with id/status/detail |
| `recommendedNextAction` | string | the single next step, derived from the first blocker |
| `generatedAt` | string | ISO timestamp |
| `note` | string | iron-rule reminder (read-only, no keys) |

## 2. The 10 checks

| # | id | fail when | warn when |
|---|---|---|---|
| 1 | `backup-fresh-verified` | no verified backup <7d (OpLog backup row) | — |
| 2 | `auth-ready` | `SAOS_ADMIN_KEY_HASH` missing | — |
| 3 | `rate-limit-ready` | (compiled-in module — always active) | — |
| 4 | `seal-present` | zero seals in the chain | — |
| 5 | `chain-intact` | receipt chain digest/link errors (forks disclosed, not hidden) | — |
| 6 | `network-status-clear` | target network has no explicit status | — |
| 7 | `network-resources` | HIVE RC < 8% / TRON energy = 0 | STEEM/BLURT state+permissions not live-verified (advisory stage) |
| 8 | `signature-request-open` | — | no open SignRequest (one can be created) |
| 9 | `security-open-items` | — | known open security items (4, honest constants) |
| 10 | `mode-allows-broadcast` | mode ≠ live | mode = live but no connected external signer |

## 3. Live measured result (2026-09-07, this round)

```json
{
  "ok": true,
  "readyForAnchor": false,
  "mode": "dry-run",
  "backupFresh": true,
  "authReady": true,
  "externalSignerConnected": false,
  "chainStatus": { "ok": true, "seals": 57, "receipts": 211, "forks": [17] },
  "blockers": [
    { "id": "network-resources", "detail": "HIVE RC 0.6% < 8% · TRON energy=0" },
    { "id": "mode-allows-broadcast", "detail": "dry-run — אין שידור אמיתי" }
  ],
  "recommendedNextAction": "השלם משאבי רשת (HIVE RC ≥ 8% / TRON stake) …"
}
```

Honest verdict: **NOT ready** — exactly two infrastructure blockers, both
resource-level, both documented with unblock plans in `status.networks[]`.

## 4. The first-anchor process (dry → real, owner executed)

> Iron rules: the agent NEVER performs the anchor, never broadcasts, never
> touches a key. The owner executes step 3 entirely outside the system.

**Step 1 — preflight (system, automatic)**
`GET /api/saos/anchor-preflight` → if `readyForAnchor=false`: STOP. Complete the
listed blockers (they say exactly what is missing). No bypass exists.

**Step 2 — create the SignRequest (system, owner-authenticated)**
`POST /api/saos/signer {network, signer:"manual"}` → the system produces the
canonical `payload`, `payloadHash`, `digestToSign` and per-network instructions,
status `awaiting-approval`. Displayed in the UI (tab שער-חיים).

**Step 3 — the owner signs OUTSIDE the system (the only manual step)**
The owner uses any external tool/wallet with their own key — the system never
sees the key, the seed, or the signature itself. Only afterwards does the owner
hold the public result: `txid` (and optionally an explorer URL as `proofRef`).

**Step 4 — record the public result (system, owner-authenticated)**
`PATCH /api/saos/signer {id, txid, proofRef?, anchorRef?, verify:true}` →
the system records the public result (`signed-externally`) and, when
`verify:true`, probes the PUBLIC network read-only:
- verified → status `recorded`, `verificationSource` = the public endpoint
- not verifiable → status stays `signed-externally`, `verified:false` + honest
  reason — **never presented as a final anchor**

**Step 5 — outcome discipline**
`recorded` = anchored (verified). Anything else (signed-externally/failed/
expired/cancelled) is NOT an anchor and is never displayed as one. The system's
anchoring matrix only reflects verified public results.

## 5. Dry-run rehearsal (available today, zero risk)

Steps 1–5 can be fully rehearsed in dry-run mode with a **fabricated-but-labeled**
txid: the flow, statuses, audit trail and UI all behave identically — the only
difference is the honest `unverified` verdict, because a fabricated txid can
never verify. This is exactly what api-check asserts (§testing.md).
