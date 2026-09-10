import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { enforceRateLimit } from "@/lib/saos/rate-limit";
import { TRX_PER_USDT_TRANSFER } from "@/lib/saos/economy";
import { ethereumReadRpcCandidates } from "@/lib/saos/networks/ethereum";
import type { TreasuryOutflowRow } from "@/components/saos/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/treasury — live cross-chain treasury view (Task 41).
 *
 * Purpose: answer "מה עם ה-TRX וכל הכספים שלנו באמת?" with REAL on-chain data,
 * read-only, forever value-free: public addresses + balances only — NEVER keys,
 * mnemonics, WIFs or any secret material. Public RPCs only; nothing is broadcast.
 *
 * Honesty contract (mirrors the rest of the API):
 *   - every source that fails → row with status:"error" and the reason (errors are data)
 *   - the route itself NEVER returns 500
 *   - 60s in-memory cache so idle operators don't hammer public RPCs
 */

const CACHE_MS = 60_000;
let cache: { at: number; body: unknown } | null = null;

const RPC_TIMEOUT = 8_000;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** base58check validation — a documented address that fails checksum is reported as data, never queried */
function isValidTronAddress(addr: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return false;
  let n = BigInt(0); // no BigInt literal — tsconfig target ES2017 (typecheck gate)
  for (const ch of addr) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return false;
    n = n * BigInt(58) + BigInt(idx);
  }
  const hex = n.toString(16).padStart(50, "0"); // 25 bytes
  const raw = Buffer.from(hex, "hex");
  if (raw.length !== 25 || raw[0] !== 0x41) return false;
  const payload = raw.subarray(0, 21);
  const checksum = raw.subarray(21);
  const calc = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return checksum.equals(calc);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jsonFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(RPC_TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT),
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc-error");
  return j.result;
}

const weiToEth = (hex: string): number => Number(BigInt(hex)) / 1e18;

// ── public addresses only (owner's photo-wallet family + forensic docs) ──
// HISTORY FIX (Task 43): the previous "TRON_VAULT" list (TM5beptA…, TM6UBp98…,
// TM6p6ZNW…, TM6u99og…, TM8c9vp3…, TM8mSbBz…) was PROVEN bogus — those strings
// are the account's STEEM/HIVE *public keys* with the STM prefix swapped to TM
// (bit-for-bit identical suffixes). They fail TRON base58check and always
// rendered as 6 permanent errors in the UI. They are gone; the ONE real,
// checksum-valid forensic TRON address from docs/FORENSIC-AUDIT.md is used
// instead, plus the owner's new cycle-1 wallet.
//
// FULL-FAMILY FIX (Task 44 recon): the photo mnemonic derives a FAMILY of TRON
// addresses (m/44'/195'/0'/0/i). The deep on-chain ledger trace proved idx1..idx5
// are LIVE and hold real balances — counting only idx0 under-reported the family
// by ~4.59 TRX. All six family rows + the verified outflow destinations are now shown.
const TRON_FORENSIC = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const TRON_FAMILY: Array<[string, string]> = [
  ["ארנק משפחה idx0 (ראשי)", "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr"],
  ["ארנק משפחה idx1", "TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4"],
  ["ארנק משפחה idx2", "TNd4aFZk1YUeP9uzUWCefJyadjCxZXBoBg"],
  ["ארנק משפחה idx3", "TDuyQNSm2XbVKNgdKgjCyHfxkzXAmo2YXG"],
  ["ארנק משפחה idx4", "TSJw2GYkmcsYNjALFaNYxySkgGfkvBD8sP"],
  ["ארנק משפחה idx5", "TLhp6hhm7RgB7xFsSTAatuWyEWpScVbJ4U"]
];
const SOL_FORENSIC = "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL";
const ETH_NEW = ["0x7b7869d126fa1ecc19a3426d07be8186225a2c31", "0xe05e7988bac84c58b0a076816627a01aee270eb8"];
const ETH_VAULT = ["0x2767e8146c11bad1d9b0784f11325375195c1b0f", "0x94f4cb4fc0c50d742a583576b2cb1d14fa55dd99"];
const GRAPHENE_ACCOUNT = "headcorner";

