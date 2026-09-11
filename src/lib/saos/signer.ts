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
import { ethereumReadRpcCandidates } from "./networks/ethereum";
import { solanaReadRpcCandidate } from "./networks/solana";
import { externalSignerCached } from "./external-signer-client";

export type SignerKind = "none" | "external" | "manual" | "hardware";
export type SignerStatus = "disconnected" | "ready" | "awaiting-approval" | "error";

/** Hebrew purpose label per request kind — what the owner is being asked to sign FOR */
export function purposeLabel(kind: string): string {
  return kind === "checkpoint"
    ? "עיגון נקודת-ציון (checkpoint) — הטמעת חותמה ברשת החוץ"
    : "עיגון שזירה (weave) — הטמעת שורש המרקל ברשת החוץ";
}

export interface SignRequest {
  id: string;
  network: "STEEM" | "BLURT" | "HIVE" | "TRON" | "ETHEREUM" | "SOLANA";
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
  const ext = externalSignerCached();
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
      status: ext.connected ? "ready" : "disconnected",
      detail: ext.connected
        ? `${ext.detail} — המערכת מקבלת רק txid ציבורי (Task 26, הנחיית-בעלים)`
        : "ארנק/שירות חיצוני — ממשק מוגדר; החיבור נבדק מול mini-services/external-signer (:3033)",
      emits: "SignRequest (JSON over HTTPS)",
      acceptsBack: ext.connected ? "txid ציבורי מהחותם" : "SignResponse חתום (txid / signature-ref)"
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
    case "ETHEREUM":
      return `עסקת EVM — stateRoot/seal-root בנתוני הקריאה (calldata) או commitment ב-event log/memo; דורש gas (ETH). ${common}`;
    case "SOLANA":
      return `עסקת Solana — Instruction לתוכנית Memo עם ה-root, או commitment מול blockhash; דורש SOL לעמלות/rent. ${common}`;
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
  // Task 80 — HIVE carries the COMPACT weave commitment: json={v,protocol,root,height}.
  // This is exactly the ETH-calldata philosophy (root‖height IS the anchor;
  // stateRoot/seal-id live in the platform's records). Reason, measured live
  // 2026-09-11: the legacy out-of-project saos-dex chain-seal stream harvests
  // EVERY account (headcorner AND the fleet) at its ~207M-RC threshold — BELOW
  // the full weave's 231,629,405-RC cost — a structural starvation that waiting
  // can never win (macrame was harvested at 04:33:15Z minutes before ours).
  // The compact payload (120B ≈ ~108M RC) crosses ITS OWN threshold BEFORE the
  // stream crosses its — the first winnable race. STEEM/BLURT keep the full
  // format (their anchors are recorded that way and their RC is healthy).
  const payload = canonicalize(
    network === "HIVE"
      ? { v: 1, protocol: "saos.weave.v1", height: seal.height, root: seal.root }
      : {
          v: 1,
          protocol: "saos.weave.v1",
          seal: { id: seal.id, height: seal.height, root: seal.root, stateRoot: seal.stateRoot },
          network,
          kind,
          forgedAtMs: now
        }
  );
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
  return v === "STEEM" || v === "BLURT" || v === "HIVE" || v === "TRON" || v === "ETHEREUM" || v === "SOLANA" ? v : null;
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
  /** roast 56: this failure is a TRANSPORT failure (endpoint unreachable/timeout)
   * — the caller may rotate to the next candidate. A definitive answer (endpoint
   * answered: verified OR unknown-txid) must NOT be re-classified by matching
   * substrings of a human-readable reason — that was control-flow-by-Hebrew-
   * substring, a safe-by-luck pattern: rewording a reason would silently break
   * rotation. The flag is structural; reasons remain for humans. */
  transportFailure?: boolean;
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

/**
 * roast 51 — condenser candidate lists per network (same doctrine as BLURT/ETH):
 * a single hardcoded endpoint makes "unverifiable" an intermittent lie when one
 * host 403/429s while the chain is fine. All candidates live-verified 2026-09-10
 * with fresh heads (steem 109449504 / hive 109784074). A transport failure
 * ("לא נגיש/פסק-זמן") advances to the next candidate; a definitive answer
 * (verified OR endpoint-answered-but-unknown-txid) returns immediately.
 */
const CONDENSER_CANDIDATES: Record<"STEEM" | "HIVE", string[]> = {
  STEEM: ["https://api.steemit.com", "https://api.steem.fans", "https://api.justyy.com", "https://steemapi.boylikegirl.club"],
  HIVE: ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"]
};

/**
 * rotate condenser candidates for one condenser-chain verification, then (when
 * the signer gave a block hint) fall back to get_block on the endpoint that
 * actually ANSWERED — never on the dead one (roast 50 BLURT lesson, generalized).
 */
async function verifyCondenserRotating(
  network: "STEEM" | "HIVE",
  txid: string,
  blockHint?: number | null
): Promise<TxidVerification> {
  let last: TxidVerification = { verified: false, source: null, reason: `אימות ${network}: אף נקודת-קצה ציבורית לא נבדקה`, transportFailure: true };
  let answeredUrl: string | null = null;
  for (const url of CONDENSER_CANDIDATES[network]) {
    last = await verifyCondenser(url, network, txid);
    if (last.verified) return last;
    if (last.transportFailure) continue; // roast 56: structural flag, not a substring of the reason
    answeredUrl = url; // definitive answer (unknown txid) — stop rotating
    break;
  }
  if (blockHint) {
    const viaBlock = await verifyCondenserBlock(answeredUrl ?? CONDENSER_CANDIDATES[network][0]!, network, txid, blockHint);
    if (viaBlock.verified) return viaBlock;
  }
  return last;
}

/** STEEM / HIVE condenser API: get_transaction returns null/empty when unknown */
async function verifyCondenser(apiUrl: string, network: string, txid: string): Promise<TxidVerification> {
  const json = await probeJson(apiUrl, { jsonrpc: "2.0", method: "condenser_api.get_transaction", params: [txid], id: 1 });
  if (json === null) {
    return { verified: false, source: null, transportFailure: true, reason: `אימות ${network} נכשל: שירות הרשת הציבורי לא נגיש מהסנדבוקס (פסק-זמן) — הבקשה נשארת unverified ולא מוצגת כעוגן סופי` };
  }
  const tx = (json as { result?: unknown }).result;
  if (tx && typeof tx === "object" && "transaction_id" in (tx as Record<string, unknown>)) {
    return { verified: true, source: apiUrl, transportFailure: false, reason: "txid אומת מול הרשת הציבורית (get_transaction)" };
  }
  return { verified: false, source: null, transportFailure: false, reason: `הרשת הציבורית (${apiUrl}) לא מכירה את ה-txid — הבקשה מסומנת unverified` };
}

/**
 * Task 47 — block-based fallback for condenser chains (proven needed on BLURT):
 * BLURT public nodes lag on account_history (get_transaction says "Unknown
 * Transaction" minutes after a tx is in a block) and their condenser responses
 * TRUNCATE transaction_id to 40 chars. When the caller has the signer's
 * confirmedBlock hint, we verify against the block itself: a tx whose id is a
 * prefix of ours (40+ hex chars — collision-impossible in practice) carrying
 * our custom_json id is the same transaction.
 */
async function verifyCondenserBlock(apiUrl: string, network: string, txid: string, blockNum: number): Promise<TxidVerification> {
  const json = await probeJson(apiUrl, { jsonrpc: "2.0", method: "condenser_api.get_block", params: [blockNum], id: 1 }, 8_000);
  if (json === null) {
    return { verified: false, source: null, transportFailure: true, reason: `אימות ${network} (בלוק ${blockNum}) נכשל: ה-RPC הציבורי לא נגיש — unverified` };
  }
  const txs = (json as { result?: { transactions?: Array<{ transaction_id?: string; operations?: Array<[string, Record<string, unknown>]> }> } }).result?.transactions ?? [];
  const hit = txs.find((tx) => {
    const id = tx.transaction_id ?? "";
    return id === txid || (id.length >= 32 && txid.startsWith(id));
  });
  if (!hit) {
    return { verified: false, source: null, transportFailure: false, reason: `${network}: הבלוק ${blockNum} אותר אך אינו מכיל את ה-txid — unverified` };
  }
  const op = hit.operations?.[0];
  const customId = typeof op?.[1]?.id === "string" ? (op[1].id as string) : null;
  return {
    verified: true,
    source: `${apiUrl} (get_block ${blockNum})`,
    transportFailure: false,
    reason: `txid אומת בבלוק ${blockNum} מול הרשת הציבורית${customId ? ` (custom_json ${customId})` : ""}`
  };
}

/** TRON: GET gettransactionbyid — trongrid primary, tronstack on transport failure (roast 51: a 429 on one host must not fake an unverifiable anchor) */
const TRON_VERIFY_ENDPOINTS = ["https://api.trongrid.io", "https://api.tronstack.io"];
async function verifyTron(txid: string): Promise<TxidVerification> {
  let lastReason = "אימות TRON: אף נקודת-קצה לא נוסתה";
  for (const base of TRON_VERIFY_ENDPOINTS) {
    const url = `${base}/wallet/gettransactionbyid?value=${encodeURIComponent(txid)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
      if (!res.ok) {
        lastReason = `אימות TRON: ${new URL(url).host} לא נגיש (HTTP ${res.status}) — עובר לנקודת-הקריאה הבאה`;
        continue; // transport failure — rotate, never fake "unverified by the network"
      }
      const json = (await res.json()) as { ret?: Array<{ result?: boolean }>; raw_data?: unknown };
      if (json?.raw_data && Array.isArray(json.ret) && json.ret[0]?.result === true) {
        return { verified: true, source: url, reason: `txid אומת מול ${new URL(url).host}` };
      }
      return { verified: false, source: null, reason: `${new URL(url).host} לא מכיר את ה-txid (או שהוא עדיין ב-mempool) — unverified` };
    } catch {
      lastReason = `אימות TRON: ${new URL(url).host} לא נגיש מהסנדבוקס (פסק-זמן) — עובר לנקודת-הקריאה הבאה`;
    }
  }
  return { verified: false, source: null, reason: `${lastReason} — unverified` };
}

/** ETHEREUM: read-only eth_getTransactionByHash, rotating keyless public RPCs (roast 50) */
async function verifyEthereum(txid: string): Promise<TxidVerification> {
  const candidates = ethereumReadRpcCandidates();
  let lastReason = "אימות ETHEREUM: אף נקודת-קריאה לא נוסתה";
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txid] }),
        signal: AbortSignal.timeout(5_000),
        cache: "no-store"
      });
      if (!res.ok) {
        lastReason = `אימות ETHEREUM: ה-RPC ${new URL(url).host} דחה (HTTP ${res.status}) — עובר לנקודת-הקריאה הבאה`;
        continue; // endpoint hostile (e.g. 403) — rotate, never fake "network down"
      }
      const json = (await res.json()) as { result?: unknown };
      const tx = json?.result;
      if (tx && typeof tx === "object" && "blockNumber" in (tx as Record<string, unknown>) && (tx as Record<string, unknown>).blockNumber !== null) {
        return { verified: true, source: url, reason: `tx hash אומת מול RPC ציבורי (eth_getTransactionByHash ← ${new URL(url).host})` };
      }
      // endpoint answered definitively: tx unknown/mempool — honest unverified
      return { verified: false, source: null, reason: `ה-RPC הציבורי (${new URL(url).host}) לא מכיר את ה-hash (או שהעסקה עדיין ב-mempool) — unverified` };
    } catch {
      lastReason = `אימות ETHEREUM: ${new URL(url).host} לא נגיש (פסק-זמן) — עובר לנקודת-הקריאה הבאה`;
    }
  }
  return { verified: false, source: null, reason: `${lastReason} — unverified` };
}

/** SOLANA: read-only getTransaction on a keyless public RPC (Task 12) */
async function verifySolana(txid: string): Promise<TxidVerification> {
  const url = solanaReadRpcCandidate();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [txid, { commitment: "finalized" }] }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store"
    });
    if (!res.ok) {
      return { verified: false, source: null, reason: `אימות SOLANA נכשל: RPC ציבורי לא נגיש (HTTP ${res.status}) — unverified` };
    }
    const json = (await res.json()) as { result?: unknown };
    if (json?.result !== null && json?.result !== undefined) {
      return { verified: true, source: url, reason: "signature אומת מול RPC ציבורי (getTransaction, finalized)" };
    }
    return { verified: false, source: null, reason: "ה-RPC הציבורי לא מכיר את ה-signature (או שהוא עדיין לא finalized) — unverified" };
  } catch {
    return { verified: false, source: null, reason: "אימות SOLANA נכשל: RPC ציבורי לא נגיש מהסנדבוקס (פסק-זמן) — unverified" };
  }
}

export async function verifyTxidPublic(network: SignRequest["network"], txid: string, blockHint?: number | null): Promise<TxidVerification> {
  switch (network) {
    case "STEEM":
    case "HIVE":
      return verifyCondenserRotating(network, txid, blockHint);
    case "BLURT": {
      // Task 39: BLURT RPC rotation — beblurt + saboin verified LIVE 2026-09-09;
      // rpc.blurt.world is dead (kept last in case it revives). Transport failure
      // ("לא נגיש/פסק-זמן") advances to the next candidate; a definitive answer
      // (verified OR endpoint-answered-but-unknown-txid) returns immediately.
      // Task 47: when get_transaction is unknown (account_history lag) and the
      // signer confirmed a block, verify against the block itself — BLURT public
      // history indexing lags blocks by minutes.
      const blurtCandidates = [
        "https://rpc.beblurt.com",
        "https://blurt-rpc.saboin.com",
        "https://rpc.blurt.world"
      ];
      let last: TxidVerification = {
        verified: false,
        source: null,
        transportFailure: true,
        reason: "אימות BLURT: אף נקודת-קצה ציבורית לא נבדקה"
      };
      let answeredUrl: string | null = null; // roast 50: block-fallback rides the endpoint that actually answered
      for (const url of blurtCandidates) {
        last = await verifyCondenser(url, "BLURT", txid);
        if (last.verified) return last;
        if (last.transportFailure) continue; // roast 56: structural flag — was a Hebrew-substring match on the reason
        answeredUrl = url; // הנקודה ענתה והחזירה תשובה סופית (txid לא מוכר)
        break; // ננסה נפילה-לבלוק
      }
      if (blockHint) {
        // roast 50: was hardcoded to beblurt — if beblurt is the dead one the
        // whole block-fallback died with it; use the endpoint that answered
        const viaBlock = await verifyCondenserBlock(answeredUrl ?? blurtCandidates[0]!, "BLURT", txid, blockHint);
        if (viaBlock.verified) return viaBlock;
      }
      return last;
    }
    case "TRON":
      return verifyTron(txid);
    case "ETHEREUM":
      return verifyEthereum(txid);
    case "SOLANA":
      return verifySolana(txid);
  }
}
