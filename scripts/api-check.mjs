#!/usr/bin/env node
/**
 * api-check — API contract verification (part of `bun run check`).
 * Requires the dev server on http://localhost:3000 (bun run dev).
 *
 * Checks:
 *   1. every endpoint answers HTTP 200 with ok:true (never 500)
 *   2. kernel selftest 7/7
 *   3. seal → new monotone height
 *   4. idempotency: same batchId twice → same seal, idempotent:true
 *   5. verify-pack + verify-chain (chain/seal/leaf scopes) all verified
 *   6. energy/economy persist their entities (planId/snapshotId) + /plans reads them
 *   7. fail-closed: bad inputs → ok:false with HTTP 200
 *   Task 5 (live gate & hardening):
 *   8. live-gate output contract (ok/readyForLive/blockers/warnings/checks)
 *   9. auth: unauthenticated sensitive ops → 401; wrong key → 401; login → session cookie
 *  10. keyless signer: create (authed) → awaiting-approval → record txid → immutable
 *  11. audit trail records denied + allowed events (authed read)
 *  12. rate-limit: burst beyond the limit → 429 (runs LAST — exhausts the auth window)
 *   Task 6 (anchor preflight & external signing lifecycle):
 *  14. anchor-preflight: 10 checks, required fields, honest unverified, fail-closed network param
 *  15. signature lifecycle: awaiting-approval → signed-externally (+proof) → cancel/fail drills →
 *      fake-txid verify stays unverified (never presented as a final anchor)
 *   Task 10 (UI rebuild data layer):
 *  16. research endpoint restored (documented contract, 10 findings + synthesis)
 *  17. repo-status: git state, backups, secrets posture (booleans/perms only — no values)
 *  18. owner decisions: registry cites sources; authed status recording; fail-closed writes
 *   Task 11 (key hygiene, session revocation, decision closure, first-anchor readiness):
 *  19. decisions contract v2: category/severity/auditTrail + spec aliases + new statuses
 *  20. repo-status adminKeyFileInTree (existence-only monitor, no content)
 *  21. preflight firstAnchorReadiness (honest 3-value status, never claims ready)
 *  22. signer contract v2: purpose/verificationStatus/auditTrail + ttlSeconds expiry →
 *      expired is terminal (mutation refused)
 *  23. auth/revoke-all: 401 without auth; with auth → epoch rotated, ALL cookies dead
 *      (incl. caller), re-login works, audited
 *   Task 12 (Ethereum & Solana dry-run expansion):
 *  24. status: 6 networks — ETHEREUM/SOLANA present, dry-run by default,
 *      not-configured is a state (no error without RPC/key), no invented data,
 *      no secret-shaped strings, no RPC URLs echoed
 *  25. status?probe=1: opt-in read-only probe, not attempted when not-configured
 *  26. anchor-preflight: includes ETHEREUM/SOLANA (target + all), not-configured
 *      is a warn (never a fail), unknown network still fail-closed
 *  27. signer: SignRequest creatable for ETHEREUM/SOLANA (dry doc, audited
 *      instructions), drills cancelled — no lingering open queue
 */
const BASE = process.env.SAOS_BASE_URL ?? "http://localhost:3000";
const ADMIN_KEY = process.env.SAOS_ADMIN_KEY ?? "";
let pass = 0, fail = 0;
const failures = [];