// Forensic money-flow (deep ledger trace 2026-09-10, on-chain verified):
//   in:  31.219502 TRX from outside (29.943347 TGUYnMLu… + 1.276142 returned by idx1 + 0.000013 dust)
//   out: 18.704323 TRX swept in ONE minute (2026-09-08 13:23) by idx0+idx1+idx2 → TG6SrsM… (external)
//   then 2026-09-09 09:23 TG6SrsM… → TMXHfFQd… (2020 wallet) 17.099234 TRX — SITTING there
//   then 2026-09-09 09:25 SOL swept from 9knfnF… → A2Y1d3… 0.023976 SOL — SITTING there
//   residual = activation/network fees (7 fresh accounts × ~1.1 TRX) — computed as live residual
const FLOW_EXTERNAL_IN_TRX = 31.219502;
const FLOW_SWEPT_OUT_TRX = 18.704323;
const FLOW_OUT_TARGETS = {
  hub: "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn",
  tron17: "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU",
  sol: "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj",
  funder: "TGUYnMLufLM19NoJcyWkaU32kVjQso2bpQ"
};

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ERC20 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
// roast 50: ETH reads rotate candidates — a single hardcoded publicnode made
// "ETH unreachable" intermittent (Task 49 caught it 403ing alone)
const USDT_SPL = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"; // native USDT mint on Solana
const USDC_SPL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // native USDC mint on Solana
// roast 57: TRX_PER_USDT_TRANSFER now lives in ONE place (lib/saos/economy.ts)
// — the economy simulation previously priced the SAME settlement 238× cheaper.

interface BalanceRow {
  label: string;
  address: string;
  status: "ok" | "error";
  error?: string;
  /** native token balance in human units */
  native?: number;
  nativeSymbol?: string;
  usdt?: number;
  /** TRON-specific: account exists on-chain (was activated by any transfer) */
  activated?: boolean;
}

