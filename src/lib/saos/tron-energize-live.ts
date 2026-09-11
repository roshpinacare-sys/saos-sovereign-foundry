/**
 * tron-energize-live — live TRON energy/balance measurement (the Task-26-c
 * doctrine applied to TRON): replaces the FROZEN `TRON_ENERGY` env field
 * measurement (2026-09-08) as the primary source for the dashboard, with the
 * env value kept as the fail-closed fallback.
 *
 * Iron rules (identical to hive-rc-live.ts):
 *   - READ ONLY: getaccount on public keyless endpoints — no transaction,
 *     no broadcast, no signing, no key material anywhere.
 *   - ADDRESSES ONLY: the probe reads PUBLIC addresses supplied via
 *     TRON_PROBE_ADDRESSES (comma-separated). Addresses are public chain
 *     identifiers — private keys NEVER enter this module (registry stays
 *     outside the app; the gold rule is untouched).
 *   - ROTATION: one hostile host (trongrid 429-storms are proven on this env)
 *     must not fake "energy unmeasurable" — candidates tried in order.
 *   - 10-minute cache; NEVER throws; honest null on total failure (callers
 *     fall back to the env value and disclose that).
 *   - Energy proxy = frozenV2 with code "1" (ENERGY resource, StakeV2).
 *     frozenV2 without code is BANDWIDTH — counted separately, never conflated.
 */

const CACHE_TTL_MS = 10 * 60_000;

const TRON_CANDIDATES: string[] = [
  ...(process.env.TRON_RPC_URL ? [process.env.TRON_RPC_URL] : []),
  "https://api.trongrid.io",
  "https://api.tronstack.io"
];

/** public vault addresses only — populated from wallets-registry (addresses, never keys) */
function probeAddresses(): string[] {
  return (process.env.TRON_PROBE_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)); // base58check T-address shape
}

export interface TronAddressMeasure {
  /** base58 T-address (public identifier) */
  address: string;
  /** account exists on-chain (activated) */
  exists: boolean;
  /** liquid TRX in sun */
  balanceSun: number;
  /** frozenV2 staked for ENERGY in sun (code "1") — the energy proxy */
  energyStakedSun: number;
  /** frozenV2 staked for BANDWIDTH in sun (no code) */
  bandwidthStakedSun: number;
}

export interface TronEnergyMeasure {
  /** false when the probe was skipped (no addresses configured) or every host failed */
  probed: boolean;
  at: string;
  /** hostname of the endpoint that answered — never the URL */
  sourceHost: string | null;
  addresses: number;
  /** addresses with any on-chain footprint (exists) */
  activated: number;
  /** addresses holding liquid TRX or any stake */
  withResources: number;
  totalBalanceSun: number;
  totalEnergyStakedSun: number;
  /** the number the gates consume: >0 ⇒ direct anchor path, 0 ⇒ transit */
  energyUnits: number;
  perAddress: TronAddressMeasure[];
  reason: string;
}

interface RawAccount {
  balance?: number;
  frozenV2?: { amount?: number; code?: number }[];
}

let cache: { at: number; value: TronEnergyMeasure } | null = null;

export async function tronEnergyLive(): Promise<TronEnergyMeasure | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const addresses = probeAddresses();
  if (addresses.length === 0) {
    return null; // honest skip — no configured addresses, env fallback disclosed by caller
  }
  for (const host of TRON_CANDIDATES) {
    try {
      const perAddress: TronAddressMeasure[] = [];
      for (const address of addresses) {
        const res = await fetch(`${host}/walletsolidity/getaccount`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address, visible: true }),
          signal: AbortSignal.timeout(4_000),
          cache: "no-store"
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const acc = (await res.json()) as RawAccount;
        const frozen = Array.isArray(acc.frozenV2) ? acc.frozenV2 : [];
        const energyStakedSun = frozen
          .filter((f) => f?.code === 1)
          .reduce((s, f) => s + (Number(f.amount) || 0), 0);
        const bandwidthStakedSun = frozen
          .filter((f) => f?.code !== 1)
          .reduce((s, f) => s + (Number(f.amount) || 0), 0);
        perAddress.push({
          address,
          exists: Boolean(acc && Object.keys(acc).length > 0),
          balanceSun: Number(acc.balance) || 0,
          energyStakedSun,
          bandwidthStakedSun
        });
      }
      const totalBalanceSun = perAddress.reduce((s, a) => s + a.balanceSun, 0);
      const totalEnergyStakedSun = perAddress.reduce((s, a) => s + a.energyStakedSun, 0);
      const value: TronEnergyMeasure = {
        probed: true,
        at: new Date().toISOString(),
        sourceHost: new URL(host).host,
        addresses: perAddress.length,
        activated: perAddress.filter((a) => a.exists).length,
        withResources: perAddress.filter((a) => a.balanceSun > 0 || a.energyStakedSun > 0 || a.bandwidthStakedSun > 0).length,
        totalBalanceSun,
        totalEnergyStakedSun,
        energyUnits: totalEnergyStakedSun > 0 ? 1 : 0,
        perAddress,
        reason:
          totalEnergyStakedSun > 0
            ? `נמדד חי: אנרגיה מוקפאת קיימת (${totalEnergyStakedSun.toLocaleString()} sun) — מסלול-ישיר`
            : `נמדד חי: אפס אנרגיה מוקפאת בכל ${perAddress.length} הכתובות (יתרה נוזלת ${totalBalanceSun.toLocaleString()} sun) — נשארים ב-transit`
      };
      cache = { at: Date.now(), value };
      return value;
    } catch {
      // hostile/429 host — rotate to the next candidate, never throw
    }
  }
  return cache?.value ?? null; // every candidate failed — stale cache or honest null
}