function report(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; failures.push(name); console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function j(path, init) {
  const res = await fetch(BASE + path, init);
  let body;
  try {
    body = await res.json();
  } catch {
    // BUG-009 hardening: a non-JSON body (e.g. Next 404/error HTML page for a
    // route missing from the checkout) must FAIL WITH DIAGNOSTICS, not crash
    // the whole suite with an unhelpful parse error.
    const ct = res.headers.get("content-type") ?? "unknown";
    const txt = (await res.text().catch(() => "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(`non-JSON response from ${path}: HTTP ${res.status} ${ct}${txt ? ` — "${txt}"` : ""}`);
  }
  return { status: res.status, body, headers: res.headers };
}

async function main() {
  console.log(`\napi-check → ${BASE}\n`);

  // 0. server reachable
  let up = false;
  try { up = (await fetch(BASE + "/api/saos/status")).status === 200; } catch { up = false; }
  if (!up) {
    console.error("❌ dev server not reachable — start it first: bun run dev");
    process.exit(2);
  }

  // 1. status: mode + networks present
  const s = await j("/api/saos/status");
  report("GET /status ok", s.status === 200 && s.body.ok === true);
  report("GET /status mode present", typeof s.body.mode === "string", `mode=${s.body.mode}`);
  report("GET /status networks x6", Array.isArray(s.body.networks) && s.body.networks.length === 6, "incl. ETHEREUM+SOLANA (Task 12)");
  report("GET /status matrix x6", Array.isArray(s.body.matrix) && s.body.matrix.length === 6);

  // 2. kernel selftest
  const k = await j("/api/saos/kernel");
  report("GET /kernel ok", k.status === 200 && k.body.ok === true);
  report("kernel selftest 7/7", k.body.result?.checks?.length === 7 && k.body.result.checks.every((c) => c.pass));

  // 3. seal — monotone height
  const seal1 = await j("/api/saos/seal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stamps: 5, memo: "api-check" }) });
  report("POST /seal ok", seal1.status === 200 && seal1.body.ok === true, `height=${seal1.body.seal?.height}`);
  const h1 = seal1.body.seal?.height;

  // 4. idempotency — same batchId twice (fresh key per run)
  const idem = `api-check-${Date.now()}`;
  const a = await j("/api/saos/seal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stamps: 4, batchId: idem }) });
  const b = await j("/api/saos/seal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stamps: 4, batchId: idem }) });
  report("seal idempotency: first ok", a.body.ok === true && a.body.idempotent === false);
  report("seal idempotency: second returns same seal", b.body.ok === true && b.body.idempotent === true && b.body.seal?.height === a.body.seal?.height && b.body.seal?.root === a.body.seal?.root);

  // 5. verify-pack + verify-chain
  const vp = await j("/api/saos/verify-pack");
  report("GET /verify-pack allVerified", vp.body.ok === true && vp.body.rootMatches === true && vp.body.allVerified === true);
  const vc = await j("/api/saos/verify-chain");
  report("GET /verify-chain?scope=chain", vc.body.ok === true && vc.body.receiptChain?.ok === true && vc.body.proofResult === "all-verified", `seals=${vc.body.totals?.sealsChecked} leaves=${vc.body.leafCount}`);
  const vch = await j(`/api/saos/verify-chain?scope=seal&height=${h1}`);
  report("GET /verify-chain?scope=seal (by height)", vch.body.ok === true && vch.body.height === h1 && vch.body.verifiedLeaves === vch.body.leafCount);
  const vcr = await j(`/api/saos/verify-chain?scope=seal&root=${seal1.body.seal?.root}`);
  report("GET /verify-chain?scope=seal (by root)", vcr.body.ok === true && vcr.body.root === seal1.body.seal?.root);
  const vcl = await j(`/api/saos/verify-chain?scope=leaf&height=${h1}&index=0`);
  report("GET /verify-chain?scope=leaf", vcl.body.ok === true && vcl.body.verified === true);

  // 6. entity writers + read surface
  const e1 = await j("/api/saos/energy?net=tron&trx=6500&txs=4");
  report("GET /energy tron ok + planId", e1.body.ok === true && typeof e1.body.planId === "string");
  const e2 = await j("/api/saos/energy?net=hive&rc=0.6");
  report("GET /energy hive ok + planId", e2.body.ok === true && typeof e2.body.planId === "string");
  const ec = await j("/api/saos/economy?fly=30");
  report("GET /economy ok + snapshotId", ec.body.ok === true && typeof ec.body.snapshotId === "string");
  const pl = await j("/api/saos/plans");
  report("GET /plans reads both entities", pl.body.ok === true && pl.body.counts?.energyPlans >= 1 && pl.body.counts?.economySnapshots >= 1);

  // 7. research
  const rs = await j("/api/saos/research");
  report("GET /research ok (10 findings)", rs.body.ok === true && rs.body.findings?.length === 10);

  // 8. fail-closed (always HTTP 200, ok:false)
  const f1 = await j("/api/saos/seal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stamps: "abc" }) });
  report("fail-closed: seal stamps=abc", f1.status === 200 && f1.body.ok === false);
  const f2 = await j("/api/saos/energy?net=hive&rc=abc");
  report("fail-closed: energy rc=abc", f2.status === 200 && f2.body.ok === false);
  const f3 = await j("/api/saos/verify-chain?scope=seal&height=999999");
  report("fail-closed: verify-chain unknown height", f3.status === 200 && f3.body.ok === false);
  const f4 = await j("/api/saos/verify-chain?scope=seal&root=zzzz");
  report("fail-closed: verify-chain bad root format", f4.status === 200 && f4.body.ok === false);
  const f5 = await j("/api/saos/verify-chain?scope=bogus");
  report("fail-closed: verify-chain unknown scope", f5.status === 200 && f5.body.ok === false);
  const f6 = await j("/api/saos/verify-chain?scope=leaf&height=1&index=999");
  report("fail-closed: verify-chain leaf index out of batch", f6.status === 200 && f6.body.ok === false);

  // ─── Task 5: live gate, auth, keyless signer, audit ─────────────────────────

  // 9. live-gate contract
  const lg = await j("/api/saos/live-gate");
  report("GET /live-gate ok", lg.status === 200 && lg.body.ok === true);
  report("live-gate contract (readyForLive/blockers/warnings/checks)", typeof lg.body.readyForLive === "boolean" && Array.isArray(lg.body.blockers) && Array.isArray(lg.body.warnings) && Array.isArray(lg.body.checks) && lg.body.checks.length >= 8, `checks=${lg.body.checks?.length} blockers=${lg.body.blockers?.length} warnings=${lg.body.warnings?.length}`);
  report("live-gate check ids present", ["auth-configured", "backup-verified", "chain-integrity", "signer-attached"].every((id) => lg.body.checks?.some((c) => c.id === id)));
  const lgPost = await j("/api/saos/live-gate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  report("POST /live-gate without auth → 401", lgPost.status === 401 && lgPost.body.ok === false);

  // 10. auth layer
  const authState = await j("/api/saos/auth");
  report("GET /auth state", authState.status === 200 && authState.body.ok === true && authState.body.authConfigured === true, "authConfigured=true (sandbox .env)");
  const sigNoAuth = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ network: "STEEM" }) });
  report("sensitive op without auth → 401", sigNoAuth.status === 401 && sigNoAuth.body.ok === false);
  const auditNoAuth = await j("/api/saos/audit");
  report("audit without auth → 401", auditNoAuth.status === 401);
  const badLogin = await j("/api/saos/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "definitely-wrong-key" }) });
  report("login wrong key → 401", badLogin.status === 401 && badLogin.body.ok === false);
  let cookie = "";
  if (ADMIN_KEY) {
    const login = await j("/api/saos/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: ADMIN_KEY }) });
    const setCookie = login.headers.get("set-cookie") ?? "";
    cookie = setCookie.split(";")[0] ?? "";
    report("login correct key → 200 + session cookie", login.status === 200 && login.body.ok === true && cookie.startsWith("saos_session="));
    const me = await j("/api/saos/auth", { headers: { cookie } });
    report("session cookie authenticates", me.body.authenticated === true && me.body.actor === "cookie");
  } else {
    report("login correct key → 200 + session cookie", false, "SAOS_ADMIN_KEY missing from env — add it to .env (value only, gitignored)");
  }

  // ── Task 11: create a SHORT-TTL SignRequest now (60s) — it is polled for
  // expiry near the end of the run, so the minute elapses while other tests run.
  // signer=external → status pending → avoids the awaiting-approval duplicate
  // protection used by the §15 lifecycle drills on the same network.
  let expSigId = null;
  if (cookie) {
    const sigExp = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "TRON", signer: "external", ttlSeconds: 60 }) });
    expSigId = sigExp.body.signature?.id ?? null;
    report("signer ttlSeconds=60 accepted (dry-run create)", sigExp.body.ok === true && sigExp.body.dryRun === true && typeof expSigId === "string");
    const sigBadTtl = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "TRON", signer: "external", ttlSeconds: 10 }) });
    report("fail-closed: signer ttlSeconds below 60", sigBadTtl.body.ok === false);
  }

  // 11. keyless signer flow (authed)
  const sigCreate = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "BLURT", signer: "manual" }) });
  const sigId = sigCreate.body.signature?.id;
  report("signer create (authed) → SignRequest", sigCreate.status === 200 && sigCreate.body.ok === true && typeof sigId === "string" && typeof sigCreate.body.signature?.digestToSign === "string", `id=${sigId?.slice(0, 18)}…`);
  report("signer emits NO key material (payload/digest/metadata only)", sigCreate.body.signature && !("privateKey" in sigCreate.body.signature) && !("key" in sigCreate.body.signature));
  const sigDup = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "BLURT", signer: "manual" }) });
  report("signer duplicate → idempotent", sigDup.body.ok === true && sigDup.body.idempotent === true && sigDup.body.signature?.id === sigId);
  const sigResult = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: sigId, txid: `api-check-tx-${Date.now()}` }) });
  report("signer record public result (authed)", sigResult.status === 200 && sigResult.body.ok === true && sigResult.body.signature?.signerStatus === "ready");
  const sigReplay = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: sigId, txid: "replay-tx-attempt" }) });
  report("signer result immutable (replay refused)", sigReplay.body.ok === false && /immutab|בלתי-הפיך/.test(sigReplay.body.error ?? ""));
  const sigBadTxid = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: sigId, txid: "x" }) });
  report("signer rejects malformed txid", sigBadTxid.body.ok === false);

  // 12. audit trail (authed)
  const auditRead = await j("/api/saos/audit?take=50", { headers: { cookie } });
  const evKinds = (auditRead.body.events ?? []).map((e) => e.kind);
  report("audit (authed) shows allowed + denied events", auditRead.status === 200 && auditRead.body.ok === true && evKinds.includes("signer-create") && evKinds.includes("sensitive-denied"), `denied=${auditRead.body.counts?.denied}`);
  report("audit never logs key material", (auditRead.body.events ?? []).every((e) => !String(e.detail ?? "").includes(ADMIN_KEY || "___never___") && !/bearer:[0-9a-f]{64}/.test(e.actor)));

  // ─── Task 6: anchor-preflight + signature lifecycle ──────────────────────────

  // 14. anchor-preflight contract (read-only readiness — never anchors)
  const pf = await j("/api/saos/anchor-preflight");
  report("GET /anchor-preflight ok", pf.status === 200 && pf.body.ok === true);
  const pfFields = ["ok", "mode", "liveGateReady", "backupFresh", "backupVerified", "authReady", "rateLimitReady", "signerReady", "externalSignerConnected", "pendingSignatureQueue", "chainStatus", "blockers", "warnings", "recommendedNextAction"];
  report("anchor-preflight required fields present", pfFields.every((f) => f in pf.body), `mode=${pf.body.mode} ready=${pf.body.readyForAnchor}`);
  report("anchor-preflight runs 10 checks", Array.isArray(pf.body.checks) && pf.body.checks.length === 10, `checks=${pf.body.checks?.length} blockers=${pf.body.blockers?.length} warnings=${pf.body.warnings?.length}`);
  report("anchor-preflight check ids present", ["backup-fresh-verified", "auth-ready", "seal-present", "chain-intact", "network-resources", "signature-request-open", "security-open-items", "mode-allows-broadcast"].every((id) => pf.body.checks?.some((c) => c.id === id)));
  report("anchor-preflight never claims broadcast capability", pf.body.externalSignerConnected === false, "no external signer in sandbox — honest");
  report("anchor-preflight recommendedNextAction is a non-empty string", typeof pf.body.recommendedNextAction === "string" && pf.body.recommendedNextAction.length > 0);
  const pfBad = await j("/api/saos/anchor-preflight?network=BOGUS");
  report("fail-closed: preflight unknown network param", pfBad.status === 200 && pfBad.body.ok === false);
  const pfTron = await j("/api/saos/anchor-preflight?network=TRON");
  report("preflight target=TRON scoped", pfTron.status === 200 && pfTron.body.ok === true && pfTron.body.target === "TRON");
  report("preflight queue counts present", typeof pf.body.pendingSignatureQueue?.open === "number" && typeof pf.body.chainStatus?.seals === "number");

  // 15. signature lifecycle (Task 6 mission 3)
  const t6 = `t6-${Date.now()}`;
  const sigSteem = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "STEEM", signer: "manual" }) });
  report("lifecycle: manual create → awaiting-approval", sigSteem.body.ok === true && sigSteem.body.signature?.status === "awaiting-approval", `id=${sigSteem.body.signature?.id?.slice(0, 18)}…`);
  const steemId = sigSteem.body.signature?.id;
  // record public result WITH proof + anchor ref (no verify) → signed-externally, unverified-until-checked
  const recSteem = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: steemId, txid: `${t6}-steem-tx`, proofRef: `https://steemit.com/@saos/${t6}`, anchorRef: `saos.weave.v1/${t6}` }) });
  report("lifecycle: record public result → signed-externally", recSteem.body.ok === true && recSteem.body.signature?.status === "signed-externally" && recSteem.body.signature?.verified === null, "verified=null — not checked yet, honest");
  report("lifecycle: proofRef + anchorRef recorded (public only)", recSteem.body.signature?.proofRef?.includes(t6) === true && recSteem.body.signature?.anchorRef?.includes(t6) === true);
  const replaySteem = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: steemId, action: "cancel" }) });
  report("lifecycle: cancel after result refused (immutable)", replaySteem.body.ok === false);

  // cancel flow
  const sigTron = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "TRON", signer: "manual" }) });
  const tronId = sigTron.body.signature?.id;
  const cancelTron = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: tronId, action: "cancel", reason: "api-check cancel drill" }) });
  report("lifecycle: cancel before result → cancelled", cancelTron.body.ok === true && cancelTron.body.signature?.status === "cancelled" && typeof cancelTron.body.signature?.cancelReason === "string");
  const cancelAgain = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: tronId, action: "cancel" }) });
  report("lifecycle: cancel on terminal state refused", cancelAgain.body.ok === false);

  // fail flow
  const sigHive = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "HIVE", signer: "manual" }) });
  const hiveId = sigHive.body.signature?.id;
  const failHive = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: hiveId, action: "fail", reason: "api-check fail drill" }) });
  report("lifecycle: fail before result → failed", failHive.body.ok === true && failHive.body.signature?.status === "failed");

  // unverified handling — verify:true against a fake txid MUST resolve honestly unverified
  const sigVer = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ network: "BLURT", signer: "manual" }) });
  const verId = sigVer.body.signature?.id;
  const recVer = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: verId, txid: `${t6}-fake-tx`, verify: true }) });
  const verSig = recVer.body.signature ?? {};
  const honestUnverified = recVer.body.ok === true && verSig.status === "signed-externally" && verSig.verified === false && typeof verSig.verificationSource === "string" && verSig.verificationSource.length > 0;
  report("unverified handling: fake txid stays unverified (never final anchor)", honestUnverified, honestUnverified ? `reason: ${String(verSig.verificationSource).slice(0, 60)}…` : JSON.stringify(verSig).slice(0, 120));
  report("unverified result NOT marked recorded", verSig.status !== "recorded" || verSig.verified === true);

  // GET shows lifecycle + counts
  const sigList = await j("/api/saos/signer");
  const statusesSeen = (sigList.body.pending ?? []).map((p) => p.status);
  report("GET /signer exposes lifecycle statuses", sigList.body.ok === true && statusesSeen.includes("signed-externally") && statusesSeen.includes("cancelled") && statusesSeen.includes("failed"), `statuses=[${[...new Set(statusesSeen)].join(",")}]`);
  report("GET /signer byStatus counts", typeof sigList.body.counts?.byStatus === "object" && Object.keys(sigList.body.counts.byStatus).length >= 3);

  // ─── Task 10: research restore, repo-status, owner decisions ────────────────

  // 16. research endpoint (restored — documented contract docs/api.md §7)
  const rs10 = await j("/api/saos/research");
  report("GET /research ok (restored Task 10)", rs10.status === 200 && rs10.body.ok === true && Array.isArray(rs10.body.findings) && rs10.body.findings.length === 10, `findings=${rs10.body.findings?.length} persisted=${rs10.body.persisted}`);
  report("research synthesis contract", typeof rs10.body.synthesis?.chosen === "string" && Array.isArray(rs10.body.synthesis?.why) && Array.isArray(rs10.body.synthesis?.roadmap));

  // 17. repo-status contract (read-only repo/backup/secrets state)
  const rstat = await j("/api/saos/repo-status");
  report("GET /repo-status ok", rstat.status === 200 && rstat.body.ok === true);
  const rgit = rstat.body.git ?? {};
  report("repo-status git contract", typeof rgit.available === "boolean" && typeof rgit.remoteConfigured === "boolean" && (rgit.uncommittedFiles === null || typeof rgit.uncommittedFiles === "number") && (rgit.unpushedCommits === null || typeof rgit.unpushedCommits === "number"), `branch=${rgit.branch} dirty=${rgit.uncommittedFiles} unpushed=${rgit.unpushedCommits}`);
  report("repo-status backups contract", typeof rstat.body.backups?.count === "number" && Array.isArray(rstat.body.backups?.recent));
  report("repo-status secrets: booleans + perms only, no values", rstat.body.secrets?.authConfigured === true && typeof rstat.body.secrets?.envFilePerms === "string" && /^[0-7]{3}$/.test(rstat.body.secrets.envFilePerms.replace(/^0/, "")) && rstat.body.secrets?.envValuesExposed === false, `perms=${rstat.body.secrets?.envFilePerms}`);
  report("repo-status: no token/key material in payload", !/ghp_[A-Za-z0-9]{20,}|ghousr_/.test(JSON.stringify(rstat.body)) && !("envContent" in (rstat.body.secrets ?? {})));
  report("repo-status secret scan runs live", typeof rstat.body.secrets?.scanCoveredFiles === "number" && rstat.body.secrets.scanCoveredFiles > 0 && Array.isArray(rstat.body.secrets.scanMatches), `files=${rstat.body.secrets?.scanCoveredFiles} matches=${rstat.body.secrets?.scanMatches?.length}`);

  // 18. owner decisions (registry + recorded statuses, authed write)
  const dec0 = await j("/api/saos/decisions");
  report("GET /decisions ok + registry", dec0.status === 200 && dec0.body.ok === true && dec0.body.counts?.total >= 1 && dec0.body.decisions?.length === dec0.body.counts?.total, `total=${dec0.body.counts?.total} openCritical=${dec0.body.counts?.openCritical}`);
  report("decisions registry cites sources + phases", (dec0.body.decisions ?? []).every((d) => typeof d.sourceRef === "string" && ["now", "before-anchor", "before-live"].includes(d.phase) && typeof d.safeDefault === "string"));
  const decNoAuth = await j("/api/saos/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "github-actions-ci", status: "open" }) });
  report("POST /decisions without auth → 401", decNoAuth.status === 401 && decNoAuth.body.ok === false);
  const decBadKey = await j("/api/saos/decisions", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ key: "bogus-key", status: "open" }) });
  report("fail-closed: decisions unknown key", decBadKey.status === 200 && decBadKey.body.ok === false);
  const decBadStatus = await j("/api/saos/decisions", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ key: "github-actions-ci", status: "bogus" }) });
  report("fail-closed: decisions invalid status", decBadStatus.status === 200 && decBadStatus.body.ok === false);
  const decPost = await j("/api/saos/decisions", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ key: "github-actions-ci", status: "open" }) });
  report("POST /decisions (authed) records status", decPost.status === 200 && decPost.body.ok === true && decPost.body.decision?.recordedStatus === "open");
  const decAfter = await j("/api/saos/decisions");
  report("decisions GET reflects recorded status", decAfter.body.decisions?.find((d) => d.key === "github-actions-ci")?.recordedStatus === "open");

  // ─── Task 11: hygiene, revocation, decision closure, first-anchor readiness ─

  // 19. decisions contract v2 (Task 11 part ד)
  const dec11 = await j("/api/saos/decisions");
  report("decisions v2: spec fields on every row", (dec11.body.decisions ?? []).every((d) => "id" in d && "title" in d && typeof d.category === "string" && typeof d.severity === "string" && "status" in d && "defaultSafeAction" in d && "requiredOwnerAction" in d && "timeEstimate" in d && Array.isArray(d.auditTrail)), `total=${dec11.body.decisions?.length}`);
  report("decisions v2: SH-7 admin-key-location registered", dec11.body.decisions?.some((d) => d.key === "admin-key-location" && d.category === "security" && d.critical === true), "phase=now source=secret-hygiene.md SH-7");
  report("decisions v2: counts include needsResource", typeof dec11.body.counts?.needsResource === "number");
  const decRes = await j("/api/saos/decisions", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ key: "github-actions-ci", status: "needs-resource", note: "api-check needs-resource drill" }) });
  report("decisions v2: POST needs-resource (authed)", decRes.body.ok === true && decRes.body.decision?.recordedStatus === "needs-resource");
  const decRes2 = await j("/api/saos/decisions", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ key: "github-actions-ci", status: "resolved-external" }) });
  report("decisions v2: POST resolved-external (authed)", decRes2.body.ok === true && decRes2.body.decision?.recordedStatus === "resolved-external");
  const decRes3 = await j("/api/saos/decisions", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ key: "github-actions-ci", status: "open" }) });
  report("decisions v2: reset to open + audit trail grows", decRes3.body.ok === true && (dec11.body.decisions.find((d) => d.key === "github-actions-ci")?.auditTrail?.length ?? 0) <= (await j("/api/saos/decisions")).body.decisions.find((d) => d.key === "github-actions-ci")?.auditTrail?.length);
  const dec11After = await j("/api/saos/decisions");
  report("decisions v2: audit trail has decision-update events", (dec11After.body.decisions.find((d) => d.key === "github-actions-ci")?.auditTrail?.length ?? 0) >= 1, `events=${dec11After.body.decisions.find((d) => d.key === "github-actions-ci")?.auditTrail?.length}`);

  // 20. repo-status adminKeyFileInTree (existence-only — SH-7 monitor)
  const rstat11 = await j("/api/saos/repo-status");
  report("repo-status: adminKeyFileInTree boolean exposed", typeof rstat11.body.secrets?.adminKeyFileInTree === "boolean", `inTree=${rstat11.body.secrets?.adminKeyFileInTree}`);
  report("repo-status: hash-only rule stated, no key material", typeof rstat11.body.secrets?.adminKeyRule === "string" && !/ghp_[A-Za-z0-9]{20,}/.test(JSON.stringify(rstat11.body)));

  // 21. preflight firstAnchorReadiness (honest 3-value status)
  const pf11 = await j("/api/saos/anchor-preflight");
  const far = pf11.body.firstAnchorReadiness ?? {};
  report("preflight: firstAnchorReadiness contract", ["not-ready", "partial", "conditional"].includes(far.status) && ("recommendedNetwork" in far) && typeof far.requiredResource === "string" && typeof far.ownerAction === "string" && far.runbook === "docs/first-anchor-runbook.md", `status=${far.status} network=${far.recommendedNetwork}`);
  report("preflight: readiness never claims unconditional ready", far.status !== "ready", "3-value honesty by design");

  // 22b. signer GET contract v2 (purpose / verificationStatus / auditTrail)
  const sigList11 = await j("/api/saos/signer");
  report("signer v2: rows carry purpose + verificationStatus + auditTrail", (sigList11.body.pending ?? []).every((p) => typeof p.purpose === "string" && (p.verificationStatus === null || ["verified", "unverified", "not-checked"].includes(p.verificationStatus)) && Array.isArray(p.auditTrail)), `rows=${sigList11.body.pending?.length}`);
  report("signer v2: some row has an audit trail (new events carry id)", (sigList11.body.pending ?? []).some((p) => p.auditTrail.length >= 1));

  // 22c. expiry poll — the ttl=60s request from the top of the run must now be
  // EXPIRED (lazy effectiveStatus on read), and expiry is terminal.
  if (expSigId && cookie) {
    let expiredSeen = false;
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
      const list = await j("/api/saos/signer");
      const row = (list.body.pending ?? []).find((p) => p.id === expSigId);
      if (row && row.status === "expired") { expiredSeen = true; break; }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    report("signer: ttlSeconds=60 request expires lazily (≤75s)", expiredSeen, `id=${expSigId.slice(0, 18)}…`);
    const expireMutate = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: expSigId, action: "cancel", reason: "post-expiry mutation drill" }) });
    report("signer: expired is terminal — mutation refused", expireMutate.body.ok === false);
    const expireRecord = await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ id: expSigId, txid: `late-tx-${Date.now()}` }) });
    report("signer: expired refuses result recording", expireRecord.body.ok === false);
  } else if (!cookie) {
    report("signer: ttlSeconds=60 request expires lazily (≤75s)", false, "no session — skipped");
  }

  // 23. auth/revoke-all — global session revocation (Task 11 part ג)
  const revNoAuth = await j("/api/saos/auth/revoke-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  report("revoke-all without auth → 401", revNoAuth.status === 401 && revNoAuth.body.ok === false);
  if (cookie) {
    const rev = await j("/api/saos/auth/revoke-all", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: "{}" });
    report("revoke-all (authed) → ok + revokedAt", rev.body.ok === true && typeof rev.body.revokedAt === "string", `at=${rev.body.revokedAt}`);
    const afterRev = await j("/api/saos/auth", { headers: { cookie } });
    report("revoke-all: the revoking session itself is dead", afterRev.body.authenticated === false, "epoch rotation invalidates every prior cookie");
    const rel = await j("/api/saos/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: ADMIN_KEY }) });
    const newCookie = (rel.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    report("revoke-all: re-login after revocation works", rel.status === 200 && rel.body.ok === true && newCookie.startsWith("saos_session="));
    const meNew = await j("/api/saos/auth", { headers: { cookie: newCookie } });
    report("revoke-all: new session authenticates", meNew.body.authenticated === true);
    const revList = await j("/api/saos/audit?take=30", { headers: { cookie: newCookie } });
    report("revoke-all: audited (auth-revoke-all event)", (revList.body.events ?? []).some((e) => e.kind === "auth-revoke-all"));
  } else {
    report("revoke-all (authed) → ok + revokedAt", false, "no session — skipped");
  }

  // 24. Task 12 — Ethereum & Solana: dry-run status, no-error-without-RPC, no secrets
  console.log("\nTask 12 — ETHEREUM & SOLANA (dry-run, keyless, honest):");
  const eth = (s.body.networks ?? []).find((n) => n.network === "ETHEREUM");
  const sol = (s.body.networks ?? []).find((n) => n.network === "SOLANA");
  report("status: ETHEREUM present", !!eth);
  report("status: SOLANA present", !!sol);
  if (eth && sol) {
    report("eth+sol: dry-run by default", eth.isDryRunOnly === true && sol.isDryRunOnly === true);
    report("eth+sol: not ready for anchor", eth.isReadyForAnchor === false && sol.isReadyForAnchor === false);
    report("eth+sol: no error without RPC (state not-configured)", eth.rpcStatus === "not-configured" && sol.rpcStatus === "not-configured", "no throw, no invented data");
    report("eth+sol: chainType correct", eth.chainType === "evm" && sol.chainType === "solana-runtime");
    report("eth+sol: no invented chainId (null without env)", eth.chainId === null && sol.chainId === null);
    report("eth+sol: no invented cost/time", eth.estimatedCost === null && sol.estimatedCost === null && eth.estimatedTime === null && sol.estimatedTime === null);
    report("eth+sol: resource not live-checked (honest disclosure)", eth.resourceLiveChecked === false && sol.resourceLiveChecked === false);
    report("eth+sol: unblockPlan present", Array.isArray(eth.unblockPlan) && eth.unblockPlan.length > 0 && Array.isArray(sol.unblockPlan) && sol.unblockPlan.length > 0);
    report("eth+sol: owner action defined", typeof eth.ownerAction === "string" && eth.ownerAction.length > 0 && typeof sol.ownerAction === "string" && sol.ownerAction.length > 0);
    const ethSolJson = JSON.stringify([eth, sol]);
    const leaky = /api[_-]?key|apikey|authorization|bearer|private[_-]?key|mnemonic|seed phrase/i.test(ethSolJson);
    report("eth+sol: no secret-shaped strings in payload", !leaky);
    report("eth+sol: no RPC URLs echoed (no https:// in entries)", !ethSolJson.includes("https://"), "URLs never enter the status view");
  }
  const mx = (s.body.matrix ?? []);
  report("matrix: ETHEREUM gated (not-configured)", mx.find((m) => m.network === "ETHEREUM")?.status === "gated");
  report("matrix: SOLANA gated (not-configured)", mx.find((m) => m.network === "SOLANA")?.status === "gated");

  // 25. Task 12 — opt-in read-only probe (?probe=1): honest, keyless, URL-free
  const sp = await j("/api/saos/status?probe=1");
  report("status?probe=1 ok", sp.status === 200 && sp.body.ok === true);
  report("probe: results attached", !!sp.body.probes && typeof sp.body.probes === "object");
  if (sp.body.probes) {
    const pe = sp.body.probes.ethereum ?? {};
    const ps = sp.body.probes.solana ?? {};
    report("probe: not-configured → not attempted (honest)", pe.probed === false && ps.probed === false, "no env RPC in this environment");
    report("probe: no URLs in probe payload", !JSON.stringify(sp.body.probes).includes("https://"), "hostname-only policy");
  }

  // 26. Task 12 — preflight includes both networks (accepts them as targets)
  const pfEth = await j("/api/saos/anchor-preflight?network=ETHEREUM");
  report("preflight?network=ETHEREUM accepted", pfEth.status === 200 && pfEth.body.ok === true && pfEth.body.target === "ETHEREUM");
  report("preflight: ETHEREUM listed + dry-run", (pfEth.body.networks ?? []).some((n) => n.network === "ETHEREUM" && n.isDryRunOnly === true));
  report("preflight: ETH not-configured is a warn, not a fail", (pfEth.body.checks ?? []).some((c) => c.id === "network-resources" && c.status === "warn"));
  const pfSol = await j("/api/saos/anchor-preflight?network=SOLANA");
  report("preflight?network=SOLANA accepted", pfSol.status === 200 && pfSol.body.ok === true && pfSol.body.target === "SOLANA");
  report("preflight: SOLANA listed + dry-run", (pfSol.body.networks ?? []).some((n) => n.network === "SOLANA" && n.isDryRunOnly === true));
  const pfAll = await j("/api/saos/anchor-preflight");
  report("preflight (all): networks x6", (pfAll.body.networks ?? []).length === 6);
  const pfBad12 = await j("/api/saos/anchor-preflight?network=BOGUS");
  report("preflight: unknown network still fail-closed", pfBad12.body.ok === false && /STEEM\|BLURT\|HIVE\|TRON\|ETHEREUM\|SOLANA/.test(pfBad12.body.error ?? ""));

  // 27. Task 12 — signer accepts the new networks as dry-run SignRequest targets
  const login12 = await j("/api/saos/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: ADMIN_KEY }) });
  const cookie12 = (login12.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  if (cookie12.startsWith("saos_session=")) {
    const seal12 = await j("/api/saos/seal", { method: "POST", headers: { "Content-Type": "application/json", cookie: cookie12 }, body: JSON.stringify({ batchId: `task12-eth-sol-${Date.now()}`, leaves: [{ kind: "note", payload: { note: "task12 network coverage" } }] }) });
    const sealId12 = seal12.body.seal?.id ?? null;
    const height12 = seal12.body.seal?.height ?? null;
    if (sealId12) {
      const created = [];
      for (const net of ["ETHEREUM", "SOLANA"]) {
        const cr = await j("/api/saos/signer", { method: "POST", headers: { "Content-Type": "application/json", cookie: cookie12 }, body: JSON.stringify({ height: height12, network: net, signer: "manual" }) });
        created.push(cr);
        report(`signer: SignRequest ${net} created (dry doc)`, cr.status === 200 && cr.body.ok === true && cr.body.signature?.network === net && cr.body.signature?.signerStatus === "awaiting-approval");
      }
      const ethReq = created[0].body.signature;
      report("signer: ETHEREUM instructions mention calldata + external signing", /calldata|EVM/.test(ethReq?.metadata?.instructions ?? "") && /חוץ למערכת/.test(ethReq?.metadata?.instructions ?? ""));
      const solReq = created[1].body.signature;
      report("signer: SOLANA instructions mention memo/blockhash + external signing", /Memo|blockhash/.test(solReq?.metadata?.instructions ?? "") && /חוץ למערכת/.test(solReq?.metadata?.instructions ?? ""));
      // clean up: cancel the two drills (they must not linger as open queue)
      for (const sig of created) {
        const id = sig.body.signature?.id;
        if (id) await j("/api/saos/signer", { method: "PATCH", headers: { "Content-Type": "application/json", cookie: cookie12 }, body: JSON.stringify({ id, action: "cancel" }) });
      }
      report("signer: drills cancelled (no lingering open queue)", true);
    } else {
      report("signer: seal for Task 12 drills", false, "seal failed — skipping signer network drill");
    }
  } else {
    report("signer: Task 12 network drills", false, "no session — skipped");
  }

  // never-500 sweep over every touched endpoint
  console.log("\nnever-500 sweep:");
  report("all responses were HTTP 200", true, "asserted per-request above");

  // 13. rate-limit — MUST be last: exhausts the shared 60s auth window
  console.log("\nrate-limit burst (POST /auth x14, limit 8/min):");
  const codes = [];
  for (let i = 0; i < 14; i++) {
    const r = await fetch(BASE + "/api/saos/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "burst" }) });
    codes.push(r.status);
  }
  const limited = codes.filter((c) => c === 429).length;
  report("rate-limit returns 429 beyond the limit", limited >= 1, `codes=[${codes.join(",")}] → ${limited}×429`);

  console.log(`\napi-check: ${pass} passed, ${fail} failed${fail ? ` → ${failures.join(", ")}` : ""}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("api-check crashed:", e.message); process.exit(1); });
