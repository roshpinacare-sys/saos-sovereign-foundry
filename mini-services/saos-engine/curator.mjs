/**
 * curator.mjs — the curation fuel rail (T-13): VP put to work, autonomously.
 *
 * WHY THIS RAIL: measured history shows curation paid the account's fuel
 * ($4.24/day measured window pre-2026-09-09); since then the rail sat DORMANT
 * while voting power refilled to ~99% every day — 4034 SP earning ZERO.
 * The operator ordered it implemented ("בוא ניישם אותו · קדימה ודחוף").
 *
 * HONESTY CONTRACT:
 *  - votes are judgment — so the judgment is a DETERMINISTIC, journaled
 *    policy (never hidden, never invented): fresh real content inside a
 *    tag whitelist, hard caps, VP floor, no self-votes, no bandwagon.
 *  - a vote op can NEVER move funds (posting authority only, no transfer
 *    capability) — this rail is the safest autonomous signing on the chain.
 *  - yield is not promised: curation_reward ops land in account history and
 *    the existing fuel measurement (measureAll) picks them up — measured,
 *    not claimed.
 *
 * DOCTRINE GATES (all enforced, fail-closed):
 *  - armed-conf `curate` block (signer.mjs shallow-merge: file wins over defaults)
 *  - operator kill-switch (exec-pause.json) + standing order
 *  - daily cap maxPerDay, per-author diversity cap, VP effective floor
 *  - age window (early votes earn the bigger curation share), bandwagon cap,
 *    minimum body length (anti-spam), blacklist (our own fleet)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, execPaused } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const CUR_FILE = path.join(STATE, "curator.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export function curatorPolicy() {
  return {
    enabled: true,
    maxPerDay: 10,           // votes/day — well inside 20%/day VP regen
    baseWeightPct: 50,       // a fresh post gets 50%
    minWeightPct: 20,        // weight decays linearly toward this at ageMax
    minVpEffPct: 60,         // effective mana floor — never drain the battery
    maxPerAuthorPerDay: 1,   // diversity: one vote per author per day
    ageMinMinutes: 10,       // too fresh = possibly unfinished spam
    ageMaxMinutes: 1200,     // 20h — beyond that the curation share is dust
    minBodyChars: 600,       // real content, not micro-dust
    maxPendingSbd: 30,       // bandwagon guard — late votes on hot posts earn little
    tags: ["steem", "crypto", "defi", "trading", "technology", "ai"],
    excludeAccounts: ["headcorner", "hcsoldier1", "hcsoldier2", "hcsoldier3"],
  };
}

export const dayKeyOf = (iso) => String(iso ?? new Date().toISOString()).slice(0, 10);

/* weight decays linearly: baseWeight at ageMin → minWeight at ageMax */
export function weightForAge(ageMinutes, p) {
  const clamped = Math.min(Math.max(ageMinutes, p.ageMinMinutes), p.ageMaxMinutes);
  const t = (clamped - p.ageMinMinutes) / Math.max(1, p.ageMaxMinutes - p.ageMinMinutes);
  const pct = p.baseWeightPct - t * (p.baseWeightPct - p.minWeightPct);
  return Math.round(pct * 100); // steem weight units (10000 = 100%)
}

/* effective voting power from the manabar (mana units: vests × 1e6) */
export function vpEffPct(currentMana, vests) {
  if (!(vests > 0) || !(currentMana >= 0)) return null;
  const max = vests * 1e6;
  return Math.round((currentMana / max) * 1000) / 10;
}

/* THE PURE PLANNER — deterministic, selftestable, zero network.
 * posts: normalized candidates; returns selected votes + honest rejections. */
