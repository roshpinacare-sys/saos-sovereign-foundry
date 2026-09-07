/**
 * Keyless external signing interface (ממשק חתימה חיצוני ללא-סודות) — Task 5, mission 4.
 *
 * Golden rule: if an action needs a private key, the system does NOT perform,
 * store or print it. The system's job ends at producing everything the signer
 * needs EXCEPT the key:
 *   - the transaction content (canonical, public by construction)
 *   - the payload to sign
 *   - the exact hash to sign (digestToSign)
 *   - the metadata the external signer needs (network, kind, expiry)
 * The ONLY thing that flows back is the public result (txid) — recorded by
 * PATCH /api/saos/signer after the human signs out-of-band.
 *
 * Signer kinds:  none | external | manual | hardware
 * Signer states: disconnected | ready | awaiting-approval | error
 *
 * There is deliberately NO key-echo, NO key parameter, NO key column anywhere
 * — the DB model has no field where a private key could even be stored.
 */

import { canonicalDigest, canonicalize } from "./canonical-json";
import type { SealRecord } from "@prisma/client";

export type SignerKind = "none" | "external" | "manual" | "hardware";
export type SignerStatus = "disconnected" | "ready" | "awaiting-approval" | "error";

export interface SignRequest {
  id: string;
  network: "STEEM" | "BLURT" | "HIVE" | "TRON";
  kind: "weave" | "checkpoint";
  /** public, canonical transaction content — exactly what will be posted/broadcast */
  payload: string;
  payloadHash: string;
  /** the exact bytes-hash the external signer signs out-of-band */
  digestToSign: string;
  metadata: {
    sealHeight: number | null;
    sealRoot: string | null;
    stateRoot: string | null;
    createdAt: string;
    expiresAt: string;
    instructions: string;
  };
}

export interface SignResponse {
  ok: boolean;
  signer: SignerKind;
  signerStatus: SignerStatus;
  /** public result only (txid) — or a manual/hardware instruction set */
  txid?: string | null;
  error?: string;
}

export interface SignerDescriptor {
  signer: SignerKind;
  status: SignerStatus;
  detail: string;
  /** what the system emits for this signer, and what it accepts back */
  emits: string;
  acceptsBack: string;
}

/** the signer registry — honest states; nothing is connected in this stage */
export function signerRegistry(): SignerDescriptor[] {
  return [
    {
      signer: "manual",
      status: "ready",
      detail: "חתימה ידנית מחוץ למערכת — המערכת מכינה payload, האדם חותם בכלי חיצוני ומחזיר txid",
      emits: "SignRequest (payload + digestToSign + metadata)",
      acceptsBack: "txid בלבד (תוצאה ציבורית)"
    },
    {
      signer: "external",
      status: "disconnected",
      detail: "ארנק/שירות חיצוני — ממשק מוגדר, אין endpoint מחובר בשלב זה",
      emits: "SignRequest (JSON over HTTPS, עתידי)",
      acceptsBack: "SignResponse חתום (txid / signature-ref)"
    },
    {
      signer: "hardware",
      status: "disconnected",
      detail: "מכשיר חומרה — ממשק מוגדר, אין התקן רשום בשלב זה",
      emits: "SignRequest לאישור על-גבי המכשיר",
      acceptsBack: "txid / signature-ref"
    },
    {
      signer: "none",
      status: "disconnected",
      detail: "ברירת-מחדל — אין חותם מחובר; יצירת בקשות חתימה נדחית",
      emits: "—",
      acceptsBack: "—"
    }
  ];
}

/** per-network signing instructions — what the human does outside the system */
function instructionsFor(network: SignRequest["network"], kind: SignRequest["kind"]): string {
  const common = `חתום/אשר מחוץ למערכת את התוכן שלהלן (kind=${kind}) ואז רשום את ה-txid הציבורי חזרה למערכת. אין להזין מפתח פרטי למערכת בשום צורה.`;
  switch (network) {
    case "STEEM":
      return `custom_json operation — id=saos.weave.v1, json=${"{root,height}"} מה-payload. ${common}`;
    case "BLURT":
      return `custom_json קנוני (low-s) עם active key בארנק חיצוני. ${common}`;
    case "HIVE":
      return `custom_json operation — id=saos.weave.v1 (סף-קל RC). ${common}`;
    case "TRON":
      return `TriggerSmartContract — data field = stateRoot מה-payload, או שידור דרך tronbridge. ${common}`;
  }
}

/** build a SignRequest from a stored seal — everything the signer needs, nothing it shouldn't */
export async function buildSignRequest(
  seal: Pick<SealRecord, "id" | "height" | "root" | "stateRoot">,
  network: SignRequest["network"],
  kind: SignRequest["kind"],
  id: string,
  ttlMs: number
): Promise<SignRequest> {
  const now = Date.now();
  const payload = canonicalize({
    v: 1,
    protocol: "saos.weave.v1",
    seal: { id: seal.id, height: seal.height, root: seal.root, stateRoot: seal.stateRoot },
    network,
    kind,
    forgedAtMs: now
  });
  const payloadHash = await canonicalDigest(JSON.parse(payload));
  return {
    id,
    network,
    kind,
    payload,
    payloadHash,
    digestToSign: payloadHash,
    metadata: {
      sealHeight: seal.height,
      sealRoot: seal.root,
      stateRoot: seal.stateRoot,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      instructions: instructionsFor(network, kind)
    }
  };
}

export const SIGN_TTL_MS = Number(process.env.SAOS_SIGN_TTL_H ?? 24) * 3_600_000;

export function parseSignerKind(raw: unknown): SignerKind | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "manual" || v === "external" || v === "hardware" ? v : null;
}

