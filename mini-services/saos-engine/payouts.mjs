/**
 * payouts.mjs — T-23 · צוות-הפאייאוטים (המכשיר שהופך "מוערך" ל"מדוד").
 * The operator's directive: the simulated economic array must become real
 * value step by step. The curation rail's ESTIMATED $/day becomes MEASURED
 * the moment the chain pays out — this module is the instrument that sees it
 * first: pending reward balances (chain truth), the payout CLOCK (T-18c),
 * the settled reward-history rollup, and the VP equilibrium probe (T-18e).
 * Read-only — runs WITH or WITHOUT a credential. state/payouts.json is the
 * evidence file the cockpit and the economics rollup render.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { payoutWindow, rewardHistoryRollup, vpNow, opTypeName } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "payouts.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

export function payoutsState() { return readJson(FILE, null); }

const num = (s) => { const n = Number(String(s ?? "0").split(" ")[0]); return Number.isFinite(n) ? n : 0; };

/* reward ops scan: history filtered to the reward lane. Nodes differ —
 * ah_api with select_ops first (DEFENSIVE FILTER: some nodes ignore
 * select_ops and return all ops — proven live), condenser fallback (bounded).
 * Junk → []. */
const isRewardOp = (t) => t === "curation_reward" || t === "author_reward" || t === "claim_reward_balance";
/* SCAN LIMIT LAW (measured live): this account churns ~10k ops in ~25 days of
 * trading — a 2000-op window misses today's votes entirely. 10000 reaches
 * back ~3.5 weeks; nodes that ignore select_ops return mixed rows, so the
 * DEFENSIVE FILTER below is the real gate, and opTypeName handles BOTH
 * shapes ("vote_operation" vs bare "vote") — the false-zero bug class. */
const SCAN_LIMIT = 10000;
async function rewardOps(account) {
  let r = await rpcCall("account_history_api.get_account_history", {
    account, start: -1, limit: SCAN_LIMIT,
    select_ops: ["curation_reward", "author_reward", "claim_reward_balance"],
  }).catch(() => ({ ok: false }));
  if (r.ok) return { rows: (r.result?.history ?? []).filter(([, e]) => isRewardOp(opTypeName(e?.op))), api: "ah_api", node: r.node };
  r = await rpcCall("condenser_api.get_account_history", [account, -1, 1000]).catch(() => ({ ok: false }));
  if (r.ok) return { rows: (r.result ?? []).filter(([, e]) => isRewardOp(opTypeName(e?.op))), api: "condenser", node: r.node };
  return { rows: [], api: null, node: null };
}

const tsOf = (e) => {
  const ts = Date.parse(String(e?.timestamp ?? "").includes("T") ? e.timestamp : `${e?.timestamp ?? ""}Z`);
  return Number.isFinite(ts) ? ts : null;
};

/* vote ops scan (chain truth for the payout clock) */
async function voteOps(account) {
  let r = await rpcCall("account_history_api.get_account_history", {
    account, start: -1, limit: SCAN_LIMIT, select_ops: ["vote"],
  }).catch(() => ({ ok: false }));
  if (!r.ok) {
    r = await rpcCall("condenser_api.get_account_history", [account, -1, 1000]).catch(() => ({ ok: false }));
    if (r.ok) return { rows: (r.result ?? []).filter(([, e]) => opTypeName(e?.op) === "vote"), api: "condenser" };
    return { rows: [], api: null };
  }
  return { rows: (r.result?.history ?? []).filter(([, e]) => opTypeName(e?.op) === "vote"), api: "ah_api" };
}