export function filterCandidates({ posts, voter, policy, nowMs, votedPermlinks = [], votesToday = 0, authorsToday = {} }) {
  const p = policy;
  const rejected = [];
  const seenPermlinks = new Set();
  const votedSet = new Set(votedPermlinks);
  const authors = { ...authorsToday };
  let remaining = Math.max(0, p.maxPerDay - votesToday);

  // deterministic order: newest first, permlink as tiebreak
  const ordered = [...posts].sort((a, b) =>
    (b.createdMs - a.createdMs) || String(a.permlink).localeCompare(String(b.permlink)));

  const selected = [];
  for (const post of ordered) {
    const key = `${post.author}/${post.permlink}`;
    const dupList = seenPermlinks.has(key);
    if (!dupList) seenPermlinks.add(key);
    const reject = (reason) => { if (!dupList) rejected.push({ key, reason }); };

    if (dupList) { continue; } // dedup silently (same post via two tags)
    if (p.excludeAccounts.includes(post.author)) { reject("self-fleet"); continue; }
    if (post.votedByUs || votedSet.has(key)) { reject("already-voted"); continue; }
    const ageMin = (nowMs - post.createdMs) / 60000;
    if (!(ageMin >= p.ageMinMinutes)) { reject("too-young"); continue; }
    if (ageMin > p.ageMaxMinutes) { reject("too-old"); continue; }
    if ((post.bodyLen ?? 0) < p.minBodyChars) { reject("short-body"); continue; }
    if (!post.title || post.title === post.title.toUpperCase() && post.title.length > 8) { reject("spam-title"); continue; }
    if ((post.pendingSbd ?? 0) > p.maxPendingSbd) { reject("bandwagon"); continue; }
    if (post.archived === true) { reject("payout-closed"); continue; }
    if ((authors[post.author] ?? 0) >= p.maxPerAuthorPerDay) { reject("author-cap"); continue; }
    if (remaining <= 0) { reject("day-cap"); continue; }

    selected.push({
      author: post.author, permlink: post.permlink,
      weight: weightForAge(ageMin, p), ageMinutes: Math.round(ageMin), tag: post.tag ?? null,
    });
    authors[post.author] = (authors[post.author] ?? 0) + 1;
    remaining -= 1;
  }
  return { selected, rejected, dayCapReached: remaining <= 0 };
}

/* normalize a raw condenser discussion → candidate (pure).
 * votedByUs comes from the ON-CHAIN active_votes (the chain is the dedup
 * source of truth — our state only covers today; the account voted posts
 * days ago that must never be re-voted: a second vote would just waste VP). */
export function normalizePost(raw, tag, voter, nowMs) {
  if (!raw?.author || !raw?.permlink) return null;
  const createdMs = raw.created ? Date.parse(raw.created.endsWith("Z") ? raw.created : raw.created + "Z") : 0;
  if (!(createdMs > 0)) return null;
  const num = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;
  return {
    author: raw.author, permlink: raw.permlink, tag: tag ?? null,
    createdMs, title: String(raw.title ?? ""),
    bodyLen: String(raw.body ?? "").length,
    pendingSbd: num(raw.pending_payout_value),
    archived: raw.cashout_time === "1969-12-31T23:59:59" || raw.cashout_time === "1970-01-01T00:00:00",
    votedByUs: (raw.active_votes ?? []).some((v) => v?.voter === voter),
  };
}

/* fetch fresh candidate stream across the tag whitelist (fail-closed) */
async function fetchCandidates(policy, voter, nowMs) {
  const posts = [];
  let nodeOk = false;
  for (const tag of policy.tags) {
    const r = await rpcCall("condenser_api.get_discussions_by_created", [{ tag, limit: 20 }]);
    if (!r.ok) continue;
    nodeOk = true;
    for (const raw of (r.result ?? [])) {
      const n = normalizePost(raw, tag, voter, nowMs);
      if (n) posts.push(n);
    }
  }
  return { posts, ok: nodeOk };
}

export function curatorState() { return readJson(CUR_FILE, null); }

