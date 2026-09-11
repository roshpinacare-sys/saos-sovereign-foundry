/**
 * Typed API client + shared query store for the SAOS command center.
 *
 * Error discipline (mirrors the API's own):
 *   network           — fetch itself failed (server unreachable)
 *   auth              — 401: sensitive op without/with-bad session
 *   auth-unconfigured — 403: server has no SAOS_ADMIN_KEY_HASH (fail-closed)
 *   rate              — 429: rate limited (Retry-After honored by caller)
 *   api               — HTTP 200 with ok:false (the API's "errors are data" rule)
 *   parse             — response was not valid JSON
 *
 * The store is a tiny external store (useSyncExternalStore): per-key cache,
 * fetch-once per session per key, manual refresh, no polling — the operator
 * decides when to refresh, so idle tabs never generate traffic.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { clsx } from "clsx";
import { fmtTime } from "@/components/ui/kit";
import type { ErrorKind } from "@/components/ui/kit";

export interface SaosError {
  kind: ErrorKind;
  message?: string;
  retryAfterSec?: number;
}

export type SaosSnapshot<T> =
  | { state: "loading" }
  | { state: "error"; err: SaosError; lastChecked: string | null }
  | { state: "ready"; data: T; lastChecked: string };

interface Entry {
  state: "loading" | "ready" | "error";
  data?: unknown;
  err?: SaosError;
  lastChecked?: string | null;
  promise?: Promise<void>;
  version: number;
}

const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
/**
 * fetcher registry (roast 55): every key that was ever fetched registers the
 * exact fetcher that produced its data. "רענן הכול" refreshes THIS set —
 * everything the session has actually displayed — instead of a hardcoded
 * subset that silently skipped most panels.
 */
const fetchers = new Map<string, () => Promise<unknown>>();

function notify() {
  for (const l of listeners) l();
}

function ensureEntry(key: string): Entry {
  let e = store.get(key);
  if (!e) {
    e = { state: "loading", lastChecked: null, version: 0 };
    store.set(key, e);
  }
  return e;
}

export function classify(status: number): SaosError {
  if (status === 401) return { kind: "auth", message: "auth-required" };
  if (status === 403) return { kind: "auth-unconfigured", message: "auth-unconfigured" };
  if (status === 429) return { kind: "rate", message: "rate-limited" };
  return { kind: "server", message: `HTTP ${status}` };
}

export async function saosFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store"
    });
  } catch {
    throw { kind: "network" } as SaosError;
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    if (res.status !== 429) throw classify(res.status);
    // roast 55: the API reports retryAfterSec in the body AND Retry-After header —
    // both used to be discarded here, so callers could not honor the wait.
    let retryAfterSec: number | undefined;
    try {
      const b = (await res.json()) as { retryAfterSec?: unknown } | null;
      if (b && typeof b.retryAfterSec === "number" && Number.isFinite(b.retryAfterSec)) {
        retryAfterSec = b.retryAfterSec;
      }
    } catch {
      /* body not JSON — fall through to the header */
    }
    if (retryAfterSec === undefined) {
      const h = Number(res.headers.get("retry-after"));
      if (Number.isFinite(h) && h > 0) retryAfterSec = h;
    }
    throw { ...classify(res.status), retryAfterSec } as SaosError;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw { kind: "parse" } as SaosError;
  }
  if (res.status !== 200) throw { ...classify(res.status), message: (body as { error?: string })?.error };
  const b = body as T & { ok?: boolean; error?: string; retryAfterSec?: number };
  if (b && b.ok === false) throw { kind: "api", message: b.error, retryAfterSec: b.retryAfterSec } as SaosError;
  return b as T;
}

async function runFetch<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const entry = ensureEntry(key);
  entry.state = "loading";
  entry.version += 1;
  notify();
  fetchers.set(key, fetcher as () => Promise<unknown>);
  // roast 55: a fetcher that throws SYNCHRONOUSLY used to bypass the whole
  // chain — entry.promise never set, callers awaiting it (refresh-all button)
  // hung forever. Pull the call inside the promise boundary.
  const p = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      entry.data = data;
      entry.state = "ready";
      entry.err = undefined;
      entry.lastChecked = new Date().toISOString();
    })
    .catch((e: SaosError) => {
      entry.state = "error";
      entry.err = { kind: e?.kind ?? "server", message: e?.message, retryAfterSec: e?.retryAfterSec };
      entry.lastChecked = new Date().toISOString();
    })
    .finally(() => {
      entry.promise = undefined;
      notify();
    });
  entry.promise = p;
  return p;
}

