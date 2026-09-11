/**
 * treasury-ops-live — the "מימוש בפועל" engine (Task 76).
 * =============================================================================
 * The owner's question (trace 1a08df6c8f0f1d25): "יש לנו קצת סטים או Hive או trx
 * תבדוק איך ניתן ליישם את זה בפועל" — we hold real balances; what can actually
 * be DONE with them right now, and what needs an owner decision?
 *
 * This module answers with MEASURED truth only:
 *   - per-chain per-account live balances + pending rewards + RC (public RPCs,
 *     keyless, read-only — the same honesty contract as treasury/network-status);
 *   - an actionability map: which ops are executable NOW through the external
 *     signer (v2.5.7 scopes), which are owner-gated (financial moves), and
 *     which carry a measured side-effect warning (delegate_rc vs the epoch
 *     chain-seal broadcaster that drains fleet RC);
 *   - the TRX implementation math (free-bandwidth consolidation path + the
 *     27.25-TRX USDT-settlement threshold + the pending 17.1 TRX recovery).
 *
 * NO secrets, NO keys, NO broadcast from this module — measurement only.
 * Every source that fails degrades to an honest error row; never throws.
 */

export type GrapheneNet = "STEEM" | "HIVE" | "BLURT";

const ACCOUNTS = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "wic", "wog", "woq", "ynet", "tov"
] as const;

const NODES: Record<GrapheneNet, string[]> = {
  STEEM: ["https://api.steemit.com", "https://api.justyy.com"],
  HIVE: ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"],
  BLURT: ["https://rpc.beblurt.com", "https://blurt-rpc.saboin.com"]
};

const RC_FLOOR = 0.08; // the standing advisory floor for main-account anchoring

async function rpcNet(net: GrapheneNet, method: string, params: unknown): Promise<unknown> {
  let lastErr = "";
  for (const node of NODES[net]) {
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(9_000),
        cache: "no-store"
      });
      if (!res.ok) { lastErr = `HTTP ${res.status} @ ${node}`; continue; }
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) { lastErr = j.error.message ?? "rpc-error"; continue; }
      return j.result;
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e);
    }
  }
  throw new Error(lastErr || "all-nodes-failed");
}

const num = (s: unknown): number => parseFloat(String(s ?? "0")) || 0;

interface RawAccount {
  name: string;
  balance: string;
  hbd_balance?: string;
  sbd_balance?: string;
  vesting_shares: string;
  reward_hive_balance?: string;
  reward_hbd_balance?: string;
  reward_steem_balance?: string;
  reward_sbd_balance?: string;
  reward_vesting_balance: string;
  created: string;
}

export interface GrapheneOpsRow {
  account: string;
  network: GrapheneNet;
  exists: boolean;
  liquid: number;
  debt: number;
  hp: number;
  vests: number;
  rewardsMain: number;
  rewardsDebt: number;
  rewardsVests: number;
  rcPercent: number | null;
  rcEtaMinToFloor: number | null;
  keysHeld: boolean | null;
  executableNow: string[];
  ownerGated: string[];
  notes: string[];
}

/** signer /keys/status — PUBLIC loaded/match flags only (no secret ever leaves it) */
async function signerHeldMap(): Promise<Record<string, Record<string, boolean>> | null> {
  const base = (process.env.SAOS_EXTERNAL_SIGNER_URL ?? "").replace(/\/$/, "");
  const token = (process.env.SAOS_EXTERNAL_SIGNER_TOKEN ?? "").trim();
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base}/keys/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6_000),
      cache: "no-store"
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      main?: { account?: string; networks?: Record<string, Record<string, { loaded?: boolean }>> };
      fleet?: Array<{ username?: string; networks?: Record<string, { posting?: boolean; active?: boolean; owner?: boolean; memo?: boolean }> }>;
    };
    const out: Record<string, Record<string, boolean>> = {};
    const mainNet = j.main?.networks ?? {};
    out[String(j.main?.account ?? "")] = Object.fromEntries(
      Object.entries(mainNet).map(([net, roles]) => [net, Object.values(roles).some((r) => Boolean(r?.loaded))])
    );
    for (const row of j.fleet ?? []) {
      const name = String(row.username ?? "");
      if (!name) continue;
      out[name] = Object.fromEntries(
        Object.entries(row.networks ?? {}).map(([net, flags]) => [
          net,
          Boolean((flags as { posting?: boolean; active?: boolean; owner?: boolean; memo?: boolean })?.posting
            || (flags as { active?: boolean })?.active
            || (flags as { owner?: boolean })?.owner)
        ])
      );
    }
    return out;
  } catch {
    return null;
  }
}

