/**
 * lib.mjs — the pure deterministic core of the LOCAL sovereign engine.
 * ====================================================================
 * T-9 (2026-09-29): the 16-repo estate was lost from local disk (environment
 * reset) and filebin is empty. Per operator law ("אפשר למצוא פתרון גם מהקיים")
 * the engine now lives INSIDE the cockpit project — zero dependency on
 * /home/z/audit, GitHub, or any external repo.
 *
 * Pure functions only here (no IO, no clock, no network) — injected
 * everything, so selftest vectors are deterministic offline.
 *
 * Doctrine carried over from the fleet rounds (worklog T-1..T-8):
 *   D-021 dual-mover lanes · D-022 per-side additive · D-023 convert-first
 *   r134-VF1 value-floor law (never sell below external value)
 *   A-10 honest P&L (sells without measured basis = unbased, never profit)
 *   price-truth-or-nothing (parity band 5000bps refuse)
 *
 * NEW adoptions (T-9, see docs/ADOPTIONS.md):
 *   Hummingbot inventory-skew   → ladder shape biased by inventory ratio
 *   MakerDAO PSM hysteresis     → convert gate enter/exit bands
 *   Curve dynamic concentration → dragK spread-responsive ladder tightening
 */

export const MIN_LEVEL = 0.5;          // SBD/STEEM dust-break per level (mission gate)
export const LEVELS = 5;               // per side (5 asks + 5 bids)
export const ASK_FLOOR_BPS = 20;       // r134-VF1: asks re-placed at floor+20bps
export const PARITY_BAND_BPS = 5000;   // price-truth-or-nothing refuse band
export const NOISE_BPS = 10;           // stale classification tolerance
export const DRAG_DIVISOR = 2000;      // dragK = clamp(1+spreadBps/2000, 1, 3)
export const CONVERT_MIN_SBD = 1;      // D-023 arm threshold (dust guard)
export const CONVERT_RESERVE_SBD = 0.5;// bid-reserve kept out of convert
export const CONVERT_PENDING_CAP = 10; // max SBD pending 3.5d window
export const BID_RESERVE_SBD = 0.5;    // SBD kept for bid side

const r6 = (v) => Math.round(v * 1e6) / 1e6;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── Curve-adoption: dynamic drag (T-3 B-3, carried) ───────────────────────
 * wider internal-vs-external spread ⇒ tighter multi-level concentration. */
export function dragK(spreadBps) {
  return clamp(1 + spreadBps / DRAG_DIVISOR, 1, 3);
}

/* ── Hummingbot-adoption: inventory skew ───────────────────────────────────
 * skew ∈ [-0.3, +0.3]; inventoryRich(steem) ⇒ bigger asks / smaller bids
 * so the book pushes inventory back toward target balance. Deterministic. */
export function inventorySkew(steemLiquid, sbdLiquid, parity) {
  if (!(parity > 0) || steemLiquid < 0 || sbdLiquid < 0) return { skew: 0, askMult: 1, bidMult: 1, reason: "invalid-inputs" };
  const target = (steemLiquid + sbdLiquid / parity) / 2; // 50/50 baseline in STEEM units
  if (target <= 1e-9) return { skew: 0, askMult: 1, bidMult: 1, reason: "no-inventory" };
  const raw = (steemLiquid - target) / target;           // relative excess STEEM
  const skew = r6(clamp(raw * 0.3, -0.3, 0.3));
  return { skew, askMult: r6(1 + skew), bidMult: r6(1 - skew), reason: "hummingbot-inventory-skew" };
}

/* ── parity gate (price-truth-or-nothing) ────────────────────────────────── */
export function parityVerdict(externalParity, internalFeed) {
  if (!(externalParity > 0)) return { ok: false, reason: "no-external-parity" };
  if (!(internalFeed > 0)) return { ok: false, reason: "no-internal-feed" };
  const bps = Math.round(((externalParity - internalFeed) / internalFeed) * 10000);
  if (Math.abs(bps) > PARITY_BAND_BPS) return { ok: false, reason: "parity-band-refuse", bps };
  return { ok: true, reason: "band-ok", bps };
}

