/**
 * GET/POST /api/saos/treasury-ops — מימוש בפועל (Task 76)
 * =============================================================================
 * The owner asked (trace 1a08df6c8f0f1d25): "יש לנו קצת סטים או Hive או trx
 * תבדוק איך ניתן ליישם את זה בפועל". This surface is the standing answer:
 *
 * GET  — the live actionability map: per chain, per account — measured balances,
 *        pending rewards, RC water-levels with regen ETA to the floor, which
 *        keys are held+verified, which ops are executable NOW through the
 *        external signer (v2.5.7 scopes), which stay owner-gated, and the TRX
 *        implementation math. Read-only, keyless, never 500.
 *
 * POST — execute an actionability op through the external signer, admin-gated:
 *          kind=claim_rewards (STEEM/HIVE)  — non-custodial, accumulates OUR
 *                                             pending rewards into OUR balance;
 *          kind=delegate_rc   (HIVE)        — non-custodial + instantly
 *                                             reversible, BUT it degrades the
 *                                             delegating account's own RC
 *                                             capacity, which the epoch
 *                                             chain-seal broadcaster leans on
 *                                             (owner decision still pending) —
 *                                             therefore requires the explicit
 *                                             flag confirmFleetRcImpact:true.
 *        Financial moves (transfer / transfer_to_vesting / withdrawals) are
 *        deliberately NOT exposed here — owner-gated by design.
 *
 * Every execution is recorded in OpLog (op="treasury-ops", public details only)
 * and surfaced in GET so the screen shows what actually happened on-chain.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireAuth } from "@/lib/saos/auth";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { coarseError } from "@/lib/saos/api-errors";
import { measureTreasuryOps } from "@/lib/saos/treasury-ops-live";
import { externalSignerExecute } from "@/lib/saos/external-signer-client";
import { externalSignerHealth } from "@/lib/saos/external-signer-client";

export const dynamic = "force-dynamic";

const CACHE_MS = 60_000;
let cache: { at: number; body: unknown } | null = null;

export async function GET(req: Request) {
  const rl = enforceRateLimit("treasury-ops", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  if (cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.body);
  try {
    const [measured, recent] = await Promise.all([
      measureTreasuryOps(),
      db.opLog.findMany({ where: { op: "treasury-ops" }, orderBy: { createdAt: "desc" }, take: 12 })
    ]);
    const body = {
      ...measured,
      executed: recent.map((r) => ({ at: r.createdAt.toISOString(), detail: r.detail ?? "" }))
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ ok: false, error: coarseError(e, "treasury-ops-failed") }, { status: 502 });
  }
}

interface ExecBody {
  kind?: string;
  network?: string;
  account?: string;
  to?: string;
  amount?: number;
  confirmFleetRcImpact?: boolean;
}

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "auth-required: התחברות-אדמין נדרשת למימוש בפועל" },
      { status: auth.authConfigured ? 401 : 403 }
    );
  }
  const rl = enforceRateLimit("treasury-ops-exec", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: ExecBody;
  try { body = (await req.json()) as ExecBody; } catch { return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 }); }

  const kind = String(body.kind ?? "");
  const network = String(body.network ?? "").toUpperCase();
  const account = String(body.account ?? "headcorner").toLowerCase();

  // ── capability gate — only the two non-custodial kinds are exposed ──
  const EXECUTABLE: Record<string, string[]> = {
    claim_rewards: ["STEEM", "HIVE"],
    delegate_rc: ["HIVE"]
  };
  const nets = EXECUTABLE[kind];
  if (!nets) {
    return NextResponse.json(
      { ok: false, error: `kind לא נתמכת כאן (${kind || "?"}). מימוש-פיננסי (transfer/power-up) נשאר שער-בעלים לפי-עיצוב`, executableKinds: Object.keys(EXECUTABLE) },
      { status: 400 }
    );
  }
  if (!nets.includes(network)) {
    return NextResponse.json({ ok: false, error: `kind ${kind} רק על ${nets.join("/")}` }, { status: 400 });
  }

  // ── the honest guard: delegate_rc degrades fleet RC capacity that the epoch
  //    chain-seal broadcaster leans on — a pending owner decision. A human must
  //    carry the flag; nothing here fires it silently.
  if (kind === "delegate_rc" && body.confirmFleetRcImpact !== true) {
    return NextResponse.json(
      { ok: false, error: "delegate_rc דורש confirmFleetRcImpact:true — ההפקדה מנוונת את ה-RC של החשבון המפקיד, והמשדר-ההיסטורי chain-seal נשען עליו (הכרעת-בעלים תלויה)", refused: "owner-decision-pending" },
      { status: 409 }
    );
  }

  const health = await externalSignerHealth();
  if (!health.connected) {
    return NextResponse.json({ ok: false, error: "signer-disconnected: החותם-החיצוני אינו זמין — fail-closed" }, { status: 409 });
  }

  // deterministic requestId per (kind, network, account, UTC-day) — the signer's
  // idempotency ledger collapses accidental retries to the cached verdict.
  const dayBucket = new Date().toISOString().slice(0, 13);
  const requestId = `tops-${kind}-${network}-${account}-${dayBucket}`;
  const exec = await externalSignerExecute({
    requestId,
    network: network as "STEEM" | "HIVE",
    kind,
    payload: "",
    account,
    to: body.to ? String(body.to) : undefined,
    amount: typeof body.amount === "number" ? body.amount : undefined
  });

  const detail = `kind=${kind} network=${network} account=${account} to=${body.to ?? "-"} amount=${body.amount ?? "-"} requestId=${requestId} → ${exec.ok ? `txid=${exec.txid} block=${exec.confirmedBlock ?? "?"}` : `refused: ${String(exec.error ?? "?").slice(0, 120)}`}`;
  try {
    await db.opLog.create({ data: { op: "treasury-ops", detail } });
  } catch { /* audit-trail best-effort — the chain result stands on its own */ }
  await audit({
    kind: "treasury-ops",
    actor: auth.actorRef,
    action: "POST /treasury-ops",
    allowed: exec.ok,
    req,
    detail
  });

  if (!exec.ok) {
    const definitive = exec.status === 400 || exec.status === 403 || exec.status === 429;
    return NextResponse.json(
      { ok: false, error: exec.error ?? "signer-refused", requestId, ambiguity: definitive ? "definitive-refusal" : "ambiguous-broadcast" },
      { status: definitive ? 502 : 202 }
    );
  }
  cache = null; // invalidate the read cache — the next GET re-measures
  return NextResponse.json({ ok: true, requestId, txid: exec.txid, confirmedBlock: exec.confirmedBlock ?? null, nodeTrxId: exec.nodeTrxId ?? null, account: exec.account ?? account, network, kind });
}