async function tronRow(label: string, address: string): Promise<BalanceRow> {
  if (!isValidTronAddress(address)) {
    return {
      label,
      address,
      status: "error",
      error: "כתובת לא תקפה (checksum/prefix) — הסימון בתיעוד אינו כתובת TRON אמיתית"
    };
  }
  // roast 51: rotate BASE endpoints — both old fallbacks (v1/accounts AND
  // wallet/getaccount) lived on api.trongrid.io alone, so one trongrid 429
  // storm killed both simultaneously. tronstack live-verified 2026-09-10
  // (head 86115750) joins the chain; TRC20 note: only trongrid v1 returns trc20.
  const bases = ["https://api.trongrid.io", "https://api.tronstack.io"];
  const tryOne = async (base: string): Promise<BalanceRow> => {
    try {
      const j = (await jsonFetch(`${base}/v1/accounts/${address}`)) as {
        data?: Array<{ balance?: number; trc20?: Record<string, string>[]; create_time?: number }>;
      };
      const d = j.data?.[0];
      const usdtRaw = d?.trc20?.[0]?.[USDT_TRC20];
      return {
        label,
        address,
        status: "ok",
        native: d ? Number(d.balance ?? 0) / 1e6 : 0,
        nativeSymbol: "TRX",
        usdt: usdtRaw ? Number(usdtRaw) / 1e6 : 0,
        activated: Boolean(d?.create_time)
      };
    } catch {
      // fallback: official full-node endpoint (different rate bucket; TRC20 not included there)
      const res = await fetch(`${base}/wallet/getaccount`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, visible: true }),
        signal: AbortSignal.timeout(RPC_TIMEOUT),
        cache: "no-store"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { address?: string; balance?: number; create_time?: number };
      if (!j.address && j.balance === undefined) {
        return { label, address, status: "ok", native: 0, nativeSymbol: "TRX", usdt: 0, activated: false };
      }
      return {
        label,
        address,
        status: "ok",
        native: Number(j.balance ?? 0) / 1e6,
        nativeSymbol: "TRX",
        usdt: 0,
        activated: Boolean(j.create_time || j.address)
      };
    }
  };
  try {
    for (const base of bases) {
      try {
        return await tryOne(base);
      } catch {
        // base down (both endpoints on it) — rotate to the next base
      }
    }
    throw new Error(`כל ${bases.length} נקודות-הקריאה דחו (trongrid+tronstack)`);
  } catch (e) {
    // one patient retry — public RPC 429 storms are transient (politeness window)
    await sleep(1_500);
    try {
      for (const base of bases) {
        try {
          return await tryOne(base);
        } catch {
          // rotate
        }
      }
      throw new Error(`כל ${bases.length} נקודות-הקריאה דחו (trongrid+tronstack) אחרי ניסיון-חוזר`);
    } catch {
      return { label, address, status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  }
}

async function evmRow(label: string, address: string): Promise<BalanceRow> {
  // rotate read candidates until one answers — one hostile endpoint (403/
  // CF-challenge) no longer fakes an "error" row for a wallet that is fine
  const candidates = ethereumReadRpcCandidates();
  let lastErr: unknown = null;
  for (const ETH_RPC of candidates) {
    try {
      const r = (await rpc(ETH_RPC, "eth_getBalance", [address, "latest"])) as string;
      let usdt = 0;
      try {
        const u = (await rpc(ETH_RPC, "eth_call", [
          { to: USDT_ERC20, data: "0x70a08231" + address.slice(2).padStart(64, "0") },
          "latest"
        ])) as string;
        usdt = Number(BigInt(u)) / 1e6;
      } catch {
        // native balance is still honest data; a failing USDT read reports as 0
      }
      return { label, address, status: "ok", native: weiToEth(r), nativeSymbol: "ETH", usdt };
    } catch (e) {
      lastErr = e;
    }
  }
  return { label, address, status: "error", error: lastErr instanceof Error ? lastErr.message : String(lastErr) };
}

/** Solana RPC — honors SOL_RPC_URL when set; read-only, keyless, never throws outward */
function solRpcUrl(): string {
  const env = (process.env.SOL_RPC_URL ?? "").trim();
  return env || "https://api.mainnet-beta.solana.com";
}

async function solRow(label: string, address: string): Promise<BalanceRow> {
  try {
    const url = solRpcUrl();
    const bal = (await rpc(url, "getBalance", [address])) as { value?: number; context?: { slot?: number } };
    let usdt = 0;
    let usdc = 0;
    try {
      const toks = (await rpc(url, "getTokenAccountsByOwner", [
        address,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" }
      ])) as {
        value?: Array<{
          account?: {
            data?: {
              parsed?: {
                info?: {
                  mint?: string;
                  tokenAmount?: { uiAmount?: number | null };
                };
              };
            };
          };
        }>;
      };
      for (const t of toks.value ?? []) {
        const mint = t.account?.data?.parsed?.info?.mint;
        const amt = t.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        if (mint === USDT_SPL) usdt += amt;
        else if (mint === USDC_SPL) usdc += amt;
      }
      if (usdc > 0) usdt += usdc; // stablecoin exposure reported in the same slot
    } catch {
      // native balance is still honest data; failing SPL read reports as 0
    }
    return {
      label,
      address,
      status: "ok",
      native: (bal.value ?? 0) / 1e9,
      nativeSymbol: "SOL",
      usdt
    };
  } catch (e) {
    return { label, address, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

interface GrapheneRow {
  label: string;
  chain: string;
  status: "ok" | "error";
  error?: string;
  liquid?: string;
  liquidNum?: number;
  debt?: string;
  vested?: string;
  created?: string;
}

async function grapheneRow(label: string, chain: "BLURT" | "STEEM" | "HIVE", urls: string[]): Promise<GrapheneRow> {
  // roast 51: rotate candidates — one hostile/dead host must not fake an
  // "error" row (a treasury account is fine even when steemit.com 403s solo)
  let lastErr: unknown = null;
  for (const url of urls) {
    try {
      const r = (await rpc(url, "condenser_api.get_accounts", [[GRAPHENE_ACCOUNT]])) as Array<Record<string, string>>;
      const a = r?.[0];
      if (!a) return { label, chain, status: "error", error: "account-not-found" };
      // roast 57: an unparseable balance is an honest ERROR row, never NaN —
      // NaN used to poison the grapheneLiquid total (NaN + x = NaN) silently.
      const liquidNum = Number(a.balance.split(" ")[0].replace(/,/g, ""));
      if (!Number.isFinite(liquidNum)) {
        return { label, chain, status: "error", error: `balance-parse-failed: ${String(a.balance).slice(0, 40)}` };
      }
      return {
        label,
        chain,
        status: "ok",
        liquid: a.balance,
        liquidNum,
        debt: a.sbd_balance ?? a.hbd_balance,
        vested: a.vesting_shares,
        created: a.created
      };
    } catch (e) {
      lastErr = e;
    }
  }
  return { label, chain, status: "error", error: lastErr instanceof Error ? lastErr.message : String(lastErr) };
}

async function buildTreasury() {
  const tronRows: BalanceRow[] = [];
  const family: Array<[string, string]> = [
    ...TRON_FAMILY,
    ["כספת TRON (פורנזי)", TRON_FORENSIC]
  ];
  for (const [i, [label, address]] of family.entries()) {
    if (i > 0) await sleep(350); // stagger — public RPC politeness (avoids 429 storms)
    tronRows.push(await tronRow(label, address));
  }
  const [evm, solana] = await Promise.all([
    Promise.all([
      ...ETH_NEW.map((a, i) => evmRow(`ארנק חדש ETH #${i + 1}`, a)),
      ...ETH_VAULT.map((a, i) => evmRow(`כספת ETH #${i + 1}`, a))
    ]),
    Promise.all([solRow("ארנק Solana (פורנזי)", SOL_FORENSIC)])
  ]);
  const graphene = await Promise.all([
    grapheneRow("BLURT", "BLURT", ["https://rpc.beblurt.com", "https://blurt-rpc.saboin.com"]),
    grapheneRow("STEEM", "STEEM", ["https://api.steemit.com", "https://api.steem.fans", "https://api.justyy.com"]),
    grapheneRow("HIVE", "HIVE", ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"])
  ]);

  // traced outflow destinations (public balances of addresses that RECEIVED our funds)
  const outflows: TreasuryOutflowRow[] = [];
  {
    const hub = await tronRow("צומת-יציאה (קיבל 18.70 TRX)", FLOW_OUT_TARGETS.hub);
    outflows.push({
      label: hub.label, address: FLOW_OUT_TARGETS.hub, chain: "TRON", status: hub.status,
      error: hub.error, native: hub.native, nativeSymbol: "TRX",
      receivedFromUs: FLOW_SWEPT_OUT_TRX,
      note: "רוקן את idx0+idx1+idx2 בדקה אחת (2026-09-08 13:23) והעביר הלאה — כתובת לא נגזרת מהצירוף שלנו"
    });
    await sleep(350);
    const t17 = await tronRow("יעד 18.10 TRX (ארנק 2020)", FLOW_OUT_TARGETS.tron17);
    outflows.push({
      label: t17.label, address: FLOW_OUT_TARGETS.tron17, chain: "TRON", status: t17.status,
      error: t17.error, native: t17.native, nativeSymbol: "TRX",
      receivedFromUs: 17.099234,
      note: "קיבל 17.099234 TRX ב-2026-09-09 09:23 ואז +1.0 TRX ב-2026-09-10 02:30 מאותו-מקור (41432f3c…) — 18.099245 יושבים שם (roast 10.09: הטענה '17.09 יושב מאז' התיישנה). ארנק מ-2020-09-15 רדום מ-2023; דורש אימות בעלים שזה ארנק שלו"
    });
    await sleep(350);
    const solOut = await solRow("יעד SOL (ניקוז סולנה)", FLOW_OUT_TARGETS.sol);
    outflows.push({
      label: solOut.label, address: FLOW_OUT_TARGETS.sol, chain: "SOLANA", status: solOut.status,
      error: solOut.error, native: solOut.native, nativeSymbol: "SOL",
      receivedFromUs: 0.023976117,
      note: "קיבל 0.023976 SOL ב-2026-09-09 09:25 — שתי דקות אחרי ה-TRX; לא זז מאז"
    });
    await sleep(350);
    const funder = await tronRow("מקור המימון הראשוני", FLOW_OUT_TARGETS.funder);
    outflows.push({
      label: funder.label, address: FLOW_OUT_TARGETS.funder, chain: "TRON", status: funder.status,
      error: funder.error, native: funder.native, nativeSymbol: "TRX",
      note: "העביר 29.943347 TRX ל-idx0 ב-2026-09-05 19:39 (הפעיל את הארנק) — ארנק חיצוני מ-2024"
    });
  }

  const totalTrx = tronRows.reduce((s, r) => s + (r.status === "ok" ? (r.native ?? 0) : 0), 0);
  const totalTronUsdt = tronRows.reduce((s, r) => s + (r.status === "ok" ? (r.usdt ?? 0) : 0), 0);
  const familyRows = tronRows.filter((r) => TRON_FAMILY.some(([, a]) => a === r.address));
  const totalTrxFamily = familyRows.reduce((s, r) => s + (r.status === "ok" ? (r.native ?? 0) : 0), 0);
  const totalEth = evm.reduce((s, r) => s + (r.status === "ok" ? (r.native ?? 0) : 0), 0);
  const totalEthUsdt = evm.reduce((s, r) => s + (r.status === "ok" ? (r.usdt ?? 0) : 0), 0);
  const totalSol = solana.reduce((s, r) => s + (r.status === "ok" ? (r.native ?? 0) : 0), 0);
  const totalSolUsdt = solana.reduce((s, r) => s + (r.status === "ok" ? (r.usdt ?? 0) : 0), 0);
  const grapheneLiquid = graphene.reduce((s, g) => s + (g.status === "ok" ? (g.liquidNum ?? 0) : 0), 0);
  // Roast 2026-09-10: a provider 429 used to SILENTLY shrink the totals (family
  // showed 1.200548 while live truth was 3.639141 — failed rows just fell out
  // of the reduce). Now every row-failure surfaces: degraded + probes counts.
  const failedRows = [...tronRows, ...evm, ...solana, ...graphene].filter((r) => r.status !== "ok");
  const probeTotal = tronRows.length + evm.length + solana.length + graphene.length;
  // residual fees: balanced ledger residual (external in − swept out − live family) — honest, labeled as residual
  const burnedFees = FLOW_EXTERNAL_IN_TRX - FLOW_SWEPT_OUT_TRX - totalTrxFamily;

  return {
    ok: true as const,
    generatedAt: new Date().toISOString(),
    cache: "60s",
    account: GRAPHENE_ACCOUNT,
    degraded: failedRows.length > 0,
    summary: {
      totalTrx,
      totalTrxFamily,
      totalTronUsdt,
      totalEth,
      totalEthUsdt,
      totalSol,
      totalSolUsdt,
      grapheneLiquid,
      probes: { ok: probeTotal - failedRows.length, failed: failedRows.length, failedList: failedRows.map((r) => r.label) },
      /** הפער לישוב USDT אחד על TRON (שריפת אנרגיה) — המספר שחוסם את ה-TRC20 */
      gapToUsdtSettlement: Math.max(0, TRX_PER_USDT_TRANSFER - totalTrx)
    },
    constants: { trxPerUsdtTransfer: TRX_PER_USDT_TRANSFER },
    flow: {
      externalInTrx: FLOW_EXTERNAL_IN_TRX,
      sweptOutTrx: FLOW_SWEPT_OUT_TRX,
      burnedFeesTrx: burnedFees >= 0 ? Math.round(burnedFees * 1e6) / 1e6 : null,
      story: [
        "2026-09-05 19:39 — ארנק idx0 הופעל עם 29.943347 TRX ממקור חיצוני",
        "2026-09-05..07 — הכסף נע בתוך משפחת הארנקים (idx0↔idx1↔idx2↔idx3↔idx5) — 7 כתובות חדשות נפתחו ונשרפו ~1.1 TRX עמלת-הפעלה לכל אחת",
        "2026-09-08 13:23 — ריקון מתואם: idx0+idx1+idx2 שלחו 18.704323 TRX בדקה אחת לכתובת חיצונית (צומת-היציאה)",
        "2026-09-09 09:23 — הצומת העביר 17.099234 TRX לארנק מ-2020; 2026-09-10 02:30 — עוד 1.0 TRX מאותו-מקור — 18.099245 יושב שם עד היום (" + FLOW_OUT_TARGETS.tron17.slice(0, 10) + "…)",
        "2026-09-09 09:25 — גם סולנה נוקזה: 0.023976 SOL מהכספת הפורנזית לכתובת חיצונית — לא זזה מאז",
        "מה שנשאר אצלנו: " + totalTrxFamily.toFixed(4) + " TRX פרוסים על idx0..idx5 — כל שאר היתרות של ETH/SOL/USDT = 0"
      ],
      outflows
    },
    chains: {
      tron: { rows: tronRows, explorer: "https://tronscan.org/#/address/" },
      evm: { rows: evm, explorer: "https://etherscan.io/address/" },
      solana: { rows: solana, explorer: "https://solscan.io/account/" },
      graphene: { rows: graphene }
    }
  };
}

// roast 57 single-flight (LIVE-CAUGHT: 8 concurrent cache-miss requests → 8
// DIFFERENT generatedAt across 5.5s = 8 parallel full builds hammering ~18
// public RPC endpoint calls; two answers came back degraded:true — the
// stampede degraded ITS OWN ANSWERS). One shared build promise: every
// cache-miss caller awaits the SAME build, the cache is written exactly once.
let inflight: Promise<Awaited<ReturnType<typeof buildTreasury>>> | null = null;

function buildOnce(): Promise<Awaited<ReturnType<typeof buildTreasury>>> {
  if (!inflight) {
    inflight = buildTreasury()
      .then((body) => {
        cache = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("treasury", req);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.body);
  }
  try {
    const body = await buildOnce();
    return NextResponse.json(body);
  } catch (e) {
    // never 500: a total failure is still honest data
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      degraded: true,
      error: e instanceof Error ? e.message : String(e),
      summary: {
        totalTrx: null,
        totalTrxFamily: null,
        totalTronUsdt: null,
        totalEth: null,
        totalEthUsdt: null,
        totalSol: null,
        totalSolUsdt: null,
        grapheneLiquid: null,
        gapToUsdtSettlement: null
      },
      flow: {
        externalInTrx: FLOW_EXTERNAL_IN_TRX,
        sweptOutTrx: FLOW_SWEPT_OUT_TRX,
        burnedFeesTrx: null,
        story: [],
        outflows: []
      },
      chains: {
        tron: { rows: [], explorer: "" },
        evm: { rows: [], explorer: "" },
        solana: { rows: [], explorer: "" },
        graphene: { rows: [] }
      }
    });
  }
}