export function parseNetwork(raw: unknown): SignRequest["network"] | null {
  const v = String(raw ?? "").trim().toUpperCase();
  return v === "STEEM" || v === "BLURT" || v === "HIVE" || v === "TRON" ? v : null;
}

/** loose public-result validation — a txid is public data; reject emptiness/controls, nothing exotic */
export function plausibleTxid(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return /^[\w.-]{8,128}$/.test(v) ? v : null;
}

// ─── Task 6: signature lifecycle (מחזור-חיים של בקשת חתימה) ──────────────────
//
//   pending ──(manual signer attached)──▶ awaiting-approval
//      │                                      │
//      │ (expiresAt passes)                   │ (expiresAt passes)
//      ▼                                      ▼
//   expired                               expired
//
//   awaiting-approval ──(public result: txid+proof)──▶ signed-externally
//       │                                                  │
//       │ (action=cancel / action=fail)                    ├─(verified=true)──▶ recorded
//       ▼                                                  └─(verified=false)──▶ stays
//   cancelled / failed                                        signed-externally
//                                                             (honest unverified —
//                                                              NEVER shown as final)
//
// terminal states: recorded | failed | expired | cancelled — no further mutation.

export type SignatureLifecycle =
  | "pending"
  | "awaiting-approval"
  | "signed-externally"
  | "recorded"
  | "failed"
  | "expired"
  | "cancelled";

export const LIFECYCLE_STATES: SignatureLifecycle[] = [
  "pending",
  "awaiting-approval",
  "signed-externally",
  "recorded",
  "failed",
  "expired",
  "cancelled"
];

/** statuses that still allow cancel/fail (i.e. no public result recorded yet) */
export function isCancellable(status: SignatureLifecycle): boolean {
  return status === "pending" || status === "awaiting-approval";
}

/**
 * Lazy expiry — a request still in pending/awaiting-approval whose expiresAt
 * passed is EXPIRED. Computed on read; the stored status column is never
 * rewritten by reads (write path is cleanup.mjs / explicit PATCH only).
 */
export function effectiveStatus(row: { status: string; expiresAt: Date; txid: string | null }): SignatureLifecycle {
  const s = (LIFECYCLE_STATES as string[]).includes(row.status) ? (row.status as SignatureLifecycle) : "pending";
  if ((s === "pending" || s === "awaiting-approval") && row.expiresAt.getTime() < Date.now()) {
    return "expired";
  }
  return s;
}

// ─── Task 6 mission 4: public txid verification (אימות txid מול רשת ציבורית) ──
//
// READ-ONLY public probes — never a broadcast, never a transaction, no keys.
// A 5s timeout each; ANY failure resolves to { verified:false, reason } — the
// system then honestly reports "unverified" and NEVER presents the anchor as
// final. Verification is opt-in (verify:true on PATCH) and its outcome is
// stored with its public source.

export interface TxidVerification {
  verified: boolean;
  /** the public endpoint/method that verified — null when verification failed */
  source: string | null;
  /** honest reason when verified=false */
  reason: string;
}

async function probeJson(url: string, body: unknown, timeoutMs = 5_000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store"
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** STEEM / HIVE condenser API: get_transaction returns null/empty when unknown */
async function verifyCondenser(apiUrl: string, network: string, txid: string): Promise<TxidVerification> {
  const json = await probeJson(apiUrl, { jsonrpc: "2.0", method: "condenser_api.get_transaction", params: [txid], id: 1 });
  if (json === null) {
    return { verified: false, source: null, reason: `אימות ${network} נכשל: שירות הרשת הציבורי לא נגיש מהסנדבוקס (פסק-זמן) — הבקשה נשארת unverified ולא מוצגת כעוגן סופי` };
  }
  const tx = (json as { result?: unknown }).result;
  if (tx && typeof tx === "object" && "transaction_id" in (tx as Record<string, unknown>)) {
    return { verified: true, source: apiUrl, reason: "txid אומת מול הרשת הציבורית (get_transaction)" };
  }
  return { verified: false, source: null, reason: `הרשת הציבורית (${apiUrl}) לא מכירה את ה-txid — הבקשה מסומנת unverified` };
}

/** TRON: GET gettransactionbyid on TronGrid public API */
async function verifyTron(txid: string): Promise<TxidVerification> {
  const url = `https://api.trongrid.io/wallet/gettransactionbyid?value=${encodeURIComponent(txid)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!res.ok) {
      return { verified: false, source: null, reason: "אימות TRON נכשל: TronGrid לא נגיש (HTTP " + res.status + ") — unverified" };
    }
    const json = (await res.json()) as { ret?: Array<{ result?: boolean }>; raw_data?: unknown };
    if (json?.raw_data && Array.isArray(json.ret) && json.ret[0]?.result === true) {
      return { verified: true, source: "https://api.trongrid.io/wallet/gettransactionbyid", reason: "txid אומת מול TronGrid" };
    }
    return { verified: false, source: null, reason: "TronGrid לא מכיר את ה-txid (או שהוא עדיין ב-mempool) — unverified" };
  } catch {
    return { verified: false, source: null, reason: "אימות TRON נכשל: TronGrid לא נגיש מהסנדבוקס (פסק-זמן) — unverified" };
  }
}

export async function verifyTxidPublic(network: SignRequest["network"], txid: string): Promise<TxidVerification> {
  switch (network) {
    case "STEEM":
      return verifyCondenser("https://api.steemit.com", "STEEM", txid);
    case "HIVE":
      return verifyCondenser("https://api.hive.blog", "HIVE", txid);
    case "BLURT":
      return verifyCondenser("https://rpc.blurt.world", "BLURT", txid);
    case "TRON":
      return verifyTron(txid);
  }
}
