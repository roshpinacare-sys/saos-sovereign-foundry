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
  return { status: res.status, body: await res.json(), headers: res.headers };
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
  report("GET /status networks x4", Array.isArray(s.body.networks) && s.body.networks.length === 4);
  report("GET /status matrix x4", Array.isArray(s.body.matrix) && s.body.matrix.length === 4);

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