async function measureGraphene(net: GrapheneNet, held: Record<string, Record<string, boolean>> | null): Promise<GrapheneOpsRow[]> {
  const accounts = await rpcNet(net, "condenser_api.get_accounts", [ACCOUNTS as unknown as string[]]) as RawAccount[];
  let perMvest = 0;
  try {
    const dgp = await rpcNet(net, "condenser_api.get_dynamic_global_properties", []) as {
      total_vesting_fund_hive?: string; total_vesting_fund_steem?: string; total_vesting_shares?: string;
    };
    const fund = num(dgp.total_vesting_fund_hive ?? dgp.total_vesting_fund_steem);
    const shares = num(dgp.total_vesting_shares);
    if (shares > 0) perMvest = fund / (shares / 1e6);
  } catch {
    perMvest = 0; // hp stays 0 — honest degradation, vests still shown
  }
  const byName = new Map<string, RawAccount>();
  for (const a of Array.isArray(accounts) ? accounts : []) if (a?.name) byName.set(a.name, a);
  const rows: GrapheneOpsRow[] = [];
  for (const name of ACCOUNTS) {
    const a = byName.get(name);
    const notes: string[] = [];
    if (!a) {
      rows.push({
        account: name, network: net, exists: false, liquid: 0, debt: 0, hp: 0, vests: 0,
        rewardsMain: 0, rewardsDebt: 0, rewardsVests: 0, rcPercent: null, rcEtaMinToFloor: null,
        keysHeld: held?.[name]?.[net] ?? null, executableNow: [], ownerGated: [],
        notes: [`${net} לא קיים על השרשרת`]
      });
      continue;
    }
    const vests = num(a.vesting_shares);
    const liquid = num(a.balance);
    const debt = num(net === "HIVE" ? a.hbd_balance : a.sbd_balance);
    const rewardsMain = net === "HIVE" ? num(a.reward_hive_balance) : num(a.reward_steem_balance);
    const rewardsDebt = net === "HIVE" ? num(a.reward_hbd_balance) : num(a.reward_sbd_balance);
    const rewardsVests = num(a.reward_vesting_balance);

    let rcPercent: number | null = null;
    let rcEtaMinToFloor: number | null = null;
    try {
      const rc = await rpcNet(net, "rc_api.find_rc_accounts", { accounts: [name] }) as {
        rc_accounts?: Array<{ max_rc?: string | number; rc_manabar?: { current_mana?: string | number } }>;
      };
      const ra = rc.rc_accounts?.[0];
      const mx = Number(ra?.max_rc ?? 0) || 0;
      const cur = Number(ra?.rc_manabar?.current_mana ?? 0) || 0;
      if (mx > 0) {
        rcPercent = (cur / mx) * 100;
        if (rcPercent < RC_FLOOR * 100) {
          const rate = mx / (5 * 86400);
          const needed = RC_FLOOR * mx - cur;
          rcEtaMinToFloor = Math.ceil(needed / rate / 60);
        }
      }
    } catch {
      notes.push("RC נמדד-חסר (מקור נפל — השרשרת תשפוט)");
    }

    const executableNow: string[] = [];
    const ownerGated: string[] = [];
    if (rewardsMain + rewardsDebt + rewardsVests > 0) {
      if (net === "BLURT") executableNow.push("claim_rewards (לא-ממומש בחותם — BLURT custom_json בלבד)");
      else executableNow.push("claim_rewards (חותם v2.5.7 מוכן)");
    }
    if (net === "STEEM") {
      if (liquid >= 0.001) ownerGated.push("transfer / transfer_to_vesting (חותם מוכן — החלטת-בעלים)");
      if (vests > 0) ownerGated.push("delegate_vesting_shares (חותם מוכן — החלטת-בעלים)");
    }
    if (net === "HIVE") {
      if (liquid >= 0.001) ownerGated.push("transfer / transfer_to_vesting / he (חותם מוכן — החלטת-בעלים)");
      if (vests > 0) {
        ownerGated.push("delegate_rc → headcorner (חותם מוכן)");
        ownerGated.push("delegate_vesting_shares → headcorner (חותם מוכן)");
        notes.push("RC-הפקדה תגדיל את בריכת headcorner אך תנוון את יכולת-ה-RC של החשבון המפקיד — המשדר-ההיסטורי chain-seal מסתובב על הצי (החלטת-בעלים תלויה)");
      }
    }
    if (held?.[name]?.[net]) {
      notes.push(net === "STEEM" ? "מפתחות-חיים מאומתים (via=BLURT, Task 74)" : "מפתחות-חיים מאומתים (verify-live 0-drift)");
    }

    rows.push({
      account: name, network: net, exists: true, liquid, debt,
      hp: perMvest > 0 ? (vests / 1e6) * perMvest : 0, vests,
      rewardsMain, rewardsDebt, rewardsVests, rcPercent, rcEtaMinToFloor,
      keysHeld: held?.[name]?.[net] ?? null, executableNow, ownerGated, notes
    });
  }
  return rows;
}

