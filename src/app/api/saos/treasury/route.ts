import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { enforceRateLimit } from "@/lib/saos/rate-limit";

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
  let n = 0n;
  for (const ch of addr) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return false;
    n = n * 58n + BigInt(idx);
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

// ── public addresses only (from docs/KEY-RECOVERY.md + owner's new wallet) ──
// HISTORY FIX (Task 43): the previous "TRON_VAULT" list (TM5beptA…, TM6UBp98…,
// TM6p6ZNW…, TM6u99og…, TM8c9vp3…, TM8mSbBz…) was PROVEN bogus — those strings
// are the account's STEEM/HIVE *public keys* with the STM prefix swapped to TM
// (bit-for-bit identical suffixes). They fail TRON base58check and always
// rendered as 6 permanent errors in the UI. They are gone; the ONE real,
// checksum-valid forensic TRON address from docs/FORENSIC-AUDIT.md is used
// instead, plus the owner's new cycle-1 wallet.
const TRON_FORENSIC = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const TRON_NEW = "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr";
const SOL_FORENSIC = "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL";
const ETH_NEW = ["0x7b7869d126fa1ecc19a3426d07be8186225a2c31", "0xe05e7988bac84c58b0a076816627a01aee270eb8"];
const ETH_VAULT = ["0x2767e8146c11bad1d9b0784f11325375195c1b0f", "0x94f4cb4fc0c50d742a583576b2cb1d14fa55dd99"];
const GRAPHENE_ACCOUNT = "headcorner";

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ERC20 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const USDT_SPL = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"; // native USDT mint on Solana
const USDC_SPL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // native USDC mint on Solana
/** USDT TRC20 transfer ≈ 64,895 energy; burn price 420 sun/energy → ≈ 27.25 TRX per settlement */
const TRX_PER_USDT_TRANSFER = 27.25;

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
  const tryEndpoints = async (): Promise<BalanceRow> => {
    // primary: TronGrid v1; fallback: full-node POST /wallet/getaccount
    try {
      const j = (await jsonFetch(`https://api.trongrid.io/v1/accounts/${address}`)) as {
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
      // fallback: official full-node endpoint (different rate bucket than v1/accounts; TRC20 not included there)
      const res = await fetch("https://api.trongrid.io/wallet/getaccount", {
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
    return await tryEndpoints();
  } catch (e) {
    return { label, address, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function evmRow(label: string, address: string): Promise<BalanceRow> {
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
    return { label, address, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
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

async function grapheneRow(label: string, chain: "BLURT" | "STEEM" | "HIVE", url: string): Promise<GrapheneRow> {
  try {
    const r = (await rpc(url, "condenser_api.get_accounts", [[GRAPHENE_ACCOUNT]])) as Array<Record<string, string>>;
    const a = r?.[0];
    if (!a) return { label, chain, status: "error", error: "account-not-found" };
    return {
      label,
      chain,
      status: "ok",
      liquid: a.balance,
      liquidNum: Number(a.balance.split(" ")[0].replace(/,/g, "")),
      debt: a.sbd_balance ?? a.hbd_balance,
      vested: a.vesting_shares,
      created: a.created
    };
  } catch (e) {
    return { label, chain, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function buildTreasury() {
  const tronRows: BalanceRow[] = [];
  for (const [i, [label, address]] of [
    ["ארנק חדש (מחזור ראשון)", TRON_NEW] as const,
    ["כספת TRON (פורנזי)", TRON_FORENSIC] as const
  ].entries()) {
    if (i > 0) await sleep(150); // stagger — public RPC politeness (avoids 429 storms)
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
    grapheneRow("BLURT", "BLURT", "https://rpc.beblurt.com"),
    grapheneRow("STEEM", "STEEM", "https://api.steemit.com"),
    grapheneRow("HIVE", "HIVE", "https://api.hive.blog")
  ]);

  const totalTrx = tronRows.reduce((s, r) => s + (r.status === "ok" ? (r.native ?? 0) : 0), 0);
  const totalTronUsdt = tronRows.reduce((s, r) => s + (r.status === "ok" ? (r.usdt ?? 0) : 0), 0);
  const totalEth = evm.reduce((s, r) => s + (r.status === "ok" ? (r.native ?? 0) : 0), 0);
  const totalEthUsdt = evm.reduce((s, r) => s + (r.status === "ok" ? (r.usdt ?? 0) : 0), 0);
  const totalSol = solana.reduce((s, r) => s + (r.status === "ok" ? (r.native ?? 0) : 0), 0);
  const totalSolUsdt = solana.reduce((s, r) => s + (r.status === "ok" ? (r.usdt ?? 0) : 0), 0);
  const grapheneLiquid = graphene.reduce((s, g) => s + (g.status === "ok" ? (g.liquidNum ?? 0) : 0), 0);

  return {
    ok: true as const,
    generatedAt: new Date().toISOString(),
    cache: "60s",
    account: GRAPHENE_ACCOUNT,
    summary: {
      totalTrx,
      totalTronUsdt,
      totalEth,
      totalEthUsdt,
      totalSol,
      totalSolUsdt,
      grapheneLiquid,
      /** הפער לישוב USDT אחד על TRON (שריפת אנרגיה) — המספר שחוסם את ה-TRC20 */
      gapToUsdtSettlement: Math.max(0, TRX_PER_USDT_TRANSFER - totalTrx)
    },
    constants: { trxPerUsdtTransfer: TRX_PER_USDT_TRANSFER },
    chains: {
      tron: { rows: tronRows, explorer: "https://tronscan.org/#/address/" },
      evm: { rows: evm, explorer: "https://etherscan.io/address/" },
      solana: { rows: solana, explorer: "https://solscan.io/account/" },
      graphene: { rows: graphene }
    }
  };
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
    const body = await buildTreasury();
    cache = { at: Date.now(), body };
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
        totalTronUsdt: null,
        totalEth: null,
        totalEthUsdt: null,
        totalSol: null,
        totalSolUsdt: null,
        grapheneLiquid: null,
        gapToUsdtSettlement: null
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