/** refresh a key even if it already has data; returns when done */
export function refreshKey<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  return runFetch(key, fetcher);
}

/** drop one key (after mutations that change its data) */
export function invalidateKey(key: string): void {
  store.delete(key);
  notify();
}

/** subscribe hook — fetches when enabled, caches per key for the session */
export function useSaos<T>(key: string, fetcher: () => Promise<T>, enabled = true): SaosSnapshot<T> & { refresh: () => void; refreshing: boolean } {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  const entry = useSyncExternalStore(
    subscribe,
    () => {
      const e = ensureEntry(key);
      return `${e.state}:${e.version}:${e.lastChecked ?? ""}`;
    },
    () => "loading:0:"
  );
  void entry;

  // auto-fetch once per key (effect, not render — refs are read only here)
  useEffect(() => {
    if (!enabled) return;
    const e = ensureEntry(key);
    if (!e.promise && e.state === "loading" && !e.data && (!e.err || e.lastChecked === null)) {
      e.promise = runFetch(key, fetcherRef.current);
    }
  }, [key, enabled]);

  // read the (possibly updated) snapshot from the store
  const e = ensureEntry(key);

  const refresh = useCallback(() => {
    void refreshKey(key, fetcherRef.current);
  }, [key]);

  if (e.state === "error") {
    return { state: "error", err: e.err!, lastChecked: e.lastChecked ?? null, refresh, refreshing: e.promise !== undefined };
  }
  if (e.state === "ready") {
    return { state: "ready", data: e.data as T, lastChecked: e.lastChecked!, refresh, refreshing: e.promise !== undefined };
  }
  return { state: "loading", refresh, refreshing: e.promise !== undefined };
}

/** refresh several keys at once — resolves when all done */
export function refreshMany(jobs: { key: string; fetcher: () => Promise<unknown> }[]): Promise<void> {
  return Promise.all(jobs.map((j) => refreshKey(j.key, j.fetcher))).then(() => undefined);
}

/**
 * roast 55: refresh EVERY key this session has actually displayed (each
 * with its own registered fetcher) — the honest version of "רענן הכול".
 * Returns the number of panels refreshed.
 */
export function refreshAllRegistered(): Promise<number> {
  const jobs = [...fetchers.entries()];
  return Promise.all(jobs.map(([key, fetcher]) => refreshKey(key, fetcher))).then(() => jobs.length);
}

/** helper for POST/PATCH actions with unified error toasts */
export async function saosAction<T>(path: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; err: SaosError }> {
  try {
    const data = await saosFetch<T>(path, init);
    return { ok: true, data };
  } catch (e) {
    const err = e as SaosError;
    return { ok: false, err: { kind: err?.kind ?? "server", message: err?.message, retryAfterSec: err?.retryAfterSec } };
  }
}

export function errText(err: SaosError | undefined): string {
  if (!err) return "";
  const base: Record<ErrorKind, string> = {
    network: "שגיאת רשת",
    auth: "נדרשת התחברות",
    "auth-unconfigured": "הרשאות לא מוגדרות על השרת",
    rate: "הגבלת קצב",
    api: "השרת דיווח כישלון",
    parse: "תשובה לא תקינה",
    server: "שגיאת שרת"
  };
  return clsx(base[err.kind], err.message ? `: ${err.message}` : "");
}

/** endpoint paths — single source of truth for the UI */
export const EP = {
  status: "/api/saos/status",
  preflight: "/api/saos/anchor-preflight",
  liveProof: "/api/saos/live-proof",
  verifyChain: (q = "") => `/api/saos/verify-chain${q}`,
  signer: "/api/saos/signer",
  plans: "/api/saos/plans",
  audit: (take = 50) => `/api/saos/audit?take=${take}`,
  liveGate: "/api/saos/live-gate",
  kernel: "/api/saos/kernel",
  repoStatus: "/api/saos/repo-status",
  decisions: "/api/saos/decisions",
  auth: "/api/saos/auth",
  revokeAll: "/api/saos/auth/revoke-all",
  seal: "/api/saos/seal",
  anchorReverify: "/api/saos/anchor-reverify",
  ownerKeys: "/api/saos/owner-keys",
  keysMap: "/api/saos/keys-map",
  verifyLive: "/api/saos/verify-live",
  agentBridge: "/api/saos/agent-bridge",
  research: "/api/saos/research",
  breakthroughDemo: "/api/saos/breakthrough-demo",
  treasury: "/api/saos/treasury",
  treasuryOps: "/api/saos/treasury-ops"
} as const;

export function lastCheckedText(iso: string | null): string {
  return iso ? `עודכן ${fmtTime(iso)}` : "טרם נבדק";
}