/* ── peg ladder planner (B-1/B-3 + T-9 adoptions + T-19 dual-tranche) ───────
 * Law: every ask ≥ floor (parity*(1+ASK_FLOOR_BPS)), every bid ≤ ceiling
 * (parity−20bps); budgets assigned level-by-level clamped to remaining
 * (sum ≤ budget BY CONSTRUCTION — the T-5 rounding-blocker lesson).
 *
 * T-19 DUAL-TRANCHE (measured live 2026-09-30): the VF1 floor FLOATS with
 * its parity SOURCE — coingecko said 0.1083 while the live book traded at
 * 0.1042 (4% apart) and the witness feed said 0.1041; an hour earlier the
 * floor sat at 0.1043. A floor anchored to a GHOST external quote (SBD is
 * delisted from binance/poloniex/upbit/mexc — measured) made our asks
 * untradeable BY LAW: 43 fills in 7.35 days while 49 trades/day flowed
 * past us. The operator ordered real productivity (thousands of ops, real
 * flow capture). Fix WITHOUT touching the law's intent: the bulk (80%) keeps
 * the value floor; a bounded FLOW TRANCHE (20%) quotes AT the live book
 * front, never below the WITNESS FEED (the chain's own value anchor — the
 * only live SBD↔STEEM market that exists) and never above the bid ceiling.
 * Doctrine is operator-overridable via armed-conf as always. */
