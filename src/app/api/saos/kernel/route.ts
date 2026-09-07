import { NextResponse } from "next/server";
import { kernelSelftest } from "@/lib/saos/kernel";
import { appendReceipt } from "@/lib/saos/receipt-store";

export const dynamic = "force-dynamic";

export async function GET() {
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
      { ok: false, error: e instanceof Error ? e.message : "selftest failed" },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}
