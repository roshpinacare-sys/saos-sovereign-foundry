# TODO — T-17 done · signing-era live, coordination-era next
- [x] T-17: first FULLY-GREEN signing cycle (10/10 steps, engine-measured 15-66s) — root-caused the 90s-timeout lie (two real multi-vote cycles journaled "fail" while votes landed on-chain) → START-ACK + MARKER POLL sovereign flow, engine-side single-flight mutex + cycle-run.json marker, per-vote fast path (guards hoisted + sticky broadcast node: measured ~60-120s/vote → ~4s/vote), incremental per-vote state writes (crash-safe dedup), SECOND-SIGNER collision law (already-voted = dedup event, not failure), ackAt ordering bug caught+fixed pre-harm — selftest 143→167/167
- [x] REVIVAL (operator): credential adopted via cockpit paste channel (16:49Z) — banner flipped to מפתח-מוחזק-מנוע, all signing rails live
- [ ] T-18a: SECOND-SIGNER COORDINATION — an external agent-signer ("saos.weave.core.v1" checkpoints in account history) holds the same credential and votes (2% weight, 15-min cadence) + places orders + checkpoints on the SAME account; build the weave-protocol coordination layer (custom_json handshake, order-book arbitration, vote-dedup via chain truth before broadcast)
- [ ] T-18b: candidate-scan latency (fetchCandidates still crawls slow RPC nodes ~12s+/page — same sticky-node treatment as broadcast)
- [ ] T-18c: curation PAYOUT measurement (T-16a clock started 2026-09-30: first 14 doctrine votes; first payouts land ~7d later — verify the curation-share estimator against reality)
- [ ] T-18d: SBD parity source hardening (coingecko HBD proxy vs internal-feed lowConfidence — observe already prefers coingecko, needs failover law)
- [ ] T-18e: VP equilibrium check at 18/day cap (expect VP converge ~77-80%, floor 60% untouched — first real data 2026-09-30: 83.1% after 13 doctrine votes + day-cap reached)
- [ ] T-18f: X-2 capital-scale math card on dashboard
- [ ] ORG-REPO push (14 unhardened repos + PRs) still operator-gated on the GitHub PAT (filebin empty; on-box PAT swept clean)