export function planLadder({
  parity, askBudgetSteem, bidBudgetSbd,
  spreadBps = 0, skew = { askMult: 1, bidMult: 1 },
  levels = LEVELS, minLevel = MIN_LEVEL, now = "1970-01-01T00:00:00Z",
  bestBid = null, bestAsk = null, feedAnchor = null,
  flowTranchePct = 0.2, flowSpacingBps = 15, flowLevels = 4,
  flowAskBudgetSteem = null, flowBidBudgetSbd = null,
}) {
  if (!(parity > 0)) return { verdict: "NO-PARITY", asks: [], bids: [], blocker: ["no-external-parity"] };
  const k = dragK(spreadBps);
  const step = 1 + 0.001 * k;                        // per-level spacing
  const floorRaw = parity * (1 + ASK_FLOOR_BPS / 10000);
  const ceilRaw = parity * (1 - ASK_FLOOR_BPS / 10000); // bids never above parity−20bps
  // T-9 fix (same family as the T-5 rounding blocker): 6dp rounding must
  // NEVER push an ask below floor or a bid above ceiling — round asks UP,
  // bids DOWN, and law-check with ε tolerance.
  const r6u = (v) => Math.ceil(v * 1e6) / 1e6;
  const r6d = (v) => Math.floor(v * 1e6) / 1e6;
  const floor = r6u(floorRaw);
  const ceil = r6d(ceilRaw);
  const block = [];

  /* flow tranche active only with a live book; the value tranche keeps the
   * remaining budget — every law below is self-checked with ε.
   * T-19 REQUOTE LAW (measured live 18:34): the 60% liquidity law correctly
   * zeroes NEW deployment when the book is fully spread — but the flow
   * tranche is a REQUOTE layer: it replaces its own previous levels (cancel
   * + re-create at the NEW front), so its budget is the fixed tranche the
   * operator's doctrine reserves (0.12×inventory), not the residual. When
   * an explicit flow budget arrives, the value budget is NOT shrunk. */
  const flowOk = Number(bestAsk) > 0 && Number(bestBid) > 0 && flowLevels > 0 && (flowTranchePct > 0 || flowAskBudgetSteem > 0 || flowBidBudgetSbd > 0);
  const flowHasOwnBudget = flowAskBudgetSteem != null || flowBidBudgetSbd != null;
  const valAskBudget = (flowOk && !flowHasOwnBudget) ? askBudgetSteem * (1 - flowTranchePct) : askBudgetSteem;
  const valBidBudget = (flowOk && !flowHasOwnBudget) ? bidBudgetSbd * (1 - flowTranchePct) : bidBudgetSbd;

  const asks = [];
  let remA = r6(valAskBudget);
  let lvlA = floor;
  for (let i = 0; i < levels; i++) {
    if (remA < minLevel) break;
    const want = r6(Math.max(minLevel, (valAskBudget / levels) * skew.askMult));
    const amt = r6(Math.min(remA, want));
    if (amt < minLevel) break;
    asks.push({ side: "ask", amountSteem: amt, unit: r6u(lvlA), at: now, tranche: "value" });
    remA = r6(remA - amt);
    lvlA = lvlA * step;
  }
  if (remA > 0 && asks.length === 0) block.push("ask-budget-below-min-level");

  const bids = [];
  let remB = r6(valBidBudget);
  let lvlB = ceil;
  for (let i = 0; i < levels; i++) {
    if (remB < minLevel) break;
    const want = r6(Math.max(minLevel, (valBidBudget / levels) * skew.bidMult));
    const amt = r6(Math.min(remB, want));
    if (amt < minLevel) break;
    bids.push({ side: "bid", amountSbd: amt, unit: r6d(lvlB), at: now, tranche: "value" });
    remB = r6(remB - amt);
    lvlB = lvlB / step;
  }
  if (remB > 0 && bids.length === 0) block.push("bid-budget-below-min-level");

  /* ── T-19 flow tranche: AT-the-front presence, chain-anchored honesty ── */
  const flowAsks = [], flowBids = [];
  let flow = null;
  if (flowOk) {
    const sp = Math.max(1, flowSpacingBps) / 10000;
    const faBudget = r6(Math.max(0, flowAskBudgetSteem != null ? Number(flowAskBudgetSteem) : askBudgetSteem - valAskBudget));
    const fbBudget = r6(Math.max(0, flowBidBudgetSbd != null ? Number(flowBidBudgetSbd) : bidBudgetSbd - valBidBudget));
    /* T-19 ACHIEVABLE-PRICE LAW (measured live on-chain): the chain keeps SBD
     * and STEEM amounts at 3dp — a plan unit of 0.104244 on 8.245 STEEM
     * broadcasts as 0.860/8.245 = real 0.1043065 (12bps AWAY from plan,
     * behind the level we meant to lead). Flow levels therefore carry their
     * EXACT broadcast amounts: sbdOut3 (3dp SBD out) is computed from the
     * 3dp sell amount, unit = sbdOut3/sellAmt3 — the execute step sends
     * sbdOut3 VERBATIM, so the book shows precisely what was planned.
     * Anchor/ceiling laws are enforced on the BROADCAST arithmetic: the
     * anchor-clamped level ceil3's its SBD out (≥ anchor guaranteed), bids
     * floor3 their STEEM out only above a ceil3'd ceiling guard. */
    const sellAmt3 = (amt) => Number(amt.toFixed(3));
    const floor3 = (v) => Math.floor(v * 1000) / 1000;
    const ceil3 = (v) => Math.ceil(v * 1000) / 1000;
    /* ask front: penetrate to bestAsk (or the chain anchor when the book
     * trades below it). CEIL3 law: the 3dp SBD out always rounds UP to the
     * target — the real price lands within ONE milli above bestAsk (never
     * behind it, never below the anchor, never crossing the best bid). */
    let fa = Math.max(Number(bestAsk), feedAnchor > 0 ? Number(feedAnchor) : 0);
    let faRem = faBudget;
    let lastFaUnit = 0;
    for (let i = 0; i < flowLevels * 3 && flowAsks.length < flowLevels; i++) {
      /* DEDUP LAW (measured by selftest): ceil3 can merge adjacent targets
       * into the SAME milli (3bps spacing vs 20bps granularity at 5 STEEM) —
       * duplicate-price levels waste an op; advance the target until the
       * achievable price actually moves. */
      if (faRem < minLevel) break;
      const amt = r6(Math.min(faRem, Math.max(minLevel, faBudget / flowLevels)));
      if (amt < minLevel) break;
      const sell = sellAmt3(amt);
      const sbdOut3 = Math.max(ceil3(sell * fa), feedAnchor > 0 ? ceil3(sell * Number(feedAnchor)) : 0);
      const unit = sbdOut3 > 0 ? sbdOut3 / sell : fa;
      if (unit <= lastFaUnit) { fa = fa * (1 + sp); continue; }
      flowAsks.push({ side: "ask", amountSteem: amt, unit: r6u(unit), sbdOut3, at: now, tranche: "flow" });
      lastFaUnit = unit;
      faRem = r6(faRem - amt);
      fa = fa * (1 + sp);
    }
    /* bid front: join the best bid, step DOWN (never pay above the ceiling);
     * STEEM out = floor3 at the target (the honest join), with a ceil3'd
     * ceiling guard so the broadcast price can never breach the ceiling */
    let fb = Math.min(Number(bestBid), ceil);
    let fbRem = fbBudget;
    let lastFbUnit = Infinity;
    for (let i = 0; i < flowLevels * 3 && flowBids.length < flowLevels; i++) {
      if (fbRem < minLevel) break;
      const amt = r6(Math.min(fbRem, Math.max(minLevel, fbBudget / flowLevels)));
      if (amt < minLevel) break;
      const sell = sellAmt3(amt);
      const steemOut3 = Math.max(floor3(sell / fb), ceil3(sell / ceil));
      const unit = steemOut3 > 0 ? sell / steemOut3 : fb;
      if (unit >= lastFbUnit) { fb = fb / (1 + sp); continue; }
      flowBids.push({ side: "bid", amountSbd: amt, unit: r6d(unit), steemOut3, at: now, tranche: "flow" });
      lastFbUnit = unit;
      fbRem = r6(fbRem - amt);
      fb = fb / (1 + sp);
    }
    /* flow laws: never below the chain anchor, never above the ceiling,
     * and the two flow sides must never cross each other */
    if (feedAnchor > 0) for (const a of flowAsks) if (a.unit < feedAnchor - 1e-9) block.push("FLOW-ask-below-feed-anchor");
    for (const b of flowBids) if (b.unit > ceil + 1e-9) block.push("FLOW-bid-above-ceiling");
    if (flowAsks.length && flowBids.length && flowAsks[0].unit <= flowBids[0].unit) block.push("FLOW-self-cross");
    flow = { bestAsk: r6(Number(bestAsk)), bestBid: r6(Number(bestBid)), spacingBps: Math.max(1, flowSpacingBps), levels: flowLevels, askBudgetSteem: faBudget, bidBudgetSbd: fbBudget, feedAnchor: feedAnchor > 0 ? r6(Number(feedAnchor)) : null, flowAsks: flowAsks.length, flowBids: flowBids.length };
  }

  // law self-check: never violate floor/ceiling regardless of inputs (ε=1e-9)
  for (const a of asks) if (a.unit < floor - 1e-9) block.push("VF1-ask-below-floor");
  for (const b of bids) if (b.unit > ceil + 1e-9) block.push("VF1-bid-above-ceiling");

  const verdict = asks.length + bids.length + flowAsks.length + flowBids.length === 0
    ? "OFFER-EMPTY"
    : block.length ? "OFFER-BLOCKED" : "OFFER-READY";
  return { verdict, asks, bids, flowAsks, flowBids, flow, blocker: block.length ? block : null, dragK: k, floor, ceiling: ceil };
}