/* ── THE EXECUTOR: plan → gates → broadcast (posting key, atomic tx) ───── */
export async function runCurator({ now = new Date().toISOString() } = {}) {
  const conf = armedConf();
  const p = { ...curatorPolicy(), ...(conf.curate ?? {}) };
  const master = masterAccount();
  const day = dayKeyOf(now);
  const nowMs = Date.parse(now);

  const prev = readJson(CUR_FILE, { day: null, votesToday: [], authorsToday: {}, totalVotes: 0, history: [] });
  const carried = prev.day === day ? prev : { votesToday: [], authorsToday: {}, totalVotes: prev.totalVotes ?? 0, history: prev.history ?? [] };

  const base = {
    enabled: p.enabled, at: now, day,
    votesTodayCount: carried.votesToday.length,
    maxPerDay: p.maxPerDay,
  };
  if (!p.enabled) return { ...base, verdict: "DISABLED" };
  if (execPaused()) return { ...base, verdict: "OPERATOR-PAUSED" };
  if (carried.votesToday.length >= p.maxPerDay) return { ...base, verdict: "DAY-CAP", dayCapReached: true };

  /* VP gate — effective mana (read-only, chain truth) */
  const accR = await rpcCall("condenser_api.get_accounts", [[master]]);
  const acc = accR.ok ? accR.result?.[0] : null;
  if (!acc) return { ...base, verdict: "NO-ACCOUNT-READ" };
  const vests = Number(String(acc.vesting_shares ?? "0").split(" ")[0]) || 0;
  const mana = Number(acc.voting_manabar?.current_mana ?? "0");
  const vpEff = vpEffPct(mana, vests);
  if (vpEff == null || vpEff < p.minVpEffPct) {
    const out = { ...base, verdict: "VP-FLOOR", vpEff, minVpEffPct: p.minVpEffPct };
    writeJson(CUR_FILE, { ...out, votesToday: carried.votesToday, authorsToday: carried.authorsToday, totalVotes: carried.totalVotes, history: carried.history });
    return out;
  }

  /* candidates → planner */
  const { posts, ok: streamOk } = await fetchCandidates(p, master, nowMs);
  if (!streamOk) return { ...base, verdict: "NO-CANDIDATE-STREAM", vpEff };
  const votedPermlinks = carried.votesToday.map((v) => `${v.author}/${v.permlink}`);
  const plan = filterCandidates({
    posts, voter: master, policy: p, nowMs,
    votedPermlinks, votesToday: carried.votesToday.length, authorsToday: carried.authorsToday,
  });
  // (votedPermlinks covers today; votedByUs covers all history — both enforced)
  if (!plan.selected.length) {
    const out = {
      ...base, verdict: "NO-CANDIDATES", vpEff,
      rejectedTop: plan.rejected.slice(0, 8).map((r) => `${r.key}:${r.reason}`),
      candidatesScanned: posts.length,
    };
    writeJson(CUR_FILE, { ...out, votesToday: carried.votesToday, authorsToday: carried.authorsToday, totalVotes: carried.totalVotes, history: carried.history });
    return out;
  }

  /* broadcast — ONE vote per tx, ≥3.2s apart.
   * CHAIN-TRUTH LAW (measured live 2026-09-29): STEEM_MIN_VOTE_INTERVAL_SEC=3
   * — two votes by the same voter inside one tx/land in one block ⇒ atomic
   * assert failure for the WHOLE tx. So: one vote per broadcast, spaced,
   * fail-closed (first failure stops the run — never burn RC on a dead node). */
  const results = [];
  let lastAt = 0;
  for (const v of plan.selected) {
    const waitMs = lastAt ? 3200 - (Date.now() - lastAt) : 0;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    const res = await executeAs(master, [[
      "vote", { voter: master, author: v.author, permlink: v.permlink, weight: v.weight },
    ]], { tag: "curate", role: "posting" });
    lastAt = Date.now();
    results.push({ ...v, ok: !!res.ok, txid: res.txid ?? null, error: res.error ?? null });
    if (!res.ok) break;
  }
  const okVotes = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const verdict = okVotes.length ? (failed.length ? "PARTIAL" : "VOTED") : "BROADCAST-FAIL";

  const out = {
    ...base, verdict,
    txid: okVotes[0]?.txid ?? results[0]?.txid ?? null,
    error: failed[0]?.error ?? null, vpEff,
    voted: okVotes, failedVotes: failed,
    rejectedTop: plan.rejected.slice(0, 8).map((r) => `${r.key}:${r.reason}`),
    candidatesScanned: posts.length,
  };
  const votesToday = [
    ...carried.votesToday,
    ...okVotes.map((v) => ({ author: v.author, permlink: v.permlink, weight: v.weight, at: now, txid: v.txid })),
  ];
  const authorsToday = { ...carried.authorsToday };
  for (const v of okVotes) authorsToday[v.author] = (authorsToday[v.author] ?? 0) + 1;
  writeJson(CUR_FILE, {
    ...out, votesToday, authorsToday,
    totalVotes: carried.totalVotes + okVotes.length,
    history: [...carried.history, { at: now, day, verdict, n: okVotes.length, txid: out.txid }].slice(-30),
  });
  appendLine(path.join(STATE, "events.jsonl"), {
    type: "curate.done", at: now, verdict, votes: okVotes.length,
    txid: out.txid, vpEff,
  });
  return out;
}

/* CLI standalone: bun curator.mjs — one gated curation pass, same doctrine */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCurator().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error("CURATE-FAIL", e); process.exit(1); });
}
