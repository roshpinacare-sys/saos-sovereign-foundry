import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "fs";
import os from "os";
import path from "path";
import { db } from "@/lib/db";
import { auditDroppedCount, authConfigured, currentSessionEpoch } from "@/lib/saos/auth";
import { enforceRateLimit, ruleFor } from "@/lib/saos/rate-limit";
import { saosMode } from "@/lib/saos/modes";
import { networkStatuses } from "@/lib/saos/network-status";
import { runLiveNetworkProbes, liveProbePlan, type LiveProbeResult } from "@/lib/saos/networks/live-probes";
import { hiveRcLive } from "@/lib/saos/hive-rc-live";
import { externalSignerKeyMatches } from "@/lib/saos/external-signer-client";
import { computePreflight } from "@/lib/saos/preflight";
import { gitSnapshot } from "@/lib/saos/repo-git";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/live-proof — הוכחת חיים (Task 13).
 *
 * ONE read-only endpoint that PROVES the system is alive, checked, and safe —
 * three liveness levels in a single honest payload:
 *
 *   Level 1 — system alive:  server, database (counts), auth (configured),
 *                            rate-limit (active), audit (recent), backups
 *                            (fresh/verified), repo (sync), CI (best-effort).
 *   Level 2 — networks live  read-only probes against all 6 networks
 *            for reading:    (keyless public endpoints, short timeout,
 *                            hostname-only disclosure, 60s cache).
 *   Level 3 — anchor ready:  preflight summary + signature queue + decisions.
 *
 * Iron rules honored here:
 *   - READ ONLY: no transaction, no broadcast, no signing, no wallet use.
 *   - NO SECRETS: booleans/counts/metadata only; the GitHub token used for the
 *     CI check lives at ~/.secrets/github-token, is read into memory for one
 *     short request's Authorization header, and is never echoed, logged or
 *     stored (docs/secret-hygiene.md).
 *   - ERRORS ARE DATA: every subsystem failure degrades its own field — the
 *     endpoint itself never 500s.
 */

const GITHUB_REPO = "roshpinacare-sys/saos-sovereign-foundry";
const CI_CACHE_MS = 5 * 60_000;
const BACKUP_MAX_AGE_MS = 7 * 24 * 3_600_000;

interface CiProof {
  available: boolean;
  reason?: string;
  lastRun?: {
    status: string | null;
    conclusion: string | null;
    headSha12: string | null;
    startedAt: string | null;
    event: string | null;
  };
}

let ciCache: { at: number; proof: CiProof } | null = null;

/**
 * CI status via the GitHub API — best-effort.
 * The token is read from ~/.secrets/github-token (owner asset, 0600) into
 * memory ONLY for this request's Authorization header; it is never printed,
 * logged, cached or returned. Any failure degrades to available:false.
 */
async function ciStatus(): Promise<CiProof> {
  if (ciCache && Date.now() - ciCache.at < CI_CACHE_MS) return ciCache.proof;
  const proof = await ciStatusOnce();
  ciCache = { at: Date.now(), proof };
  return proof;
}