/* ── D-023 convert planner with MakerDAO-PSM hysteresis (T-9 adoption) ─────
 * Enter when SBD face-value edge ≥ enterBps AND liquid ≥ min; stay armed
 * (hysteresis) until edge < exitBps (< enter) — prevents flapping. */
export function planConvert({
  liquidSbd, parity, marketSbdUsd,
  enterBps = 3000, exitBps = 2000, previouslyArmed = false,
  pendingSbd = 0, minSbd = CONVERT_MIN_SBD,
  reserveSbd = CONVERT_RESERVE_SBD, pendingCap = CONVERT_PENDING_CAP,
}) {
  if (!(marketSbdUsd > 0)) return { verdict: "CONVERT-HOLD", reason: "no-market-price", amountSbd: 0 };
  // converting 1 SBD yields face-$1 of STEEM at the 3.5d window; selling on
  // book yields marketSbdUsd now. Edge = face over market, in bps.
  const edgeBps = Math.round(((1 - marketSbdUsd) / marketSbdUsd) * 10000);
  const armed = previouslyArmed ? edgeBps >= exitBps : edgeBps >= enterBps;
  if (!armed) return { verdict: "CONVERT-HOLD", reason: previouslyArmed ? "hysteresis-exit" : "below-enter-band", edgeBps, amountSbd: 0 };
  const budget = r6(Math.min(
    Math.max(0, liquidSbd - reserveSbd),
    Math.max(0, pendingCap - pendingSbd)
  ));
  if (budget < minSbd) return { verdict: "CONVERT-HOLD", reason: "dust-or-capped", edgeBps, amountSbd: 0 };
  const expectedSteem = r6(budget * 1 / parity); // face-$1 ⇒ $1 of STEEM at parity
  return { verdict: "CONVERT-PLAN", reason: "psm-hysteresis-armed", edgeBps, amountSbd: budget, expectedSteem, windowDays: 3.5 };
}

