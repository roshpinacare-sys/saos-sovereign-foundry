/**
 * external-signer-client — the foundry's ONLY view of the external signer.
 * =============================================================================
 * Task 26 (owner directive: "connect and execute"). The signer is a separate
 * process (mini-services/external-signer :3033) holding the sealed fleet
 * envelope — the golden architecture (docs/external-signer.md) stays intact:
 * the system holds no keys; the signer returns only public txids.
 *
 * This client:
 *   - GET {SAOS_EXTERNAL_SIGNER_URL}/health with Bearer token (60s cache);
 *   - exposes a SYNC cached read for sync call-sites (modes.ts/signer.ts);
 *   - fail-closed: any error → connected=false (never "trusts by default");
 *   - the token is read from env only (never logged, never returned).
 */

const URL_ENV = "SAOS_EXTERNAL_SIGNER_URL";
const TOKEN_ENV = "SAOS_EXTERNAL_SIGNER_TOKEN";
const HEALTH_TTL_MS = 60_000;

export interface ExternalSignerHealth {
  configured: boolean;
  connected: boolean;
  detail: string;
  checkedAt: string | null;
  mainAccount?: string;
  fleetAccounts?: string[];
  sealedAt?: string | null;
}

let cache: { health: ExternalSignerHealth; at: number } | null = null;
let inflight: Promise<ExternalSignerHealth> | null = null;

export function externalSignerConfigured(): boolean {
  return Boolean((process.env[TOKEN_ENV] ?? "").trim() && (process.env[URL_ENV] ?? "").trim());
}

export async function refreshExternalSignerHealth(): Promise<ExternalSignerHealth> {
  if (!externalSignerConfigured()) {
    const health: ExternalSignerHealth = { configured: false, connected: false, detail: "אין SAOS_EXTERNAL_SIGNER_URL/TOKEN — החותם-החיצוני לא מוגדר (fail-closed)", checkedAt: null };
    cache = { health, at: Date.now() };
    return health;
  }
  const base = (process.env[URL_ENV] ?? "").replace(/\/$/, "");
  const token = (process.env[TOKEN_ENV] ?? "").trim();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4_000);
    const res = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { ok?: boolean; connected?: boolean; mainAccount?: string; fleetAccounts?: string[]; sealedAt?: string };
    const health: ExternalSignerHealth = {
      configured: true,
      connected: Boolean(json.ok && json.connected),
      detail: json.ok && json.connected ? `חותם-חיצוני מחובר: ${json.mainAccount ?? "?"} + ${(json.fleetAccounts?.length ?? 1) - 1} שותפי-צי (מעטפת ${json.sealedAt ?? "?"})` : "החותם ענה אך מדווח לא-מחובר",
      checkedAt: new Date().toISOString(),
      mainAccount: json.mainAccount,
      fleetAccounts: json.fleetAccounts,
      sealedAt: json.sealedAt
    };
    cache = { health, at: Date.now() };
    return health;
  } catch (e) {
    const health: ExternalSignerHealth = { configured: true, connected: false, detail: `החותם-החיצוני לא נגיש (${String((e as Error)?.message ?? e).slice(0, 80)}) — fail-closed`, checkedAt: new Date().toISOString() };
    cache = { health, at: Date.now() };
    return health;
  }
}

/** async read: refreshes if the cache is stale */
export async function externalSignerHealth(): Promise<ExternalSignerHealth> {
  if (inflight) return inflight;
  if (cache && Date.now() - cache.at < HEALTH_TTL_MS) return cache.health;
  inflight = refreshExternalSignerHealth().finally(() => { inflight = null; });
  return inflight;
}

/** sync read for sync call-sites — reflects the LAST health check only */
export function externalSignerCached(): ExternalSignerHealth {
  return (
    cache?.health ?? {
      configured: externalSignerConfigured(),
      connected: false,
      detail: "טרם נבדק — החתימה fail-closed עד לבדיקת-בריאות ראשונה",
      checkedAt: null
    }
  );
}

/** POST a prepared payload to the signer; returns the PUBLIC result (txid) */
export async function externalSignerExecute(input: {
  requestId: string;
  network: "STEEM" | "BLURT" | "HIVE";
  kind: string;
  payload: string;
  id?: string;
  account?: string;
  /** custom_json authority level — posting (weave default) or active */
  authLevel?: "posting" | "active";
}): Promise<{ ok: boolean; txid?: string; account?: string; error?: string; confirmedBlock?: number | null; nodeTrxId?: string | null }> {
  if (!externalSignerConfigured()) return { ok: false, error: "external-signer-not-configured" };
  const base = (process.env[URL_ENV] ?? "").replace(/\/$/, "");
  const token = (process.env[TOKEN_ENV] ?? "").trim();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30_000);
    const res = await fetch(`${base}/sign`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: ctl.signal
    });
    clearTimeout(t);
    const json = (await res.json()) as { ok: boolean; txid?: string; account?: string; error?: string; confirmedBlock?: number | null; nodeTrxId?: string | null };
    return json;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

