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

/* ── peg ladder planner (B-1/B-3 + T-9 adoptions) ──────────────────────────
 * Law: every ask ≥ floor (parity*(1+ASK_FLOOR_BPS)), every bid ≤ ceiling
 * (parity−20bps); budgets assigned level-by-level clamped to remaining
 * (sum ≤ budget BY CONSTRUCTION — the T-5 rounding-blocker lesson). */
export function planLadder({
  parity, askBudgetSteem, bidBudgetSbd,
  spreadBps = 0, skew = { askMult: 1, bidMult: 1 },
  levels = LEVELS, minLevel = MIN_LEVEL, now = "1970-01-01T00:00:00Z",
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

  const asks = [];
  let remA = r6(askBudgetSteem);
  let lvlA = floor;
  for (let i = 0; i < levels; i++) {
    if (remA < minLevel) break;
    const want = r6(Math.max(minLevel, (askBudgetSteem / levels) * skew.askMult));
    const amt = r6(Math.min(remA, want));
    if (amt < minLevel) break;
    asks.push({ side: "ask", amountSteem: amt, unit: r6u(lvlA), at: now });
    remA = r6(remA - amt);
    lvlA = lvlA * step;
  }
  if (remA > 0 && asks.length === 0) block.push("ask-budget-below-min-level");

  const bids = [];
  let remB = r6(bidBudgetSbd);
  let lvlB = ceil;
  for (let i = 0; i < levels; i++) {
    if (remB < minLevel) break;
    const want = r6(Math.max(minLevel, (bidBudgetSbd / levels) * skew.bidMult));
    const amt = r6(Math.min(remB, want));
    if (amt < minLevel) break;
    bids.push({ side: "bid", amountSbd: amt, unit: r6d(lvlB), at: now });
    remB = r6(remB - amt);
    lvlB = lvlB / step;
  }
  if (remB > 0 && bids.length === 0) block.push("bid-budget-below-min-level");

  // law self-check: never violate floor/ceiling regardless of inputs (ε=1e-9)
  for (const a of asks) if (a.unit < floor - 1e-9) block.push("VF1-ask-below-floor");
  for (const b of bids) if (b.unit > ceil + 1e-9) block.push("VF1-bid-above-ceiling");

  const verdict = asks.length + bids.length === 0
    ? "OFFER-EMPTY"
    : block.length ? "OFFER-BLOCKED" : "OFFER-READY";
  return { verdict, asks, bids, blocker: block.length ? block : null, dragK: k, floor, ceiling: ceil };
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