/* ── stale classification (T-8b, lane-scoped per D-021) ────────────────────
 * An open order is stale when its unit drifted beyond NOISE_BPS from the
 * lawful bound for its side (asks below floor / bids above ceiling). */
export function classifyStale(orders, parity) {
  if (!(parity > 0)) return { stale: [], healthy: [], reason: "no-parity" };
  const floor = parity * (1 + ASK_FLOOR_BPS / 10000);
  const ceil = parity * (1 - ASK_FLOOR_BPS / 10000);
  const tol = NOISE_BPS / 10000;
  const stale = [], healthy = [];
  for (const o of orders) {
    const bad = o.side === "ask" ? o.unit < floor * (1 - tol) : o.unit > ceil * (1 + tol);
    (bad ? stale : healthy).push(o);
  }
  return { stale, healthy, floor: r6(floor), ceiling: r6(ceil) };
}

/* ── A-10 honest P&L (avg-cost on real fills; unbased ≠ profit) ────────────
 * Ported semantically from the cockpit route — the single truth. */
export function pnlFromFills(fills) {
  let position = 0, cost = 0, realized = 0, unbased = 0, unbasedSbd = 0;
  let bought = 0, spent = 0, sold = 0, proceeds = 0, buys = 0, sells = 0;
  for (const f of fills) {
    if (f.side === "bid") {
      buys++; bought = r6(bought + f.steem); spent = r6(spent + f.sbd);
      position = r6(position + f.steem); cost = r6(cost + f.sbd);
    } else {
      sells++; sold = r6(sold + f.steem); proceeds = r6(proceeds + f.sbd);
      if (position > 1e-9) {
        const based = Math.min(f.steem, position);
        const avg = cost / position;
        realized = r6(realized + f.sbd * (based / f.steem) - avg * based);
        const rest = r6(f.steem - based);
        cost = r6(cost - avg * based); position = r6(position - based);
        if (rest > 1e-9) { unbased = r6(unbased + rest); unbasedSbd = r6(unbasedSbd + f.sbd * (rest / f.steem)); }
      } else {
        unbased = r6(unbased + f.steem); unbasedSbd = r6(unbasedSbd + f.sbd);
      }
    }
  }
  return {
    fills: fills.length, buys, sells,
    boughtSteem: bought, spentSbd: spent, soldSteem: sold, proceedsSbd: proceeds,
    realizedSbd: realized,
    unbasedSteem: unbased, unbasedSbd: unbasedSbd,
    positionSteem: position, positionCostSbd: cost,
    positionAvgCost: position > 1e-9 ? Math.round((cost / position) * 1e6) / 1e6 : null,
  };
}

/* ── trigger-DAG loop guards (T-2d doctrine) ─────────────────────────────── */
export function guardDepth(depth, fires) {
  const MAX_DEPTH = 8, MAX_FIRES = 64;
  if (depth > MAX_DEPTH) return { ok: false, reason: "depth-cap" };
  if (fires > MAX_FIRES) return { ok: false, reason: "fires-cap" };
  return { ok: true, reason: "within-guards" };
}