async function ciStatusOnce(): Promise<CiProof> {
  const tokenPath = path.join(os.homedir(), ".secrets", "github-token");
  let token: string | null = null;
  try {
    if (existsSync(tokenPath)) {
      const st = statSync(tokenPath);
      // only honor the file when it is owner-only readable (0600-ish)
      if (st.isFile() && (st.mode & 0o077) === 0) {
        token = readFileSync(tokenPath, "utf8").trim(); // memory only — never surfaced
      }
    }
  } catch {
    token = null;
  }
  if (!token) {
    return { available: false, reason: "אין טוקן קריאה (~/.secrets/github-token לא זמין או הרשאות לא תקינות) — סטטוס CI לא נשלף" };
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs?per_page=5`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(3_500),
      cache: "no-store"
    });
    if (!res.ok) {
      return { available: false, reason: `GitHub API HTTP ${res.status} — סטטוס CI לא נשלף` };
    }
    const data = (await res.json()) as {
      workflow_runs?: { status?: string; conclusion?: string | null; head_sha?: string; created_at?: string; event?: string; head_branch?: string }[];
    };
    const run = (data.workflow_runs ?? []).find((r) => r.head_branch === "main") ?? data.workflow_runs?.[0] ?? null;
    if (!run) return { available: false, reason: "אין ריצות CI קיימות" };
    return {
      available: true,
      lastRun: {
        status: run.status ?? null,
        conclusion: run.conclusion ?? null,
        headSha12: run.head_sha ? run.head_sha.slice(0, 12) : null,
        startedAt: run.created_at ?? null,
        event: run.event ?? null
      }
    };
  } catch {
    return { available: false, reason: "פסק-זמן/שגיאת רשת מול GitHub API — סטטוס CI לא נשלף" };
  }
}

/** backup freshness from the authoritative OpLog (same source as preflight) */
async function backupProof(): Promise<{ lastBackupAt: string | null; lastVerified: boolean; fresh: boolean; detail: string | null }> {
  const last = await db.opLog.findFirst({ where: { op: "backup" }, orderBy: { createdAt: "desc" } });
  const fresh = last ? Date.now() - last.createdAt.getTime() < BACKUP_MAX_AGE_MS : false;
  return {
    lastBackupAt: last?.createdAt.toISOString() ?? null,
    lastVerified: last ? /verified=true/.test(last.detail ?? "") : false,
    fresh,
    detail: last?.detail ?? null
  };
}

export async function GET(req: Request) {
  const rl = enforceRateLimit("live-proof", req);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const errors: string[] = [];
  const timestamp = new Date().toISOString();
  const mode = saosMode();

  // ── Level 1: database + system ─────────────────────────────────────────
  let database: { ok: boolean; counts: Record<string, number> } = { ok: false, counts: {} };
  let service: "ok" | "degraded" | "down" = "down";
  let auditProof: { recentEvents24h: number; totalEvents: number; lastEventAt: string | null; lastEventKind: string | null; dropped: number } = {
    recentEvents24h: 0,
    totalEvents: 0,
    lastEventAt: null,
    lastEventKind: null,
    dropped: auditDroppedCount()
  };
  let backups = { lastBackupAt: null as string | null, lastVerified: false, fresh: false, detail: null as string | null };
  let sessionEpoch: string | null = null;

  try {
    const since24h = new Date(Date.now() - 24 * 3_600_000);
    const [seals, leaves, anchors, receipts, opLogs, auditTotal, audit24h, lastAudit, decisions, signRequests, epoch, backupsRes] = await Promise.all([
      db.sealRecord.count(),
      db.sealLeaf.count(),
      db.anchorTx.count(),
      db.evidenceReceipt.count(),
      db.opLog.count(),
      db.auditEvent.count(),
      db.auditEvent.count({ where: { createdAt: { gte: since24h } } }),
      db.auditEvent.findFirst({ orderBy: { createdAt: "desc" } }),
      db.decisionRecord.count(),
      db.pendingSignature.count(),
      currentSessionEpoch(),
      backupProof()
    ]);
    database = {
      ok: true,
      counts: {
        seals,
        leaves,
        anchors,
        receipts,
        opLogs,
        auditEvents: auditTotal,
        decisions,
        signRequests,
        researchFindings: await db.researchFinding.count().catch(() => 0)
      }
    };
    auditProof = {
      recentEvents24h: audit24h,
      totalEvents: auditTotal,
      lastEventAt: lastAudit?.createdAt.toISOString() ?? null,
      lastEventKind: lastAudit?.kind ?? null,
      dropped: auditDroppedCount() // roast 53 — dropped audit writes are VISIBLE, never silent
    };
    backups = backupsRes;
    // epoch metadata only — "bootstrap" = pre-revocation epoch, "rotated" =
    // revoke-all has run at least once (no session rows, no secrets here)
    sessionEpoch = epoch === "bootstrap" ? "bootstrap" : "rotated";
    service = authConfigured() ? "ok" : "degraded";
    if (!authConfigured()) errors.push("auth-unconfigured: SAOS_ADMIN_KEY_HASH חסר — מצב מופחת");
  } catch (e) {
    service = "down";
    errors.push(`database: ${e instanceof Error ? e.message : "unreachable"}`);
  }

  // ── repo snapshot (read-only git) ──────────────────────────────────────
  const snap = await gitSnapshot();
  if (!snap.available) errors.push("repo: git לא זמין — סנכרון לא ניתן לאימות");
  const repo = {
    available: snap.available,
    branch: snap.branch,
    sync: (snap.available && snap.unpushedCommits !== null ? (snap.unpushedCommits === 0 ? "synced" : "ahead") : "unknown") as "synced" | "ahead" | "unknown",
    unpushedCommits: snap.unpushedCommits,
    uncommittedFiles: snap.uncommittedFiles,
    lastCommitSha12: snap.lastCommit?.sha ?? null,
    remoteConfigured: snap.remoteConfigured,
    remoteHost: snap.remoteHost
  };

  // ── CI (best-effort, private repo via owner token — memory only) ───────
  const ci = await ciStatus();
  if (!ci.available && ci.reason) errors.push(`ci: ${ci.reason}`);

  // ── Level 2: live read-only network probes (all 6, cached 60s) ─────────
  let probes: LiveProbeResult[] = [];
  let probesCached = false;
  let probesAt = timestamp;
  try {
    const res = await runLiveNetworkProbes();
    probes = res.results;
    probesCached = res.cached;
    probesAt = res.at;
  } catch (e) {
    errors.push(`probes: ${e instanceof Error ? e.message : "probe run failed"}`);
  }

  // Task 33: live RC + live key-match snapshot replace the stale env fallback.
  const [rcLive, keysLive] = await Promise.all([hiveRcLive(), externalSignerKeyMatches()]);
  const rcPct = rcLive?.rcPct ?? Number(process.env.HIVE_RC_PCT ?? 0.6);
  const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
  const networksBase = networkStatuses(rcPct, tronEnergy, keysLive);
  const networks = networksBase.map((n) => {
    const p = probes.find((x) => x.network === n.network) ?? null;
    return {
      network: n.network,
      status: n.status,
      mode: n.mode,
      chainType: n.chainType ?? null,
      chainId: n.chainId ?? null,
      rpcStatus: n.rpcStatus ?? null,
      blocker: n.blocker,
      nextAction: n.nextAction,
      isReadyForAnchor: n.isReadyForAnchor,
      isDryRunOnly: n.isDryRunOnly,
      ownerAction: n.ownerAction,
      requiredResource: n.requiredResource,
      liveProbePossible: n.liveProbePossible ?? false,
      probe: p
        ? {
            attempted: p.attempted,
            ok: p.ok,
            source: p.source,
            sourceHost: p.sourceHost,
            headBlock: p.headBlock,
            chainIdHex: p.chainIdHex,
            headTime: p.headTime,
            latencyMs: p.latencyMs,
            reason: p.reason
          }
        : null
    };
  });
  const probedOk = probes.filter((p) => p.ok).length;
  const probedAttempted = probes.filter((p) => p.attempted).length;

  // ── Level 3: preflight + decisions + signature queue + proof anchor ────
  let preflight: Record<string, unknown> = {};
  let decisionsView: { openCritical: string[]; needsResource: string[]; openTotal: number; total: number } = {
    openCritical: [],
    needsResource: [],
    openTotal: 0,
    total: 0
  };
  let proofRoot: string | null = null;
  let proofHeight: number | null = null;
  let signatureQueue: Record<string, number> = {};
  try {
    const pf = await computePreflight(null);
    preflight = {
      readyForAnchor: pf.readyForAnchor,
      blockers: pf.blockers,
      warningsCount: pf.warnings.length,
      firstAnchorStatus: pf.firstAnchorReadiness.status,
      recommendedNetwork: pf.firstAnchorReadiness.recommendedNetwork,
      ownerAction: pf.firstAnchorReadiness.ownerAction,
      recommendedNextAction: pf.recommendedNextAction,
      runbook: pf.firstAnchorReadiness.runbook
    };
    decisionsView = {
      openCritical: pf.openCriticalDecisionKeys,
      needsResource: pf.needsResourceDecisionKeys,
      openTotal: await db.decisionRecord.count({ where: { status: "open" } }),
      total: await db.decisionRecord.count()
    };
    signatureQueue = { ...pf.signatureQueue };

    const latest = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
    proofRoot = latest?.root ?? null;
    proofHeight = latest?.height ?? null;
  } catch (e) {
    errors.push(`preflight: ${e instanceof Error ? e.message : "preflight failed"}`);
  }

  // safe-live Task 33 (honest update): the PROOF itself never transmits —
  // transactionAttempted/signingAttempted/walletUsed are structurally false for
  // this read-only endpoint. A connected external signer means a REAL broadcast
  // path exists elsewhere (gated by authority-gate + owner approval) — that is
  // disclosed honestly via safety.broadcastCapable instead of being denied.
  const transactionAttempted = false as const;
  const signingAttempted = false as const;
  const walletUsed = false as const;
  const safeLive = !transactionAttempted && !signingAttempted && !walletUsed;

  return NextResponse.json({
    ok: true,
    timestamp,
    service,
    database,
    auth: { configured: authConfigured(), sessionEpoch, revocationReady: true },
    rateLimit: {
      active: true,
      liveProofPerMinute: ruleFor("live-proof").perMinute,
      statusPerMinute: ruleFor("status").perMinute,
      sealPerMinute: ruleFor("seal").perMinute,
      authPerMinute: ruleFor("auth").perMinute
    },
    audit: auditProof,
    backups,
    repo,
    ci,
    networks,
    probesSummary: {
      attempted: probedAttempted,
      ok: probedOk,
      unreachable: probedAttempted - probedOk,
      cached: probesCached,
      at: probesAt,
      plan: liveProbePlan(),
      note: "קריאה-בלבד בכל הרשתות — אין עסקה, אין שידור, אין חתימה, אין מפתח; כישלון קריאה = הרשת אינה מאומתת חי (לעולם לא הומצא)"
    },
    preflight,
    decisions: decisionsView,
    proofRoot,
    proofHeight,
    signatureQueue,
    liveMode: {
      mode: mode.mode,
      detail: mode.detail,
      writesEnabled: mode.writesEnabled,
      liveArmed: mode.liveArmed
    },
    safeLive,
    safety: {
      broadcastCapable: mode.broadcastCapable,
      transactionAttempted,
      signingAttempted,
      walletUsed,
      note: mode.broadcastCapable
        ? "ההוכחה עצמה קריאה-בלבד — לא בוצעו שידור/חתימה/ארנק; נתיב-שידור אמיתי קיים דרך החותם-החיצוני ומוגבל על-ידי authority-gate + אישור בעלים"
        : "המערכת מוכיחה חיים בקריאה-בלבד בלבד; שידור/חתימה/ארנק לא הופעלו ואינם אפשריים עד חותם חיצוני + אישור בעלים מפורש"
    },
    errors,
    note: "הוכחת-חיים (Task 13): קריאה בלבד — אין עוגן, אין שידור, אין סודות בפלט",
    generatedBy: "GET /api/saos/live-proof"
  });
}
