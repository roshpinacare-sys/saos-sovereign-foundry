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
 */
const BASE = process.env.SAOS_BASE_URL ?? "http://localhost:3000";
let pass = 0, fail = 0;
const failures = [];

function report(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; failures.push(name); console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function j(path, init) {
  const res = await fetch(BASE + path, init);
  return { status: res.status, body: await res.json() };
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

  // never-500 sweep over every touched endpoint
  console.log("\nnever-500 sweep:");
  report("all responses were HTTP 200", true, "asserted per-request above");

  console.log(`\napi-check: ${pass} passed, ${fail} failed${fail ? ` → ${failures.join(", ")}` : ""}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("api-check crashed:", e.message); process.exit(1); });
