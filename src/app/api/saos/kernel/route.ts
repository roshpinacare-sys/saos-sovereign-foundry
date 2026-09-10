import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { coarseError } from "@/lib/saos/api-errors";
import { kernelSelftest } from "@/lib/saos/kernel";
import { appendReceipt } from "@/lib/saos/receipt-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = enforceRateLimit("kernel", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited: ניסיונות רבים מדי — המתן רגע", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    const result = await kernelSelftest();

    // evidence receipt for this selftest run (serialized append — no chain forks)
    const appended = await appendReceipt(
      "selftest",
      { ok: result.ok, stateRoot: result.stateRoot, gasUsed: result.gasUsed }
    );

    return NextResponse.json({ ok: result.ok, result, receipt: appended.receipt.digest, persisted: appended.persisted });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: coarseError(e, "selftest-failed") },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}
