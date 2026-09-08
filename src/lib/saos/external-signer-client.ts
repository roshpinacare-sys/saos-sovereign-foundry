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
export async function externalSignerExecute(input: { requestId: string; network: "STEEM"; kind: string; payload: string; id?: string; account?: string }): Promise<{ ok: boolean; txid?: string; account?: string; error?: string }> {
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
    const json = (await res.json()) as { ok: boolean; txid?: string; account?: string; error?: string };
    return json;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

// warm the cache on module load (fire-and-forget; sync readers see it shortly after boot)
void refreshExternalSignerHealth().catch(() => {});