// ── Task 33: LIVE key-match snapshot (public data only) ─────────────────────
// The network-status engine used hardcoded "0/11 matches" text that went stale
// the moment the owner's keys were re-ingested and verified (Task 32). This
// reader pulls the signer's /keys/status — PUBLIC derived pubkeys + live
// on-chain match booleans only, never any secret — with a 60s cache and a
// fail-closed shape (any error ⇒ connected=false, allMatched=false).
export interface SignerNetMatch {
  total: number;
  matched: number;
  allMatched: boolean;
}
export interface SignerKeyMatches {
  connected: boolean;
  networks: string[];
  mainAccount: string | null;
  /** network → slot-match summary for the MAIN account (headcorner) */
  byNetwork: Record<string, SignerNetMatch>;
  /** fleet accounts whose loaded keys match on-chain for at least the checked network */
  fleetMatchedAccounts: number;
  fleetTotalAccounts: number;
  sealedAt: string | null;
  checkedAt: string | null;
}

const KEYS_TTL_MS = 60_000;
let keysCache: { value: SignerKeyMatches; at: number } | null = null;
let keysInflight: Promise<SignerKeyMatches> | null = null;

function emptyKeys(): SignerKeyMatches {
  return {
    connected: false,
    networks: [],
    mainAccount: null,
    byNetwork: {},
    fleetMatchedAccounts: 0,
    fleetTotalAccounts: 0,
    sealedAt: null,
    checkedAt: null
  };
}

interface KeysStatusRole {
  loaded?: boolean;
  match?: boolean | null;
}
interface KeysStatusResponse {
  ok?: boolean;
  main?: {
    account?: string;
    networks?: Record<string, Record<string, KeysStatusRole>>;
  };
  fleet?: { username?: string }[];
  sealedAt?: string;
}

export async function refreshExternalSignerKeyMatches(): Promise<SignerKeyMatches> {
  if (!externalSignerConfigured()) {
    const value = emptyKeys();
    keysCache = { value, at: Date.now() };
    return value;
  }
  const base = (process.env[URL_ENV] ?? "").replace(/\/$/, "");
  const token = (process.env[TOKEN_ENV] ?? "").trim();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5_000);
    const res = await fetch(`${base}/keys/status`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as KeysStatusResponse;
    const byNetwork: Record<string, SignerNetMatch> = {};
    const mainNets = json.main?.networks ?? {};
    for (const [net, roles] of Object.entries(mainNets)) {
      const loaded = Object.values(roles).filter((r) => r?.loaded);
      const matched = loaded.filter((r) => r.match === true);
      byNetwork[net] = { total: loaded.length, matched: matched.length, allMatched: loaded.length > 0 && matched.length === loaded.length };
    }
    const value: SignerKeyMatches = {
      connected: Boolean(json.ok),
      networks: Object.keys(mainNets),
      mainAccount: json.main?.account ?? null,
      byNetwork,
      fleetMatchedAccounts: 0,
      fleetTotalAccounts: Array.isArray(json.fleet) ? json.fleet.length : 0,
      sealedAt: json.sealedAt ?? null,
      checkedAt: new Date().toISOString()
    };
    keysCache = { value, at: Date.now() };
    return value;
  } catch {
    const value = emptyKeys();
    keysCache = { value, at: Date.now() };
    return value;
  }
}

export async function externalSignerKeyMatches(): Promise<SignerKeyMatches> {
  if (keysInflight) return keysInflight;
  if (keysCache && Date.now() - keysCache.at < KEYS_TTL_MS) return keysCache.value;
  keysInflight = refreshExternalSignerKeyMatches().finally(() => {
    keysInflight = null;
  });
  return keysInflight;
}

/** sync read for sync call-sites — reflects the LAST keys-status check only */
export function externalSignerKeyMatchesCached(): SignerKeyMatches {
  return keysCache?.value ?? emptyKeys();
}

// ── Task 38: owner-key operator login verification ───────────────────────────
// The owner logs into the foundry with THEIR OWN master key (owner/active of
// STEEM/HIVE/BLURT). Verification is delegated to the signer process, where
// the vault keys live in memory: sha256(presented) vs sha256(vault keys),
// timing-safe, plaintext never leaves the signer, never logged. Fail-closed:
// any transport/config error ⇒ match=false.
export interface OwnerLoginVerify {
  configured: boolean;
  match: boolean;
  network?: string;
  role?: string;
  account?: string;
  error?: string;
}

export async function verifyOwnerLoginKey(key: string): Promise<OwnerLoginVerify> {
  if (!externalSignerConfigured()) {
    return { configured: false, match: false, error: "external-signer-not-configured" };
  }
  const base = (process.env[URL_ENV] ?? "").replace(/\/$/, "");
  const token = (process.env[TOKEN_ENV] ?? "").trim();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4_000);
    const res = await fetch(`${base}/auth/verify-owner`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ key }),
      signal: ctl.signal
    });
    clearTimeout(t);
    const json = (await res.json()) as { ok?: boolean; match?: boolean; network?: string; role?: string; account?: string; error?: string };
    return {
      configured: true,
      match: Boolean(json.ok && json.match),
      network: json.network,
      role: json.role,
      account: json.account,
      error: json.error
    };
  } catch (e) {
    return { configured: true, match: false, error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

// warm both caches on module load (fire-and-forget; sync readers see them shortly after boot)
void refreshExternalSignerHealth().catch(() => {});
void refreshExternalSignerKeyMatches().catch(() => {});
