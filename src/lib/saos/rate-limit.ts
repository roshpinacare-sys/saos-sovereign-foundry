/**
 * Rate limiting (הגבלת-קצב) — Task 5, mission 2.
 *
 * Design:
 *  - In-memory fixed-window counter per (route, client fingerprint).
 *    No PII persisted: the fingerprint lives ONLY in process memory and is
 *    never written to DB, logs or disk. Nothing survives a restart by design.
 *  - Window is 60s. When the limit is exceeded the endpoint answers
 *    429 {ok:false, error:"rate-limited", retryAfterSec} + Retry-After header.
 *  - Per-route defaults with env override: SAOS_RL_<NAME>_PER_MIN
 *    (e.g. SAOS_RL_SEAL_PER_MIN=60).
 *  - Memory hygiene: the map is pruned whenever it grows past 5,000 keys.
 *
 * Note: single-process only (matches SQLite single-writer stage). Horizontal
 * scaling would require a shared limiter — documented in docs/deployment.md.
 */

export interface RateLimitRule {
  name: string;
  perMinute: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  resetSec: number;
}

const WINDOW_MS = 60_000;
const store = new Map<string, { windowStart: number; count: number }>();

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[`SAOS_RL_${name.toUpperCase().replace(/-/g, "_")}_PER_MIN`]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** the default rules — every protected surface of /api/saos/* */
export const RATE_RULES = {
  status: { name: "status", perMinute: envLimit("status", 120) },
  kernel: { name: "kernel", perMinute: envLimit("kernel", 30) },
  seal: { name: "seal", perMinute: envLimit("seal", 30) },
  "verify-chain": { name: "verify-chain", perMinute: envLimit("verify-chain", 60) },
  "verify-pack": { name: "verify-pack", perMinute: envLimit("verify-pack", 30) },
  energy: { name: "energy", perMinute: envLimit("energy", 30) },
  economy: { name: "economy", perMinute: envLimit("economy", 30) },
  plans: { name: "plans", perMinute: envLimit("plans", 60) },
  research: { name: "research", perMinute: envLimit("research", 30) },
  auth: { name: "auth", perMinute: envLimit("auth", 8) },
  "auth-revoke": { name: "auth-revoke", perMinute: envLimit("auth-revoke", 4) },
  "live-gate": { name: "live-gate", perMinute: envLimit("live-gate", 30) },
  signer: { name: "signer", perMinute: envLimit("signer", 30) },
  audit: { name: "audit", perMinute: envLimit("audit", 30) },
  "anchor-preflight": { name: "anchor-preflight", perMinute: envLimit("anchor-preflight", 30) },
  "repo-status": { name: "repo-status", perMinute: envLimit("repo-status", 30) },
  decisions: { name: "decisions", perMinute: envLimit("decisions", 30) },
  "live-proof": { name: "live-proof", perMinute: envLimit("live-proof", 6) },
  "breakthrough-demo": { name: "breakthrough-demo", perMinute: envLimit("breakthrough-demo", 10) },
  "owner-keys": { name: "owner-keys", perMinute: envLimit("owner-keys", 6) },
  "owner-keys-read": { name: "owner-keys-read", perMinute: envLimit("owner-keys-read", 30) },
  "keys-map": { name: "keys-map", perMinute: envLimit("keys-map", 20) },
  "agent-bridge": { name: "agent-bridge", perMinute: envLimit("agent-bridge", 30) },
  "verify-live": { name: "verify-live", perMinute: envLimit("verify-live", 10) },
  "anchor-pulse": { name: "anchor-pulse", perMinute: envLimit("anchor-pulse", 4) },
  "anchor-reverify": { name: "anchor-reverify", perMinute: envLimit("anchor-reverify", 6) },
  treasury: { name: "treasury", perMinute: envLimit("treasury", 20) },
  "treasury-ops": { name: "treasury-ops", perMinute: envLimit("treasury-ops", 20) },
  "treasury-ops-exec": { name: "treasury-ops-exec", perMinute: envLimit("treasury-ops-exec", 10) }
} as const satisfies Record<string, RateLimitRule>;

export type RateRuleName = keyof typeof RATE_RULES;

export function ruleFor(name: RateRuleName): RateLimitRule {
  return RATE_RULES[name];
}

function prune(now: number): void {
  if (store.size < 5_000) return;
  for (const [key, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS) store.delete(key);
  }
  // roast 53 — hard cap: prune only removes EXPIRED keys; 5,000+ DISTINCT
  // fresh keys within one window would grow the map unbounded (the doc
  // claimed memory hygiene that a same-window flood defeats). Delete in
  // insertion order (oldest first) — a hard ceiling, not a hope.
  if (store.size >= 5_000) {
    for (const key of store.keys()) {
      store.delete(key);
      if (store.size < 5_000) break;
    }
  }
}

/**
 * roast 53 — the client fingerprint is now the TRUSTED-PROXY one.
 * Our gateway (Caddy) APPENDS the real peer address to X-Forwarded-For, so
 * the LAST entry is the only one the attacker does not control. The old code
 * took the FIRST entry — a client could send `X-Forwarded-For: <random>` per
 * request and mint a fresh bucket every time: "rate limiting" was an
 * intermittent lie against deliberate abuse. (Correlation-only consumers use
 * the same discipline via auth.clientIpOf.)
 */
function trustedClientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length > 0) return parts[parts.length - 1]!.slice(0, 64);
  }
  return req.headers.get("x-real-ip")?.trim().slice(0, 64) || "local";
}

export function checkRateLimit(rule: RateLimitRule, fingerprint: string): RateLimitDecision {
  const now = Date.now();
  prune(now);
  const key = `${rule.name}:${fingerprint}`;
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { windowStart: now, count: 1 });
    return { allowed: true, limit: rule.perMinute, remaining: rule.perMinute - 1, retryAfterSec: 0, resetSec: 60 };
  }

  entry.count += 1;
  const resetSec = Math.max(1, Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000));
  if (entry.count > rule.perMinute) {
    return { allowed: false, limit: rule.perMinute, remaining: 0, retryAfterSec: resetSec, resetSec };
  }
  return { allowed: true, limit: rule.perMinute, remaining: Math.max(0, rule.perMinute - entry.count), retryAfterSec: 0, resetSec };
}

/** one-call guard for route handlers */
export function enforceRateLimit(name: RateRuleName, req: Request): RateLimitDecision {
  return checkRateLimit(ruleFor(name), trustedClientKey(req));
}
