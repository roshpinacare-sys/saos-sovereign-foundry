/**
 * selftest.mjs — deterministic offline vectors for the sovereign-local core.
 * Zero network, zero clock, zero randomness. RUN: bun selftest.mjs
 */
import {
  dragK, inventorySkew, planLadder, planConvert, classifyStale, pnlFromFills, guardDepth, parityVerdict,
  MIN_LEVEL, ASK_FLOOR_BPS,
} from "./lib.mjs";
import { tick, fold } from "./grid.mjs";

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  got: ${ja}\n  want: ${jb}`); }
};
const ok = (name, cond) => (cond ? pass++ : (fail++, console.error(`FAIL ${name}`)));

/* 1 · dragK monotone + clamped */
eq("dragK@0", dragK(0), 1);
eq("dragK@1000", dragK(1000), 1.5);
eq("dragK@99999", dragK(99999), 3);

/* 2 · inventory skew: rich-STEEM ⇒ bigger asks */
const skewRich = inventorySkew(900, 10, 0.107);
ok("skew rich asks>1", skewRich.askMult > 1);
ok("skew rich bids<1", skewRich.bidMult < 1);
const skewBalanced = inventorySkew(450, 450 * 0.107, 0.107); // T-8b inversion trap: SBD→STEEM units is ×parity, not ÷
ok("skew balanced ~0", Math.abs(skewBalanced.skew) < 1e-6);
const skewSbd = inventorySkew(10, 900 / 0.107, 0.107);
ok("skew sbd-rich asks<1", skewSbd.askMult < 1);

/* 3 · parity verdict + band refuse */
eq("band ok", parityVerdict(0.107, 0.1069).ok, true);
eq("band refuse", parityVerdict(0.5, 0.107).reason, "parity-band-refuse");
eq("no feed", parityVerdict(0.107, 0).reason, "no-internal-feed");

/* 4 · ladder law: floor/ceiling never violated; budgets respected BY CONSTRUCTION */
const P = 0.107;
const plan = planLadder({ parity: P, askBudgetSteem: 100, bidBudgetSbd: 50, now: "2026-01-01T00:00:00Z" });
eq("plan ready", plan.verdict, "OFFER-READY");
eq("asks 5", plan.asks.length, 5);
eq("bids 5", plan.bids.length, 5);
const floor = P * (1 + ASK_FLOOR_BPS / 10000);
ok("asks ≥ floor", plan.asks.every((a) => a.unit >= floor - 1e-12));
ok("bids ≤ ceiling", plan.bids.every((b) => b.unit <= plan.ceiling + 1e-12));
const sumA = Math.round(plan.asks.reduce((s, a) => s + a.amountSteem, 0) * 1e6) / 1e6;
ok("ask sum ≤ budget", sumA <= 100 + 1e-9);
const sumB = Math.round(plan.bids.reduce((s, b) => s + b.amountSbd, 0) * 1e6) / 1e6;
ok("bid sum ≤ budget", sumB <= 50 + 1e-9);

/* 5 · the T-5 rounding-blocker vector: 379.23 vs 379.229 must not block */
const plan2 = planLadder({ parity: P, askBudgetSteem: 379.229, bidBudgetSbd: 2.919, now: "2026-01-01T00:00:00Z" });
ok("rounding vector asks>0", plan2.asks.length > 0);
ok("rounding vector sum≤commitable", plan2.asks.reduce((s, a) => s + a.amountSteem, 0) <= 379.229 + 1e-9);

/* 6 · dust-break: below min-level ⇒ empty with honest blocker */
const plan3 = planLadder({ parity: P, askBudgetSteem: 0.3, bidBudgetSbd: 0.3, now: "2026-01-01T00:00:00Z" });
eq("dust asks", plan3.asks.length, 0);
eq("dust verdict", plan3.verdict, "OFFER-EMPTY");

/* 7 · min-fuel gate restored: budget ≥ minLevel but < minLevel×levels fills fewer levels */
const plan4 = planLadder({ parity: P, askBudgetSteem: 1.4, bidBudgetSbd: 0, now: "2026-01-01T00:00:00Z" });
eq("partial levels", plan4.asks.length, 2);

/* 8 · PSM hysteresis: enter at 3000, stay armed down to 2000, exit below */
const mk = (edge) => ({ liquidSbd: 5, parity: P, marketSbdUsd: 1 / (1 + edge), previouslyArmed: false });
eq("psm below-enter", planConvert(mk(0.29)).verdict, "CONVERT-HOLD");
eq("psm enter", planConvert(mk(0.30)).verdict, "CONVERT-PLAN");
const armedHold = planConvert({ liquidSbd: 5, parity: P, marketSbdUsd: 1 / 1.22, previouslyArmed: true });
eq("psm hysteresis-hold", armedHold.verdict, "CONVERT-PLAN");
const armedExit = planConvert({ liquidSbd: 5, parity: P, marketSbdUsd: 1 / 1.19, previouslyArmed: true });
eq("psm hysteresis-exit", armedExit.verdict, "CONVERT-HOLD");
eq("psm dust", planConvert({ liquidSbd: 0.2, parity: P, marketSbdUsd: 0.6, previouslyArmed: false }).verdict, "CONVERT-HOLD");
const psmCap = planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0.6, pendingSbd: 9.8, previouslyArmed: false });
eq("psm cap honest-hold (0.2<min dust)", psmCap.verdict, "CONVERT-HOLD");
eq("psm cap amount", psmCap.amountSbd, 0);
const psmCap2 = planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0.6, pendingSbd: 8.5, previouslyArmed: false });
eq("psm cap partial", psmCap2.amountSbd, 1.5);

/* 8b · T-9 structural truth: no external SBD market ⇒ honest HOLD (never arm on proxy) */
eq("psm no-market honest-hold", planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0, previouslyArmed: false }).verdict, "CONVERT-HOLD");
eq("psm no-market reason", planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0, previouslyArmed: true }).reason, "no-market-price");

/* 9 · stale classification: asks below floor / bids above ceiling (10bps tol) */
const orders = [
  { side: "ask", unit: P },                       // below floor ⇒ stale
  { side: "ask", unit: floor },                   // at floor ⇒ healthy
  { side: "bid", unit: P * 0.999 },               // above ceiling (ceiling=parity−20bps) ⇒ stale
  { side: "bid", unit: P * (1 - ASK_FLOOR_BPS / 10000) }, // at ceiling ⇒ healthy
];
const cls = classifyStale(orders, P);
eq("stale count", cls.stale.length, 2);
eq("stale sides", cls.stale.map((o) => o.side), ["ask", "bid"]);

/* 10 · P&L: avg-cost realized; unbased never profit */
const p1 = pnlFromFills([
  { side: "bid", steem: 10, sbd: 1.0 },           // avg 0.10
  { side: "ask", steem: 5, sbd: 0.6 },            // realized 0.6−0.5=+0.1
]);
eq("realized", p1.realizedSbd, 0.1);
eq("position", p1.positionSteem, 5);
const p2 = pnlFromFills([
  { side: "ask", steem: 10, sbd: 1.0 },           // no basis
]);
eq("unbased honest", p2.realizedSbd, 0);
eq("unbased qty", p2.unbasedSteem, 10);

/* 11 · guards */
eq("depth ok", guardDepth(8, 64).ok, true);
eq("depth cap", guardDepth(9, 0).reason, "depth-cap");
eq("fires cap", guardDepth(0, 65).reason, "fires-cap");

/* 12 · grid tick deterministic */
const t1 = tick({ refPrice: 0.107, internalFeed: 0.105, inventory: { steem: 10, sbd: 10 }, runCount: 0, now: "2026-01-01T00:00:00Z" }); // gap ~190bps ≥100 ⇒ arb signal
const t2 = tick({ refPrice: 0.107, internalFeed: 0.105, inventory: { steem: 10, sbd: 10 }, runCount: 0, now: "2026-01-01T00:00:00Z" });
eq("tick deterministic", t1, t2);
ok("tick emits anchor quote", t1.events.some((e) => e.type === "anchor.quote"));
ok("tick arb signal", t1.events.some((e) => e.type === "arb.signal"));
const st1 = fold({ runCount: 0 }, t1);
eq("fold runCount", st1.runCount, 1);

/* 13 · no-market fail-closed */
const t3 = tick({ refPrice: 0, internalFeed: 0, inventory: { steem: 10, sbd: 10 }, runCount: 1, now: "2026-01-01T00:00:00Z" });
ok("no-market event", t3.events.some((e) => e.type === "grid.no-market"));
eq("no-market fills", t3.fills.length, 0);

/* ── 14 · T-12 steemtx: crypto + serialization vectors (offline, throwaway seed) ── */
import { wifEncode, wifDecode, pubkeyFromSeed, serializeTx, buildTx, SEED_ORDERS, wifFor, derivePub, pubkeyBytes } from "./steemtx.mjs";
import { sha256 } from "@noble/hashes/sha256";
import * as secp from "@noble/secp256k1";

const seed32 = sha256(Buffer.from("saos-selftest-seed", "utf8"));
const wifT = wifEncode(seed32);
ok("wif roundtrip", Buffer.from(wifDecode(wifT)).equals(Buffer.from(seed32)));
ok("wif deterministic", wifEncode(seed32) === wifT);
const pubT = pubkeyFromSeed(seed32);
ok("pubkey STM format", pubT.startsWith("STM") && pubT.length === 53);
ok("pubkey bytes roundtrip", Buffer.from(pubkeyBytes(pubT)).equals(Buffer.from(secp.getPublicKey(Buffer.from(seed32), true))));
ok("seed order determinism", derivePub(SEED_ORDERS["name+role+pw"]("acc", "active", "pw")) === derivePub(SEED_ORDERS["name+role+pw"]("acc", "active", "pw")));
ok("seed order sensitivity", derivePub(SEED_ORDERS["name+role+pw"]("acc", "active", "pw")) !== derivePub(SEED_ORDERS["pw+role+name"]("acc", "active", "pw")));

const dgpoVec = { head_block_number: 92527123, head_block_id: "00bcdeff11223344556677889900aabbccddeeff" };
const txVec = buildTx({
  ops: [["limit_order_create", { owner: "headcorner", orderid: 123456, amount_to_sell: "0.001 STEEM", min_to_receive: "0.000 SBD", fill_or_kill: false, expiration: 1790000000 + 60 }]],
  dgpo: dgpoVec, wifs: [wifT], nowSec: 1790000000,
});
eq("tx ref_block_num", txVec.json.ref_block_num, 92527123 & 0xffff);
ok("tx ref_block_prefix", txVec.json.ref_block_prefix === Buffer.from("11223344", "hex").readUInt32LE(0));
eq("sig length 65B", txVec.json.signatures[0].length, 130);
ok("sig header compressed", parseInt(txVec.json.signatures[0].slice(0, 2), 16) >= 31 && parseInt(txVec.json.signatures[0].slice(0, 2), 16) <= 34);
ok("sig deterministic", buildTx({ ops: [["limit_order_create", { owner: "headcorner", orderid: 123456, amount_to_sell: "0.001 STEEM", min_to_receive: "0.000 SBD", fill_or_kill: false, expiration: 1790000000 + 60 }]], dgpo: dgpoVec, wifs: [wifT], nowSec: 1790000000 }).json.signatures[0] === txVec.json.signatures[0]);

// VESTS 6-dp: the digits themselves are the scaled uint64
const binV = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["claim_reward_balance", { account: "headcorner", reward_steem: "0.000 STEEM", reward_sbd: "0.000 SBD", reward_vests: "96.123456 VESTS" }]] });
ok("vests 6dp serializes", binV.length > 40);
// cancel op deterministic size: 2+4+4 +1(opcount)+1(opid) +1+10(owner) +4(orderid) +1(ext) = 28
const binC = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["limit_order_cancel", { owner: "headcorner", orderid: 42 }]] });
eq("cancel op exact size", binC.length, 28);

/* vote op serializes (posting-authority op — T-13 curator rail) */
const binVote = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["vote", { voter: "headcorner", author: "someone", permlink: "a-permlink", weight: 5000 }]] });
ok("vote op serializes", binVote.length > 30);
// negative weight (downvote) must serialize too — policy never emits it, chain accepts it
// (tiny names ⇒ 21 bytes total: 11 header + 1 count + 1 opid + 2+2+2 strs + 2 weight)
const binDown = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["vote", { voter: "a", author: "b", permlink: "c", weight: -1000 }]] });
eq("vote negative weight size", binDown.length, 21);

/* ── 15 · T-13 curator: pure planner vectors (deterministic, offline) ── */
import { filterCandidates, weightForAge, vpEffPct, dayKeyOf, curatorPolicy } from "./curator.mjs";

const CP = curatorPolicy();
const NOW = Date.parse("2026-09-29T19:00:00Z");
const mkPost = (author, permlink, ageMin, extra = {}) => ({
  author, permlink, tag: "steem", createdMs: NOW - ageMin * 60000,
  title: `A reasonable title ${permlink}`, bodyLen: 900, pendingSbd: 0.5, archived: false, votedByUs: false, ...extra,
});
const posts = [
  mkPost("alice", "fresh", 30),
  mkPost("bob", "stale", 1300),                                    // too old
  mkPost("carol", "young", 5),                                     // too young
  mkPost("dave", "spam", 60, { bodyLen: 50 }),                     // short body
  mkPost("headcorner", "self", 60),                                // self-fleet
  mkPost("erin", "voted", 60, { votedByUs: true }),                // already voted on-chain
  mkPost("frank", "hot", 60, { pendingSbd: 99 }),                  // bandwagon
  mkPost("grace", "closed", 60, { archived: true }),               // payout closed
  mkPost("alice", "second", 60),                                   // author-cap (2nd alice)
  mkPost("heidi", "caps", 60, { title: "SCREAMING SPAM TITLE HERE" }), // spam-title
  mkPost("ivan", "ok1", 240),
  mkPost("judy", "ok2", 720),
];
const planC = filterCandidates({ posts, voter: "headcorner", policy: CP, nowMs: NOW });
eq("curator selected", planC.selected.map((v) => v.author), ["alice", "ivan", "judy"]);
eq("curator alice weight decays", planC.selected[0].weight, weightForAge(30, CP));
ok("curator fresh > old weight", planC.selected[0].weight > planC.selected[2].weight);
eq("curator weight in band", weightForAge(30, CP) <= CP.baseWeightPct * 100 && weightForAge(1300, CP) === CP.minWeightPct * 100, true);
ok("curator rejections honest", planC.rejected.some((r) => r.reason === "too-old") && planC.rejected.some((r) => r.reason === "short-body") && planC.rejected.some((r) => r.reason === "self-fleet") && planC.rejected.some((r) => r.reason === "already-voted") && planC.rejected.some((r) => r.reason === "bandwagon") && planC.rejected.some((r) => r.reason === "author-cap"));

/* day-cap: 10 already voted today ⇒ nothing new */
const capped = filterCandidates({ posts: [mkPost("kate", "late", 60)], voter: "x", policy: CP, nowMs: NOW, votesToday: 10 });
eq("curator day-cap", capped.selected.length, 0);
ok("curator day-cap reason", capped.rejected.some((r) => r.reason === "day-cap"));

/* determinism: same input twice ⇒ byte-identical plan */
const again = filterCandidates({ posts, voter: "headcorner", policy: CP, nowMs: NOW });
eq("curator deterministic", again.selected, planC.selected);

/* VP effective: mana/(vests×1e6) */
eq("vpEff math", vpEffPct(6.094470913801e12, 7123991.568646), 85.5);
eq("vpEff zero vests", vpEffPct(100, 0), null);
eq("day key", dayKeyOf("2026-09-29T19:00:00.000Z"), "2026-09-29");

/* ── 16 · T-14 learning + discovery: evidence-based lessons, hard-clamped tunings ── */
import {
  classifyCycleFailure, analyzeCycles, analyzeCurator, analyzeExec,
  deriveLessons, deriveTunings, LEARN_CLAMP,
} from "./learning.mjs";
import { rankTags, curationShareEstimate, scoreOpportunities } from "./discovery.mjs";

/* failure classification — the sovereign retry doctrine, mirrored pure */
eq("fail-class conn", classifyCycleFailure("fetch failed"), "conn");
eq("fail-class conn-reset", classifyCycleFailure("ECONNRESET while POST /cycle"), "conn");
eq("fail-class timeout", classifyCycleFailure("The operation was aborted due to timeout"), "timeout");
eq("fail-class http", classifyCycleFailure("HTTP 502 bad gateway"), "http");
eq("fail-class none", classifyCycleFailure(""), "none");
eq("fail-class unknown", classifyCycleFailure("weird thing"), "unknown");

/* cycle analytics: ok-rate + fail histogram from sovereign-events lines */
const evLines = [
  { kind: "cycle-ok(auto)", ms: 9800 },
  { kind: "cycle-error(auto)", ms: 12065, error: "fetch failed" },
  { kind: "cycle-ok(auto)", ms: 10098 },
  { kind: "cycle-fail(auto)", ms: 20000, error: "The operation was aborted due to timeout" },
  { kind: "heal-spawn", pid: 1 },           // non-cycle lines are ignored
  { kind: "cycle-ok(kick)", ms: 9000 },     // kick excluded — auto-window only
];
const cyc = analyzeCycles(evLines);
eq("cycles window", cyc.window, 4);
eq("cycles ok", cyc.oks, 2);
eq("cycles fail histogram", cyc.failReasons, { conn: 1, timeout: 1 });
eq("cycles okRate", cyc.okRate, 50);

/* lessons: evidence-based; empty history ⇒ zero invented lessons */
const lessons = deriveLessons({
  cycles: { window: 4, oks: 2, fails: 2, okRate: 50, failReasons: { conn: 2 }, msP50: 10000, msP90: 12000 },
  curator: { present: true, totalVotes: 10, window: 5, verdicts: { "DAY-CAP": 4 }, vpEff: 86, dayCapsInRow: 4, maxPerDay: 10 },
  exec: { window: 5, fails: 0, lastError: null },
});
ok("lesson conn-fail derived", lessons.some((l) => l.id === "cycle-conn-fails"));
ok("lesson daycap derived", lessons.some((l) => l.id === "curation-daycap-repeat"));
ok("lessons cite evidence", lessons.every((l) => typeof l.evidence === "string" && l.evidence.length > 10));
eq("no-invention empty", deriveLessons({ cycles: { window: 0, oks: 0, fails: 0, okRate: null, failReasons: {} }, curator: null, exec: { window: 0, fails: 0 } }).length, 0);

/* tunings: hard clamps — the learner cannot re-law itself */
const tuned = deriveTunings(lessons, { basePolicy: { baseWeightPct: 50, ageMinMinutes: 10, tags: ["steem"] }, discoveredTags: ["life", "photography"] });
ok("tuning baseWeight clamped", tuned.tunings.baseWeightPct >= LEARN_CLAMP.baseWeightPct[0] && tuned.tunings.baseWeightPct <= LEARN_CLAMP.baseWeightPct[1]);
ok("tuning evidence key present", tuned.applied.every((a) => a.because != null));
// crazy base policy (operator typo 500%) still clamps
const tunedCrazy = deriveTunings([{ id: "curation-daycap-repeat" }], { basePolicy: { baseWeightPct: 500, ageMinMinutes: 10, tags: [] }, discoveredTags: [] });
ok("tuning clamps wild input", tunedCrazy.tunings.baseWeightPct <= LEARN_CLAMP.baseWeightPct[1]);
// no-candidates lesson → ageMin may only DROP into [5,12], tags additive-only from discovery
const tunedNarrow = deriveTunings([{ id: "candidate-stream-narrow" }], { basePolicy: { baseWeightPct: 50, ageMinMinutes: 10, tags: ["a", "b", "c", "d", "e", "f", "g", "h"] }, discoveredTags: ["newtag"] });
ok("tuning ageMin bounded", tunedNarrow.tunings.ageMinMinutes === undefined || (tunedNarrow.tunings.ageMinMinutes >= 5 && tunedNarrow.tunings.ageMinMinutes <= 12));
ok("tuning tags capped at 8", tunedNarrow.tunings.tags === undefined || tunedNarrow.tunings.tags.length <= LEARN_CLAMP.tagsMax);
// zero lessons ⇒ zero tunings (nothing invented)
eq("tunings none without lessons", deriveTunings([], { basePolicy: { baseWeightPct: 50, ageMinMinutes: 10, tags: [] }, discoveredTags: ["x"] }).applied.length, 0);

/* curator analytics determinism + daycap streak */
const curAn = analyzeCurator({
  totalVotes: 12, vpEff: 85.5,
  voted: [{ ageMinutes: 31, tag: "steem" }, { ageMinutes: 45, tag: "crypto" }],
  history: [{ verdict: "VOTED" }, { verdict: "DAY-CAP" }, { verdict: "DAY-CAP" }],
});
eq("curator streak", curAn.dayCapsInRow, 2);
eq("curator meanAge", curAn.meanAgeMinutes, 38);

/* discovery: tag ranking deterministic with payout tiebreak */
const board1 = rankTags([
  { name: "beta", total_payouts: "120.500 SBD" },
  { name: "alpha", total_payouts: "120.500 SBD" },   // tie → name asc
  { name: "gamma", total_payouts: "930.250 SBD" },
  { name: "", total_payouts: "999 SBD" },            // empty tag dropped
]);
eq("tag board order", board1.map((t) => t.tag), ["gamma", "alpha", "beta"]);
eq("tag board parse", board1[0].payoutsSbd, 930.25);
ok("tag ranking deterministic", JSON.stringify(rankTags([{ name: "b", total_payouts: "2 SBD" }, { name: "a", total_payouts: "2 SBD" }])) === JSON.stringify(rankTags([{ name: "b", total_payouts: "2 SBD" }, { name: "a", total_payouts: "2 SBD" }])));

/* curation share estimator: honest ESTIMATED math + null-safety */
const est = curationShareEstimate({ rewardBalanceSteem: 9000, windowDays: 1 }, 0.00005);
eq("est math", est.estimatedSteemPerDay, Math.round((9000 * 0.00005) * 1e4) / 1e4);
ok("est labeled estimated", /ESTIMATED/.test(est.note));
eq("est null-safety", curationShareEstimate(null, 0.1), null);

/* opportunity scoring: measured > estimated > potential, all gated */
const ops = scoreOpportunities({
  tagBoard: [{ tag: "gamma", payoutsSbd: 930 }],
  depth: { ok: true, spreadBps: 19, bestAsk: 0.1033, bestBid: 0.1031 },
  vpEff: 85.5,
  curationEst: { dailyPoolSteem: 9000, voteVestsShare: 0.00005, estimatedSteemPerDay: 0.45, note: "ESTIMATED" },
  bookFills: { fills: 37, lastFillAt: new Date(Date.parse("2026-09-29T12:00:00Z")).toISOString() },
  soldiers: { deployed: true, accounts: [{ name: "hcsoldier1" }] },
});
ok("ops sorted by class", ops.findIndex((o) => o.id === "tags-realloc") < ops.findIndex((o) => o.id === "curation-share"));
ok("ops all carry class+gate", ops.every((o) => o.potentialClass && o.gate && o.evidence));
ok("wide-spread opportunity detected", scoreOpportunities({ tagBoard: [], depth: { ok: true, spreadBps: 400, bestAsk: 0.11, bestBid: 0.1 }, curationEst: null, bookFills: { fills: 0, lastFillAt: null }, soldiers: null }).some((o) => o.id === "spread-wide"));

console.log(`\nSELFTEST ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