/* ── T-16 · cycle truth taxonomy ────────────────────────────────────────────
 * The measured rot (2026-09-30): 11/35 cycles counted as "fail" while EVERY
 * real step was green — the only failures were steps lawfully blocked on the
 * missing credential. One number that conflates "machine sick" with "machine
 * lawfully waiting for its operator" is a LIE by composition. Three classes:
 *   ok      — every step succeeded
 *   blocked — the ONLY failures are typed CREDENTIAL-MISSING (lawful gate)
 *   fail    — any other failure (real malfunction)
 */
export const CRED_BLOCKED_RE = /CREDENTIAL-MISSING/i;

/** steps map (stepWrap outputs) → "ok" | "blocked" | "fail" */
export function cycleHealth(steps) {
  const list = Object.values(steps ?? {}).filter((s) => s && typeof s === "object");
  const failed = list.filter((s) => s.ok === false);
  if (failed.length === 0) return "ok";
  const nonCred = failed.filter((s) => !CRED_BLOCKED_RE.test(String(s.error ?? "")));
  return nonCred.length === 0 ? "blocked" : "fail";
}

/** the failed-step names + the cred-blocked subset (for the report + events) */
export function cycleFailureBreakdown(steps) {
  const failedSteps = [];
  const blockedSteps = [];
  for (const [name, s] of Object.entries(steps ?? {})) {
    if (s && typeof s === "object" && s.ok === false) {
      failedSteps.push(name);
      if (CRED_BLOCKED_RE.test(String(s.error ?? ""))) blockedSteps.push(name);
    }
  }
  return { failedSteps, blockedSteps };
}

/* ── T-16 · VP-spoilage meter (the visible price of a blocked signing rail) ─
 * While the credential is missing, VP regenerates to the 100% cap and every
 * drop above it is burned: the fleet's vote quota (maxPerDay) goes unspent.
 * This makes the blocked cost MEASURED-visible (days/votes) + ESTIMATED ($
 * from discovery's public reward-fund math — never claimed as measured). */
export function vpSpoilage({ firstDownAt, now, maxPerDay, estSteemPerDay }) {
  const nowMs = Date.parse(now ?? new Date().toISOString());
  const downMs = firstDownAt ? Date.parse(firstDownAt) : NaN;
  if (!Number.isFinite(nowMs) || !Number.isFinite(downMs) || nowMs <= downMs) {
    return { daysBlocked: 0, votesForegone: 0, estSteemForegone: 0, class: "measured" };
  }
  const daysBlocked = Math.max(0, (nowMs - downMs) / 86_400_000);
  const votesForegone = Math.max(0, Math.floor(daysBlocked * Math.max(0, maxPerDay ?? 0)));
  const estSteemForegone = estSteemPerDay != null && estSteemPerDay > 0
    ? Math.round(daysBlocked * estSteemPerDay * 100) / 100
    : 0;
  return {
    daysBlocked: Math.round(daysBlocked * 100) / 100,
    votesForegone,
    estSteemForegone,
    class: estSteemForegone > 0 ? "estimated" : "measured",
  };
}

/* ── T-16 · credential paste-revival (pure validation half) ─────────────────
 * The file-drop revival waited on an operator action that never came. The
 * cockpit gains a paste field → engine adopts (0600) + verifies against the
 * chain's own authorities. Pure half below; the IO half lives in signer.mjs.
 * Format: "<account> <master-password|P-key...>" — ≥2 fields, sane size.
 * NEVER logs/returns the secret — only its fingerprint. */
export function validateCredentialText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (raw.length > 4096) return { ok: false, reason: "oversize" };
  const fields = raw.split(/[\s:=]+/).filter(Boolean);
  if (fields.length < 2) return { ok: false, reason: "credential-format" };
  const account = fields[0];
  if (!/^[a-z0-9\-.]{3,16}$/i.test(account)) return { ok: false, reason: "bad-account" };
  // the secret NEVER leaves this function's caller in the return value —
  // adoptCredentialText re-derives it from the same normalized split
  return { ok: true, account };
}