export async function runPayouts({ now = new Date().toISOString(), account } = {}) {
  const acc = account || process.env.SAOS_ACCOUNT || "headcorner";
  const day = now.slice(0, 10);
  const [a, dyn, rew, votes] = await Promise.all([
    rpcCall("condenser_api.get_accounts", [[acc]]),
    rpcCall("condenser_api.get_dynamic_global_properties", []),
    rewardOps(acc),
    voteOps(acc),
  ]);
  const row = a.ok ? a.result?.[0] : null;
  if (!row) {
    const out = { day, at: now, account: acc, verdict: "READ-FAILED", pending: null, vp: null, payout: null, rollup: null };
    writeJson(FILE, out);
    return out;
  }
  const tvs = dyn.ok ? num(dyn.result?.total_vesting_shares) : null;
  const tvf = dyn.ok ? num(dyn.result?.total_vesting_fund_steem) : null;
  const vestsToSteem = tvs > 0 && tvf > 0 ? tvf / tvs : null; // VESTS → STEEM conversion (chain truth)
  const pending = {
    steem: num(row.reward_steem_balance),
    sbd: num(row.reward_sbd_balance),
    vests: num(row.reward_vesting_balance),
    any: num(row.reward_steem_balance) + num(row.reward_sbd_balance) + num(row.reward_vesting_balance) > 0,
  };
  const vm = row.voting_manabar ?? {};
  /* VP MAX LAW (measured live 2026-10-02): condenser omits max_mana here —
   * max = vests in satoshis (×1e6). Measured: 4.538e12 / 7.124e12 = 63.7% VP,
   * consistent with the overnight vote+regen curve. max_mana used when the
   * node supplies it. */
  const vestsSat = num(row.vesting_shares) * 1e6;
  const vp = vpNow({ currentMana: parseInt(vm.current_mana ?? "0", 10), maxMana: parseInt(vm.max_mana ?? "0", 10) || vestsSat, vests: row.vesting_shares, now });

  /* the payout clock — the HONEST anchor: the oldest UNPAID tranche. A vote
   * pays exactly 7d after it is cast, so any vote older than 7d already
   * paid; the next real money moment = min(voteTs) + 7d over votes inside
   * the unpaid window. Votes from a previous era (measured live: the scan
   * window reaches back past the machine's first doctrine vote) pay nothing
   * new — anchoring to them would show a clock stuck at paid-window. */
  let firstVoteDay = null;
  let unpaidTranches = 0;
  let oldestUnpaidTs = null;
  const unpaidCutoff = Date.parse(now) - 7 * 86400_000;
  for (const [, e] of votes.rows) {
    const ts = tsOf(e);
    if (ts == null) continue;
    const d = new Date(ts).toISOString().slice(0, 10);
    if (firstVoteDay == null || d < firstVoteDay) firstVoteDay = d;
    if (ts >= unpaidCutoff) {
      unpaidTranches++;
      if (oldestUnpaidTs == null || ts < oldestUnpaidTs) oldestUnpaidTs = ts;
    }
  }
  const unpaidVoteDay = oldestUnpaidTs != null ? new Date(oldestUnpaidTs).toISOString().slice(0, 10) : null;
  const payout = unpaidVoteDay ? payoutWindow({ firstVoteDay: unpaidVoteDay, now }) : null;

  const rollup = rewardHistoryRollup({
    rows: rew.rows,
    steemUsd: null, // priced by the economics rollup, not here — single-pricer law
    sbdUsd: null,
    vestsToSteem,
  });

  const anyPendingUsd = pending.any; // pricing happens in the economics rollup
  const out = {
    day, at: now, account: acc,
    verdict: anyPendingUsd ? "MEASURED-PENDING" : unpaidTranches > 0 ? "MEASURED" : "READ-OK-NO-UNPAID-VOTES",
    pending,
    vp,
    payout,
    rollup,
    scan: { rewardOps: rew.rows.length, rewardApi: rew.api, voteOps: votes.rows.length, votesScanned: votes.rows.length, firstVoteDay, unpaidTranches, unpaidCutoff: new Date(unpaidCutoff).toISOString(), node: a.node ?? rew.node ?? null },
    law: "מסילת-הקיורציה נשארת מוערכת עד-שהשרשרת משלמת — השעון עוקב אחרי הטרנס-הבלתי-משולם-הבא, לא אחרי הצבעות-עבר שכבר התיישבו",
    history: [], // filled below
  };
  const prev = readJson(FILE, null);
  if (prev?.day && prev.day !== day && prev.payout) out.history = [{ day: prev.day, pendingVests: prev.pending?.vests ?? null, phase: prev.payout.phase }, ...(prev.history ?? [])].slice(0, 30);
  else out.history = prev?.history ?? [];
  writeJson(FILE, out);
  return out;
}

/* recruiter evidence: fresh measurement (<26h) with a live payout clock */
export function payoutsEvidence(nowMs = Date.now()) {
  const p = readJson(FILE, null);
  if (!p || p.verdict === "READ-FAILED") return null;
  const at = p.at ? Date.parse(p.at) : NaN;
  if (!Number.isFinite(at) || nowMs - at > 26 * 3600_000) return null;
  const days = p.payout?.daysRemaining;
  return `state/payouts.json: ${p.verdict} at ${p.at} — pending(vests ${p.pending?.vests ?? 0}), payout clock ${days != null ? `${days}d remaining` : "n/a"} — המכשיר-להפיכת-הקיורציה-למדוד חי`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPayouts({ now: new Date().toISOString() }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("PAYOUTS-FAIL", e); process.exit(1); });
}
