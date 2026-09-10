/**
 * Receipt store + write primitives (מאגר-קבלות אטומי).
 * Solves:
 *   F2 (chain fork): every receipt append runs inside a serialized
 *     transaction — prevDigest is read and the new receipt is written in
 *     ONE transaction, so concurrent appends cannot interleave.
 *   F3 (digest collision on identical runs): tolerated by design —
 *     the chain keeps the existing receipt, the run continues.
 * Mode-aware: when persistence is disabled (safe/maintenance) the receipt
 * is still computed and returned, but NOT written — computation is never
 * blocked, persistence is.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { forgeReceipt, type ChainedReceipt } from "./evidence";
import { persistenceAllowed } from "./modes";

export type DbLike = Prisma.TransactionClient | typeof db;

export interface AppendResult {
  receipt: ChainedReceipt;
  persisted: boolean;
  /** roast 59 — set when the append was skipped by the duplicate window (honest disclosure, never silent) */
  suppressed?: string;
}

// ─── roast 59: duplicate-window ─────────────────────────────────────────────
// The chain is EVIDENCE, not a log. A kernel selftest every 2 seconds chains
// the SAME truth again and again (LIVE-caught: two identical selftests 2s
// apart → 2 identical receipts; at the 30/min limit that is ~43k duplicate
// rows/day diluting the chain). GET-route appends now suppress an identical
// computed payload within the window: the caller still gets the freshly
// computed result, honestly marked persisted:false + suppressed — nothing is
// hidden, the chain just stops re-recording the same fact.
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const VOLATILE_PAYLOAD_KEYS = new Set(["planId", "snapshotId", "digest", "at", "runId", "checkpointId"]);

function stablePayloadOf(payload: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) {
    if (!VOLATILE_PAYLOAD_KEYS.has(k)) out[k] = payload[k];
  }
  return JSON.stringify(out);
}

// isUniqueViolation is declared further below and hoisted — safe to use in appendOn

async function appendOn(
  client: DbLike,
  kind: string,
  payload: Record<string, unknown>,
  sealId?: string,
  opts?: { suppressDuplicateWindow?: boolean }
): Promise<AppendResult> {
  // deterministic tie-break: createdAt has millisecond precision and 11
  // same-millisecond adjacent pairs already exist in this chain — id (cuid,
  // time-ordered) breaks the tie toward the most-recent insert. A wrong "prev"
  // pick would forge a silent fork.
  const prev = await client.evidenceReceipt.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });

  // roast 59 — duplicate-window probe: INSIDE the same serialized transaction
  // (no race), GET-route path only. Identical stable payload for the same kind
  // within the window → computed, returned, NOT re-chained.
  if (opts?.suppressDuplicateWindow && persistenceAllowed()) {
    const lastSameKind = await client.evidenceReceipt.findFirst({
      where: { kind },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (lastSameKind) {
      const atMs = (lastSameKind.at ?? lastSameKind.createdAt).getTime();
      const ageMs = Date.now() - atMs;
      if (ageMs >= 0 && ageMs <= DUPLICATE_WINDOW_MS) {
        try {
          const lastPayload = JSON.parse(lastSameKind.payload) as Record<string, unknown>;
          if (stablePayloadOf(lastPayload) === stablePayloadOf(payload)) {
            const wouldBe = await forgeReceipt(kind, payload, prev?.digest ?? null);
            return {
              receipt: wouldBe,
              persisted: false,
              suppressed: `duplicate-window: identical ${kind} content already chained ${Math.round(ageMs / 1000)}s ago — computed fresh, not re-chained (${Math.ceil((DUPLICATE_WINDOW_MS - ageMs) / 1000)}s of window left)`
            };
          }
        } catch {
          // unparseable stored payload → fall through and chain as usual
        }
      }
    }
  }

  const receipt = await forgeReceipt(kind, payload, prev?.digest ?? null);
  if (!persistenceAllowed()) return { receipt, persisted: false };
  try {
    await client.evidenceReceipt.create({
      data: {
        kind: receipt.kind,
        digest: receipt.digest,
        prevDigest: receipt.prevDigest,
        at: new Date(receipt.at), // forge time is part of the digest — persisted for re-verification
        payload: JSON.stringify(receipt.payload),
        sealId: sealId ?? null
      }
    });
    return { receipt, persisted: true };
  } catch (e) {
    // ONLY a genuine identical-run digest collision (unique constraint) is
    // tolerable — the chain keeps the existing receipt. Any OTHER failure
    // (disk, lock, pool) must propagate: swallowing it here would mislabel a
    // real write failure as a benign collision (the old catch{} lied).
    if (isUniqueViolation(e)) return { receipt, persisted: false };
    throw e;
  }
}

/**
 * Append a receipt in its own serialized transaction (GET-route side effects).
 * roast 53 — F2 honesty: the docstring always claimed "concurrent appends
 * cannot interleave", but this path ran a bare $transaction: only the
 * rollback-journal lock-upgrade dance + BUSY retries made a head-fork
 * unlikely (safe by luck, and only while journal_mode stays "delete" — flip
 * to WAL and the read-then-write window forks for real). Every append now
 * queues through the SAME in-process write mutex the seal route uses:
 * serial by construction, independent of journal mode.
 */
export function appendReceipt(kind: string, payload: Record<string, unknown>, sealId?: string): Promise<AppendResult> {
  return withWriteLock(() => db.$transaction((tx) => appendOn(tx, kind, payload, sealId, { suppressDuplicateWindow: true })));
}

/** append a receipt inside a caller-owned transaction (seal route — same tx as the seal) */
export function appendReceiptTx(tx: Prisma.TransactionClient, kind: string, payload: Record<string, unknown>, sealId?: string): Promise<AppendResult> {
  return appendOn(tx, kind, payload, sealId);
}

// ─── concurrency primitives ───────────────────────────────────────────────────

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** transient write-lock errors — safe to retry: the transaction rolled back, nothing was written */
export function isTransientWriteError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2024" || e.code === "P2028")) return true;
  const msg = e instanceof Error ? e.message : "";
  return (
    msg.includes("SQLITE_BUSY") ||
    msg.includes("database is locked") ||
    msg.includes("Timed out fetching a connection") ||
    msg.includes("Transaction already closed")
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// in-process write mutex — SQLite honors one writer at a time; the queue makes
// concurrent seal/receipt transactions SERIAL instead of contending on the file lock
let writeQueue: Promise<unknown> = Promise.resolve();
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
}

/**
 * Retry with exponential backoff on write conflicts: unique-constraint
 * violations (re-read fresh max height and go again) and transient lock/pool
 * errors (transaction rolled back cleanly). Any other error propagates
 * immediately (fail-closed discipline).
 */
export async function retryWrite<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = isUniqueViolation(e) || isTransientWriteError(e);
      if (!retryable || attempt === opts.attempts) throw lastErr;
      await sleep(opts.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastErr; // unreachable — kept for type-safety
}