/* ── T-17 · signing-era throughput & concurrency truth ──────────────────────
 * Measured 2026-09-30 (first credential-revived cycle): a real multi-vote
 * curate ran minutes per vote (dead-first-node broadcasts ×15s + per-vote
 * RC/DGPO re-reads) while the sovereign's HTTP wait died at exactly 90s —
 * two real cycles counted "fail" while their votes were landing on-chain,
 * and the busy-flag release let a second cycle overlap the first (a real
 * double-vote window). Fixes: sticky node order, per-vote guard hoisting,
 * per-vote incremental state writes, cycle-run marker + start-ack polling.
 * All pure halves live here; IO halves live in signer/curator/daily/sovereign. */

/* sticky RPC node order: last-good node first. Measured: a dead first node
 * burned up to 15s of EVERY broadcast (~60s/vote, ~18min/curate run). Pure. */
export function stickyNodeOrder(lastGood, nodes) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  if (!lastGood || !list.includes(lastGood)) return [...list];
  return [lastGood, ...list.filter((n) => n !== lastGood)];
}

/* incremental curator state merge — called after EACH landed vote.
 * Crash-safe: votesToday can never be lost mid-run again (the pre-T-17 write
 * only happened after the WHOLE loop — a killed mid-loop run lost every vote
 * it had cast, reopening dedup windows and day-cap drift). Pure.
 * verdict labels the HOW for history honesty: "VOTED" (our broadcast) vs
 * "ALREADY-VOTED" (the second signer covered it — counted for the account's
 * VP budget, journaled as what it truly was). */
export function mergeVoteState(prev, day, vote, verdict = "VOTED") {
  const sameDay = prev && prev.day === day;
  const base = sameDay
    ? prev
    : { votesToday: [], authorsToday: {}, totalVotes: prev?.totalVotes ?? 0, history: prev?.history ?? [] };
  return {
    day,
    votesToday: [
      ...base.votesToday,
      { author: vote.author, permlink: vote.permlink, weight: vote.weight, at: vote.at, txid: vote.txid ?? null },
    ],
    authorsToday: { ...base.authorsToday, [vote.author]: (base.authorsToday?.[vote.author] ?? 0) + 1 },
    totalVotes: (base.totalVotes ?? 0) + 1,
    history: [...(base.history ?? []), { at: vote.at, day, verdict, n: 1, txid: vote.txid ?? null }].slice(-30),
  };
}

/* ── T-18 CHAIN-TRUTH DAY BUDGET (the split-brain killer, measured live
 * 2026-09-30): the state file counted 18/18 while the CHAIN held 22 day votes
 * (13 engine + 9 second-signer: 6×2% + 3×20% at 14:51 that no seed window
 * ever saw) — a state-file-only cap gate UNDERCOUNTS the account's real VP
 * budget by every signer it never saw. The cap is a LAW; laws get enforced
 * on chain truth, not on a file that only knows what this process wrote.
 * Counts vote ops cast BY `voter` ON `day` from condenser account-history
 * rows ([[idx, {op:[type,value], timestamp}], …]). Pure. */
export function countDayVotesFromHistory(rows, voter, day) {
  if (!Array.isArray(rows)) return null;
  const d = String(day ?? "").slice(0, 10);
  if (!voter || d.length !== 10) return null;
  let n = 0;
  for (const row of rows) {
    const e = Array.isArray(row) ? row[1] : row;
    if (!e || typeof e !== "object") continue;
    const ts = typeof e.timestamp === "string" ? e.timestamp : null;
    if (!ts || !ts.startsWith(d)) continue;
    const op = Array.isArray(e.op) ? e.op : null;
    const type = op ? op[0] : e.type;
    const val = op ? op[1] : e.value;
    if (type !== "vote" || !val || typeof val !== "object") continue;
    if (val.voter === voter) n++;
  }
  return n;
}

/* cycle-run marker classification — the sovereign polls the ENGINE's own
 * marker instead of holding an HTTP wait that any slow-but-healthy cycle
 * outlives. Pure. */
export function classifyMarker(marker) {
  if (!marker || typeof marker !== "object") return { state: "absent", health: "fail" };
  if (marker.running === true) return { state: "running", health: null };
  const h = marker.health;
  if (h === "ok" || h === "blocked" || h === "fail") return { state: "done", health: h };
  return { state: "done", health: "fail" };
}
