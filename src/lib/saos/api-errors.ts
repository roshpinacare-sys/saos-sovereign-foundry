/**
 * Roast-58 — coarseError: the "errors are data" philosophy had a hole.
 *
 * The routes return error strings to ANY caller (anonymous included). Curated
 * errors (ours) are honest single-line business phrases and SHOULD travel to
 * the caller verbatim ("unsafe integer rejected", "signer-unreachable: fetch
 * failed"). Unexpected errors (Prisma/fs/stack traces) carry INTERNALS:
 * source paths under /home/z/…, .next chunk paths, SQL fragments — LIVE-proven
 * this round: GET /energy?trx=2e9 returned the Prisma invocation with source
 * paths to an anonymous visitor, and the same class was already fixed narrow
 * (audit, verify-chain) in roast-57 while ~25 more catch sites stayed raw.
 *
 * Discipline: detect internal-shaped messages (newlines / absolute paths /
 * framework tokens), keep curated ones, coarsen the internal ones, truncate
 * everything, and ALWAYS log the full error server-side — nothing is silently
 * swallowed, the operator sees the whole truth in the logs.
 */

const INTERNAL_RE =
  /\n|\/home\/|\/root\/|\/tmp\/|\/var\/|\.next\/|node_modules|file:\/\//i;

export function coarseError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (INTERNAL_RE.test(raw) || /prisma|invalid `/i.test(raw)) {
    // full truth goes to the server log — never swallowed
    console.error(`[saos:${fallback}]`, e);
    return `${fallback} (internal details withheld — the full error is in the server log)`;
  }
  const msg = raw || fallback;
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}