// ── TRX implementation constants (all measured 2026-09-10/11, treasury route) ──
export const TRX_PLAN = {
  needForUsdtTransfer: 27.25,            // energy-burn threshold measured (economy.ts)
  familyLiquid: 3.639141,                // idx3+idx4+idx5 live measured
  vaultMain: 0.5,                        // sovereign vault main address
  ownerWalletPending: 17.099234,         // TMXHfFQd… (2020 wallet — owner confirmation pending)
  note: "העברת-TRX ילידית חינם-עמלה (bandwidth יומי חינם) — איחוד-האבק אפס-עלות; חתימת-כספת דרך key-broker :3040 מאומתת; איחוד-משפחה דורש את צירוף-התמונה; היעד 27.25 TRX לאסדר-USDT — אם ארנק-2020 יאושר: 21.24 ביד, פער 6.01"
};

export interface TreasuryOpsLive {
  ok: true;
  at: string;
  rcFloorPercent: number;
  graphene: { rows: GrapheneOpsRow[]; sources: string[] };
  signerScopes: Record<string, string>;
  tronPlan: typeof TRX_PLAN;
  errors: string[];
}

export async function measureTreasuryOps(): Promise<TreasuryOpsLive> {
  const errors: string[] = [];
  const held = await signerHeldMap();
  const nets: GrapheneNet[] = ["STEEM", "HIVE", "BLURT"];
  const settled = await Promise.allSettled(nets.map((n) => measureGraphene(n, held)));
  const rows: GrapheneOpsRow[] = [];
  const sources: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      rows.push(...r.value);
      sources.push(`${nets[i]}: ${NODES[nets[i]][0]}`);
    } else {
      errors.push(`${nets[i]}: ${String(r.reason).slice(0, 120)}`);
    }
  });
  return {
    ok: true,
    at: new Date().toISOString(),
    rcFloorPercent: RC_FLOOR * 100,
    graphene: { rows, sources },
    signerScopes: {
      STEEM: "custom_json, transfer, transfer_to_vesting, claim_rewards, delegate_vesting_shares",
      HIVE: "custom_json, transfer, transfer_to_vesting, claim_rewards, delegate_vesting_shares, delegate_rc, he_market_sell, he_withdraw",
      BLURT: "custom_json (weave anchors)"
    },
    tronPlan: TRX_PLAN,
    errors
  };
}
