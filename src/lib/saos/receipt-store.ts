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
}

// isUniqueViolation is declared further below and hoisted — safe to use in appendOn

async function appendOn(client: DbLike, kind: string, payload: Record<string, unknown>, sealId?: string): Promise<AppendResult> {
  // deterministic tie-break: createdAt has millisecond precision and 11
  // same-millisecond adjacent pairs already exist in this chain — id (cuid,
  // time-ordered) breaks the tie toward the most-recent insert. A wrong "prev"
  // pick would forge a silent fork.
  const prev = await client.evidenceReceipt.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
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

/** append a receipt in its own serialized transaction (GET-route side effects) */
export function appendReceipt(kind: string, payload: Record<string, unknown>, sealId?: string): Promise<AppendResult> {
  return db.$transaction((tx) => appendOn(tx, kind, payload, sealId));
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
