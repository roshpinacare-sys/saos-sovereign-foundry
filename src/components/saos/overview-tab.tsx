"use client";

import {
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  FileLock2,
  GitBranch,
  Globe,
  KeyRound,
  ListChecks,
  LogIn,
  ReceiptText,
  Rocket,
  Server,
  ShieldAlert,
  Target,
  Wallet
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Badge,
  Btn,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckRow,
  EmptyState,
  ErrorState,
  LoadingPanel,
  MetaRows,
  Mono,
  Panel,
  Stat,
  cn,
  fmtDateTime
} from "@/components/ui/kit";
import { EP, errText, refreshKey, saosFetch, useSaos } from "./api";
import { LiveProofCard } from "./live-proof-card";
import { ANCHOR_STATUS, NETWORK_STATUS } from "./labels";
import type { AuthStateResponse, DecisionsResponse, KeysMapResponse, PreflightResponse, RepoStatusResponse, StatusResponse } from "./types";

/** which screen handles each preflight blocker — priority mirrors the server's own recommendedNextAction order */
function blockerTab(blockerIds: string[], hasOpenSignature: boolean): string {
  if (blockerIds.includes("backup-fresh-verified") || blockerIds.includes("auth-ready")) return "security";
  if (blockerIds.includes("seal-present") || blockerIds.includes("chain-intact")) return "chain";
  if (blockerIds.includes("network-resources")) return "networks";
  if (blockerIds.includes("mode-allows-broadcast")) return "decisions";
  if (blockerIds.includes("signature-request-open") || hasOpenSignature) return "signatures";
  return "chain";
}

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const statusQ = useSaos<StatusResponse>("status", () => saosFetch<StatusResponse>(EP.status));
  const preflightQ = useSaos<PreflightResponse>("preflight", () => saosFetch<PreflightResponse>(EP.preflight));
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => saosFetch<RepoStatusResponse>(EP.repoStatus));
  const decQ = useSaos<DecisionsResponse>("decisions", () => saosFetch<DecisionsResponse>(EP.decisions));

  const ready = statusQ.state === "ready" && preflightQ.state === "ready" && repoQ.state === "ready" && decQ.state === "ready";
  if (!ready) {
    if (statusQ.state === "error" || preflightQ.state === "error" || repoQ.state === "error" || decQ.state === "error") {
      const firstErr = [statusQ, preflightQ, repoQ, decQ].find((q) => q.state === "error");
      return (
        <ErrorState
          kind={firstErr && firstErr.state === "error" ? firstErr.err.kind : "server"}
          detail={firstErr && firstErr.state === "error" ? errText(firstErr.err) : undefined}
          onRetry={() => {
            statusQ.refresh();
            preflightQ.refresh();
            repoQ.refresh();
            decQ.refresh();
          }}
        />
      );
    }
    return <LoadingPanel rows={6} label="סקירה כללית" />;
  }

  const status = statusQ.data;
  const preflight = preflightQ.data;
  const repo = repoQ.data;
  const decisions = decQ.data;
  const latestSeal = status.seals[0] ?? null;
  const blockers = preflight.blockers;
  const warnings = preflight.warnings;
  const targetTab = blockerTab(blockers.map((b) => b.id), preflight.pendingSignatureQueue.open > 0);

  return (
    <div className="space-y-4">
      <div className="animate-rise">
        <h2 className="text-lg font-bold leading-tight">
          <span className="text-gradient-gold">סקירה כללית — Command Center</span>
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>מה המצב עכשיו, מה חסום, ומה הפעולה הבאה — משוך מנתוני</span>
          <Mono className="text-zinc-400">/api/saos/*</Mono>
          <span>חיים בלבד</span>
        </p>
      </div>

      {/* the single recommended action */}
      <Card className={blockers.length > 0 ? "border-rose-500/40" : "border-emerald-500/40"}>
        <CardHeader>
          <CardTitle icon={<Target className="size-4 text-amber-400" aria-hidden />}>פעולה מומלצת אחת</CardTitle>
          <Badge tone={preflight.readyForAnchor ? "ok" : "danger"}>
            {preflight.readyForAnchor ? "מוכן לעוגן" : `לא מוכן לעוגן · ${blockers.length} חסימות`}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-semibold leading-relaxed text-zinc-100">{preflight.recommendedNextAction}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => onNavigate(targetTab)} ariaLabel="מעבר למסך שבו מבוצעת הפעולה המומלצת">
              <Rocket className="size-3.5" aria-hidden />
              מעבר לביצוע
            </Btn>
            <span className="text-[11px] text-zinc-500">מקור: /api/saos/anchor-preflight · {fmtDateTime(preflight.generatedAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* כל המפתחות על הראשי — Task 45 (owner directive 2026-09-10) */}
      <MyKeysPanel />

      {/* first-anchor readiness (Task 11) */}
      <FirstAnchorCard readiness={preflight.firstAnchorReadiness} generatedAt={preflight.generatedAt} onNavigate={onNavigate} />

      {/* הוכחת חיים — Live Proof (Task 13): system + 6-network read-only probes + safety posture */}
      <LiveProofCard />

      {/* open critical decisions — must surface as blockers (Task 11 part ד) */}
      {decisions.decisions.filter((d) => d.critical && d.recordedStatus === "open").length > 0 && (
        <Panel
          title="החלטות בעלים קריטיות פתוחות — חוסמות התקדמות"
          icon={<ShieldAlert className="size-4 text-rose-400" aria-hidden />}
          source="/api/saos/decisions · critical+open"
          lastChecked={decQ.lastChecked}
          onRefresh={decQ.refresh}
          refreshing={decQ.refreshing}
          actions={
            <Btn variant="ghost" size="sm" onClick={() => onNavigate("decisions")} ariaLabel="מעבר למסך החלטות הבעלים לסגירה">
              לסגירה במסך ההחלטות
            </Btn>
          }
        >
          <ul className="space-y-2">
            {decisions.decisions
              .filter((d) => d.critical && d.recordedStatus === "open")
              .map((d) => (
                <li key={d.key} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-zinc-100">{d.name}</span>
                    <Badge tone="danger">קריטית · פתוחה</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{d.requiredOwnerAction}</p>
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {/* status stat row */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="מצב מערכת" value={status.mode} tone={status.mode === "dry-run" ? "info" : status.mode === "live" ? "warn" : "default"} hint={status.broadcastCapable ? "שידור אפשרי" : "אפס שידור"} />
        <Stat label="גובה שרשרת" value={latestSeal ? <Mono>{latestSeal.height}</Mono> : "—"} tone={latestSeal ? "gold" : "default"} hint={latestSeal ? "חותמה אחרונה" : "אין חותמות"} />
        <Stat label="חסימות פעילות" value={blockers.length} tone={blockers.length ? "danger" : "ok"} hint={warnings.length ? `${warnings.length} אזהרות` : "אין אזהרות"} />
        <Stat label="החלטות פתוחות" value={decisions.counts.open} tone={decisions.counts.openCritical ? "warn" : "ok"} hint={`${decisions.counts.openCritical} קריטיות`} />
        <Stat label="סנכרון ריפו" value={repo.git.available ? (repo.git.unpushedCommits === 0 && repo.git.uncommittedFiles === 0 ? "מסונכרן" : `${repo.git.uncommittedFiles ?? 0} שינויים · ${repo.git.unpushedCommits ?? 0} לדחיפה`) : "—"} tone={repo.git.available ? (repo.git.unpushedCommits === 0 ? "ok" : "warn") : "default"} />
        <Stat label="גיבוי מאומת" value={repo.backups.lastVerifiedOk ? "תקין" : "חסר"} tone={repo.backups.lastVerifiedOk ? "ok" : "danger"} hint={repo.backups.lastVerifiedAt ? fmtDateTime(repo.backups.lastVerifiedAt) : "הרץ bun run backup"} />
      </div>

      {/* blockers */}
      <Panel
        title="חסימות פעילות ואזהרות"
        icon={<ShieldAlert className="size-4 text-rose-400" aria-hidden />}
        source="/api/saos/anchor-preflight"
        lastChecked={preflightQ.lastChecked}
        onRefresh={preflightQ.refresh}
        refreshing={preflightQ.refreshing}
      >
        {blockers.length === 0 && warnings.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden /> אין חסימות ואין אזהרות — כל {preflight.checks.length} בדיקות ה-preflight עברו.
          </div>
        ) : (
          <div className="space-y-2">
            {preflight.checks
              .filter((c) => c.status !== "pass")
              .map((c) => (
                <CheckRow key={c.id} status={c.status} title={c.id} detail={c.detail} />
              ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* server + DB health */}
        <Panel
          title="בריאות שרת ומסד-נתונים"
          icon={<Server className="size-4 text-emerald-400" aria-hidden />}
          source="/api/saos/status"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
        >
          <MetaRows
            rows={[
              { label: "שרת API", value: status.ok ? "מגיב (HTTP 200)" : "לא מגיב" },
              { label: "מסד נתונים (SQLite)", value: status.opsLogged !== undefined ? `נגיש · ${status.opsLogged} רישומי תפעול` : "—", mono: false },
              { label: "שכבת הרשאות", value: status.security.authConfigured ? "מוגדרת (hash בלבד)" : "לא מוגדרת — fail-closed" },
              { label: "הגבלת קצב", value: status.security.rateLimit.active ? `פעילה · status ${status.security.rateLimit.status}/דק' · seal ${status.security.rateLimit.seal}/דק'` : "כבויה" },
              { label: "כתיבה", value: status.writesEnabled ? "מאושרת (dry-run)" : "נדחית במצב הנוכחי" },
              { label: "שידור חיצוני", value: status.broadcastCapable ? "אפשרי" : "לא אפשרי — אין חותם מחובר" },
              // roast 63: supervisor truth (served since Task 62) finally rendered —
              // the screen may only claim service liveness from the supervisor itself.
              ...(status.supervisor && status.supervisor.length > 0
                ? [{
                    label: "מפקח-שירותים",
                    value: `${status.supervisor.filter((s) => s.alive && !s.disabled).length}/${status.supervisor.length} חיים — ${status.supervisor.map((s) => `${s.name} ${s.disabled ? "(מנוטרל)" : s.alive ? "✓" : "✗"}`).join(" · ")}`
                  }]
                : [])
            ]}
          />
          <div className="mt-3 flex items-center gap-2">
            <Btn
              variant="outline"
              size="sm"
              ariaLabel="הרץ selftest של הקרנל — בדיקה חיה"
              onClick={async () => {
                // roast 63: raw fetch with no catch — a network failure left the
                // "מריץ selftest…" toast hanging forever. Wrapped + honest count
                // derived from result.checks.length (the suite grows; "7/7" was
                // a frozen number like the rest of this class).
                const tid = toast.info("מריץ selftest…");
                try {
                  const res = await saosFetch<{ ok: boolean; result?: { checks?: { pass: boolean }[] }; error?: string }>(EP.kernel);
                  const checks = res.result?.checks ?? [];
                  const passed = checks.filter((c) => c.pass).length;
                  if (checks.length > 0 && passed === checks.length) toast.success(`selftest ${passed}/${checks.length} עבר — הקרנל דטרמיניסטי ותקין`);
                  else toast.error(`selftest נכשל: ${passed}/${checks.length} עברו${res.error ? ` — ${res.error}` : ""}`);
                } catch (e) {
                  const err = e as { kind?: string; message?: string };
                  toast.error(`selftest נכשל: ${err?.kind === "auth" ? "נדרשת התחברות" : err?.message ?? "שגיאת רשת"}`);
                } finally {
                  toast.dismiss(tid);
                }
              }}
            >
              <ListChecks className="size-3.5" aria-hidden />
              הרץ selftest קרנל
            </Btn>
          </div>
        </Panel>

        {/* networks mini */}
        <Panel
          title="רשתות חיצוניות — מצב כנה"
          icon={<GitBranch className="size-4 text-sky-400" aria-hidden />}
          source="/api/saos/status · networks"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
          actions={
            <Btn variant="ghost" size="sm" onClick={() => onNavigate("networks")} ariaLabel="מעבר למסך הרשתות המלא">
              לפירוט
            </Btn>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {status.networks.map((n) => {
              const info = NETWORK_STATUS[n.status] ?? { label: n.status, tone: "neutral" as const };
              return (
                <div key={n.network} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-bold text-zinc-200">{n.network}</span>
                    <Badge tone={info.tone}>{info.label}</Badge>
                  </div>
                  <div className="mt-1.5 space-y-1 text-[10px] leading-tight text-zinc-500">
                    <div>{n.isDryRunOnly ? "dry-run בלבד" : "מסלול ישיר"}</div>
                    <div>{n.isReadyForAnchor ? "מוכנה לעוגן" : "לא מוכנה לעוגן"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* recent seals + receipts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="חותמות אחרונות"
          icon={<Database className="size-4 text-amber-400" aria-hidden />}
          source="/api/saos/status · seals[8]"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
          actions={
            <Btn variant="ghost" size="sm" onClick={() => onNavigate("chain")} ariaLabel="מעבר למסך השרשרת המלא">
              לשרשרת
            </Btn>
          }
        >
          {status.seals.length === 0 ? (
            <EmptyState
              title="אין חותמות בשרשרת"
              explanation="השרשרת ריקה — לא בוצעה עדיין אף פעימת איטום בסביבה זו. אין נתונים מומצאים; השרשרת נבנית רק מפעימות אמיתיות."
              nextAction="מסך שרשרת ואימות → הרץ פעימה (POST /seal) כדי ליצור את החותמה הראשונה."
            />
          ) : (
            <ul className="space-y-2" aria-label="ארבע חותמות אחרונות">
              {status.seals.slice(0, 4).map((s) => (
                <li key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="gold">height <Mono>{s.height}</Mono></Badge>
                    <Mono className="text-zinc-400">{s.root.slice(0, 16)}…</Mono>
                    <span className="text-[10px] text-zinc-500">{fmtDateTime(s.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">{s.leaves} עלים</span>
                    {s.anchors.map((a, ai) => {
                      const info = ANCHOR_STATUS[a.status] ?? ANCHOR_STATUS.pending;
                      return (
                        <Badge key={`${a.network}:${ai}`} tone={info.tone} title={a.gate ?? undefined}>
                          {a.network}: {info.label}
                        </Badge>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="זרם קבלות-ראיות אחרון"
          icon={<ReceiptText className="size-4 text-zinc-500" aria-hidden />}
          source="/api/saos/status · receipts[10]"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
        >
          {status.receipts.length === 0 ? (
            <EmptyState
              title="אין קבלות"
              explanation="שרשרת הקבלות (hash-chained receipts) ריקה — כל פעולה ראויה-ראיה תוסיף קבלה כאן."
              nextAction="הרץ selftest או פעימה כדי ליצור את הקבלה הראשונה."
            />
          ) : (
            <ul className="scroll-slim max-h-64 space-y-1.5 overflow-y-auto pl-1" aria-label="שמונה קבלות אחרונות">
              {status.receipts.slice(0, 8).map((r, i) => (
                <li key={r.digest} className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-1.5">
                  <Badge tone="neutral">{r.kind}</Badge>
                  <Mono className="min-w-0 flex-1 truncate text-zinc-400" title={r.digest}>
                    {r.digest}
                  </Mono>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{fmtDateTime(r.at)}</span>
                  <span className="sr-only">קבלה {i + 1}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ─── First-anchor readiness card (Task 11 part ה) ────────────────────────────

function FirstAnchorCard({
  readiness,
  generatedAt,
  onNavigate
}: {
  readiness: PreflightResponse["firstAnchorReadiness"];
  generatedAt: string;
  onNavigate: (tab: string) => void;
}) {
  const statusInfo =
    readiness.status === "not-ready"
      ? { label: "לא מוכן", tone: "danger" as const, icon: <ShieldAlert className="size-4 text-rose-400" aria-hidden /> }
      : readiness.status === "partial"
        ? { label: "מוכן חלקית", tone: "warn" as const, icon: <Rocket className="size-4 text-amber-400" aria-hidden /> }
        : { label: "מוכן בתנאי", tone: "info" as const, icon: <CheckCircle2 className="size-4 text-sky-400" aria-hidden /> };
  return (
    <Panel
      title="עוגן ראשון — מוכנות"
      icon={statusInfo.icon}
      source="/api/saos/anchor-preflight · firstAnchorReadiness"
      lastChecked={generatedAt}
      onRefresh={undefined}
      actions={<Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>}
      className={cn(readiness.status === "not-ready" && "border-rose-500/30")}
    >
      <MetaRows
        rows={[
          { label: "רשת מומלצת", value: readiness.recommendedNetwork ?? "—", mono: true },
          { label: "נימוק", value: readiness.recommendedReason },
          { label: "משאב נדרש", value: readiness.requiredResource },
          { label: "פעולת בעלים", value: readiness.ownerAction },
          { label: "החלטות קריטיות פתוחות", value: readiness.openCriticalDecisions },
          { label: "נוהל מלא", value: readiness.runbook, mono: true }
        ]}
      />
      {readiness.blockers.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {readiness.blockers.map((b) => (
            <li key={b.id} className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-rose-400" aria-hidden />
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-zinc-200" dir="ltr">{b.id}</div>
                <p className="text-[11px] leading-relaxed text-zinc-400">{b.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 flex items-center gap-2 text-xs text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden /> אין חוסמים קשים — המוכנות מוגבלת לחתימה חיצונית ולאישור בעלים בלבד.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        הסטטוס כנה: גם כשהכול ירוק, עוגן ראשון נותר &quot;מוכן בתנאי&quot; עד אישור בעלים מפורש וחתימה חיצונית — המערכת אינה מציגה עצמה כמוכנה לעוגן אמיתי בזמן שהיא חסומה.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="outline" size="sm" onClick={() => onNavigate("networks")} ariaLabel="מעבר למסך הרשתות לבחירת יעד">
          בחירת רשת-יעד
        </Btn>
        <Btn variant="outline" size="sm" onClick={() => onNavigate("decisions")} ariaLabel="מעבר לסגירת החלטות חוסמות">
          סגירת החלטות
        </Btn>
      </div>
    </Panel>
  );
}

// ─── MyKeysPanel (Task 45) — כל המפתחות על המסך הראשי, מסודרים ──────────────
// Owner directive 2026-09-10: "אני לא רוצה על הקובץ אני רוצה על הראשי וזהו
// או כל מפתח כמו שצריך מסודר" — no more file-hunting: every key, its status
// and its place, right here. Discipline mirrors the API: admin-key material
// is revealable (app-synthetic, rotateable); chain-key material is NEVER
// rendered — verdicts and public addresses only.

function copyText(value: string, what: string): void {
  if (!navigator.clipboard) {
    toast.error("הדפדפן לא מאפשר העתקה — סמן והעתק ידנית");
    return;
  }
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`${what} הועתק`))
    .catch(() => toast.error("ההעתקה נכשלה"));
}

function AddrRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-1.5">
      <span className="w-24 shrink-0 truncate text-[10px] text-zinc-500 sm:w-32" title={label}>{label}</span>
      <Mono className="min-w-0 flex-1 truncate text-[10px] text-zinc-300" title={address}>{address}</Mono>
      <button
        type="button"
        onClick={() => copyText(address, "כתובת")}
        className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-emerald-400"
        aria-label={`העתק את הכתובת של ${label}`}
      >
        <Copy className="size-3" aria-hidden />
        <span className="sr-only">העתק</span>
      </button>
    </div>
  );
}

function KeySlotBadge({ label, slot }: { label: string; slot: { loaded: boolean; match?: boolean | null } | undefined }) {
  if (!slot) return <Badge tone="neutral">{label}: —</Badge>;
  // roast 63: match===null means "never verified live" — it used to render the
  // same green ok tone as a verified match (with a tooltip claiming live
  // match). Unverified is its own honest state (mirrors security-tab).
  const tone = slot.match === true ? "ok" : slot.match === false ? "danger" : "neutral";
  const title = slot.match === true ? "טעון ותואם לרשות-החיה בשרשרת" : slot.match === false ? "לא תואם — מפתח ישן" : "טעון — טרם אומת מול השרשרת";
  return (
    <Badge tone={tone} title={title}>
      {label}: {slot.loaded ? (slot.match === true ? "טעון+תואם" : slot.match === false ? "סוטה" : "טעון (לא-אומת)") : "לא טעון"}
    </Badge>
  );
}

export function MyKeysPanel() {
  const keysQ = useSaos<KeysMapResponse>("keys-map", () => saosFetch<KeysMapResponse>(EP.keysMap));
  const authQ = useSaos<AuthStateResponse>("auth", () => saosFetch<AuthStateResponse>(EP.auth));
  const [revealed, setRevealed] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const authenticated = authQ.state === "ready" ? authQ.data.authenticated : null;
  const actor = authQ.state === "ready" ? authQ.data.actor : null;

  const quickLogin = async () => {
    setLoggingIn(true);
    try {
      const r = await fetch(EP.auth, { cache: "no-store" });
      const j = (await r.json()) as AuthStateResponse;
      if (j.authenticated) {
        await refreshKey("auth", () => saosFetch<AuthStateResponse>(EP.auth));
        toast.success(`מחובר — ${j.actor}`);
      } else {
        toast.error(j.error ? `הכניסה נדחתה: ${j.error}` : "הכניסה נדחתה");
      }
    } catch {
      toast.error("שגיאת רשת בכניסה-המהירה");
    } finally {
      setLoggingIn(false);
    }
  };

  const chain = keysQ.state === "ready" ? keysQ.data.chainKeys : undefined;
  const networks = chain?.reachable ? chain.networks ?? {} : {};

  return (
    <Panel
      title="המפתחות שלי — הכל כאן על הראשי, מסודר"
      icon={<KeyRound className="size-4 text-amber-400" aria-hidden />}
      source="/api/saos/keys-map"
      lastChecked={keysQ.state === "ready" ? keysQ.data.generatedAt ?? keysQ.lastChecked : keysQ.state === "error" ? keysQ.lastChecked : null}
      onRefresh={keysQ.refresh}
      refreshing={keysQ.refreshing}
      actions={
        authenticated === null ? (
          <Badge tone="neutral">…</Badge>
        ) : authenticated ? (
          <Badge tone="ok" title={actor ?? undefined}>מחובר ✓ {actor && actor !== "cookie" ? `· ${actor}` : ""}</Badge>
        ) : (
          <Badge tone="warn">לא מחובר</Badge>
        )
      }
    >
      {keysQ.state === "error" ? (
        <div className="space-y-2">
          <p className="text-xs text-rose-300">{errText(keysQ.err)}</p>
          <Btn variant="outline" size="sm" onClick={keysQ.refresh} ariaLabel="נסה שוב לטעון את מפת-המפתחות">נסה שוב</Btn>
        </div>
      ) : keysQ.state !== "ready" || !keysQ.data.admin ? (
        <p className="flex items-center gap-2 text-xs text-zinc-500"><span className="pulse-dot inline-block size-1.5 rounded-full bg-emerald-400" aria-hidden /> טוען מפת-מפתחות…</p>
      ) : (
        <div className="space-y-4">
          {/* ── 0. מרכז-החיבור — Task 64: האם הכל חובר? התשובה החיה, ללא חיפוש ── */}
          {keysQ.data.connection && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-200">
                  <Server className="size-3.5" aria-hidden /> מרכז-החיבור — הכל מחובר?
                </span>
                {(() => {
                  const svc = keysQ.data.connection?.services ?? [];
                  const alive = svc.filter((s) => s.alive).length;
                  const v = keysQ.data.connection?.vault;
                  const allOk = svc.length > 0 && alive === svc.length && v?.reachable && (v.summary?.drift ?? 1) === 0;
                  return <Badge tone={allOk ? "ok" : "warn"}>{allOk ? "הכל מחובר וחי" : `חיבור חלקי — ${alive}/${svc.length} שירותים`}</Badge>;
                })()}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(keysQ.data.connection.services ?? []).map((s) => (
                  <Badge key={s.name} tone={s.alive ? "ok" : "danger"} title={`:${s.port}`}>{s.alive ? "✓" : "✗"} {s.name}</Badge>
                ))}
                {keysQ.data.connection.vault.reachable ? (
                  <Badge tone="ok" title={keysQ.data.connection.vault.sealedAt ? `נאטם ${keysQ.data.connection.vault.sealedAt}` : undefined}>
                    כספת: {keysQ.data.connection.vault.summary?.ok ?? "?"} סלוטים מאומתים-חי · סטיות: {keysQ.data.connection.vault.summary?.drift ?? "?"}
                  </Badge>
                ) : (
                  <Badge tone="danger">כספת לא נגישה</Badge>
                )}
              </div>
              {(() => {
                // Task 65: the vault-state line is DERIVED (accounts/slots live)
                // — the frozen "=== 16" check went silent the moment the fleet
                // came home (92 slots) and never lied, but also never told the
                // truth. Derived-or-silence, per roast-63 discipline.
                const v = keysQ.data.connection?.vault;
                if (!v?.fleetAllConnected) return null;
                const accts = v.vaultAccountCount;
                const slots = v.summary?.ok;
                return (
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                    מצב-המפתחות המלא: כל {accts} חשבונות-הכספת חיים ({slots} סלוטים מאומתים-חי) — ראשי STEEM·HIVE·BLURT × 4 תפקידים + הצי HIVE·BLURT × 4 תפקידים. הכל נגזר, נטען ומאומת מול השרשרת החיה.
                  </p>
                );
              })()}
            </div>
          )}

          {/* ── 0-a. מישור-STEEM (steemit) — roast-66: המישור שהיה בלתי-נראה, עכשיו נמדד-חי ──
              The owner caught it: "לכולם חסר steemit". Everything here is derived
              from the signer's live probe — existence, balances, divergence,
              held-key verdicts. Derived-or-silence: no probe → no section. */}
          {(() => {
            const sp = keysQ.data.connection?.steemPlane;
            if (!sp?.reachable) return null;
            const rows = sp.accounts ?? [];
            const sum = sp.summary;
            const connected = rows.filter((r) => r.exists && Object.values(r.roles ?? {}).every((s) => s.match === true)).length;
            const missing = rows.filter((r) => r.exists && Object.values(r.roles ?? {}).some((s) => s.match !== true));
            const allGood = missing.length === 0;
            return (
              <div className="rounded-xl border border-teal-400/20 bg-teal-400/[0.04] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-teal-200">
                    <Globe className="size-3.5" aria-hidden /> מישור-STEEM (steemit) — נמדד-חי מהשרשרת
                  </span>
                  <Badge tone={allGood ? "ok" : "warn"} title={sp.measuredAt ? `נמדד ${sp.measuredAt}` : undefined}>
                    {allGood ? "כל-החשבונות מחוברים ל-steemit" : `${connected}/${rows.filter((r) => r.exists).length} חשבונות מחוברים · ${missing.length} עם-מפתח-חסר`}
                  </Badge>
                  <Badge tone="neutral">
                    יתרות: {sum?.totalLiquid ?? "?"} STEEM + {sum?.totalSbd ?? "?"} SBD + {sum?.totalHp ?? "?"} HP
                  </Badge>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
                  כל {sum?.accountsTotal ?? rows.length} החשבונות קיימים ב-steemit (נוצרו 2018, לפני-הפיצול). {sum?.probed ?? 0} מפתחות-כספת נבדקו מול רשויות-ה-STEEM החיות — הפסקי-דין למטה נגזרים, לא קפואים.
                </p>
                <div className="scroll-slim mt-2 max-h-64 space-y-1.5 overflow-y-auto pl-1">
                  {rows.map((r) => {
                    const roleVals = Object.values(r.roles ?? {});
                    const allMatch = r.exists && roleVals.length > 0 && roleVals.every((s) => s.match === true);
                    const noneMatch = r.exists && roleVals.length > 0 && roleVals.every((s) => s.match !== true);
                    const div = r.divergence ? Object.values(r.divergence).filter((v) => v !== null) : [];
                    const unchanged = div.length > 0 && div.every((v) => v === "same");
                    return (
                      <div key={r.name} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5">
                        <span dir="ltr" className="text-left"><Mono className="text-[11px] font-bold text-zinc-100">{r.name}</Mono></span>
                        {r.exists ? (
                          <>
                            {allMatch ? (
                              <Badge tone="ok">מחובר-ל-steemit ({roleVals.filter((s) => s.match === true).length}/4)</Badge>
                            ) : noneMatch ? (
                              <Badge tone="warn">קיים-בשרשרת · מפתח-STEEM חסר (רשויות-סובבו)</Badge>
                            ) : (
                              <Badge tone="warn">חיבור-חלקי ({roleVals.filter((s) => s.match === true).length}/4)</Badge>
                            )}
                            <span className="text-[10px] text-zinc-500">{r.liquid ?? "—"} · {r.sbd ?? "—"} · {r.hp ?? "—"} HP</span>
                            {unchanged ? <Badge tone="info" title="רשויות-ה-STEEM זהות ל-HIVE — לא סובבו מאז-2018; הסיסמה-המקורית תחבר את שתי-השרשראות">STEEM≡HIVE (מקורי)</Badge> : null}
                          </>
                        ) : (
                          <Badge tone="neutral">לא-קיים-ב-STEEM</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── 0-b. פערים-פתוחים — כל פער עם סגירה בצעד-אחד ── */}
          {keysQ.data.openGaps && keysQ.data.openGaps.length > 0 && (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
                  <ListChecks className="size-3.5" aria-hidden /> פערים-פתוחים ({keysQ.data.openGaps.length}) — לכל אחד סגירה בצעד-אחד
                </span>
              </div>
              <div className="scroll-slim mt-2 max-h-64 space-y-2 overflow-y-auto pl-1">
                {keysQ.data.openGaps.map((g) => (
                  <div key={g.id} className="rounded-lg border border-zinc-800/70 bg-zinc-950/60 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={g.state === "waiting-owner" ? "warn" : "neutral"}>{g.state === "waiting-owner" ? "ממתין לבעלים" : "חסום-חוץ"}</Badge>
                      <span className="text-[11px] font-bold text-zinc-200">{g.title}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">{g.detail}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-emerald-300/90"><span className="font-bold">סגירה:</span> {g.oneStep}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 1. כניסה — one screen, zero files ── */}
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-200">
                <LogIn className="size-3.5" aria-hidden /> כניסה
              </span>
              {keysQ.data.login?.devAutoSession && <Badge tone="info">כניסה-אוטומטית פעילה (dev)</Badge>}
              <div className="ms-auto">
                {authenticated ? (
                  <Btn variant="outline" size="sm" onClick={quickLogin} loading={loggingIn} ariaLabel="רענן את ההתחברות">רענן התחברות</Btn>
                ) : (
                  <Btn size="sm" onClick={quickLogin} loading={loggingIn} ariaLabel="התחברות מהירה בלחיצה אחת">
                    <LogIn className="size-3.5" aria-hidden /> התחברות בלחיצה
                  </Btn>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
              נתיבי-כניסה: {keysQ.data.login?.hint ?? "—"} · ההתחברות מזהה אוטומטית איזה מפתח הוזן.
            </p>
          </div>

          {/* ── 2. מפתח-אדמין — the key itself, on the main screen ── */}
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
                <KeyRound className="size-3.5" aria-hidden /> מפתח-אדמין (המפתח של הקונסולה)
              </span>
              {keysQ.data.admin.hashMatch === true ? (
                <Badge tone="ok">hash תואם — עובד מול הכניסה</Badge>
              ) : keysQ.data.admin.hashMatch === false ? (
                <Badge tone="danger">hash לא תואם</Badge>
              ) : (
                <Badge tone="danger">המפתח לא נמצא</Badge>
              )}
              {keysQ.data.admin.source && <span className="text-[10px] text-zinc-500" dir="ltr">מקור: {keysQ.data.admin.source}</span>}
              <div className="ms-auto flex gap-1.5">
                <Btn variant="outline" size="sm" onClick={() => setRevealed((v) => !v)} ariaLabel={revealed ? "הסתר את מפתח-האדמין" : "גלה את מפתח-האדמין"}>
                  {revealed ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                  {revealed ? "הסתר" : "גלה"}
                </Btn>
                <Btn
                  variant="outline"
                  size="sm"
                  onClick={() => keysQ.data.admin?.material && copyText(keysQ.data.admin.material, "מפתח-האדמין")}
                  ariaLabel="העתק את מפתח-האדמין"
                  disabled={!keysQ.data.admin.material}
                >
                  <Copy className="size-3.5" aria-hidden /> העתק
                </Btn>
              </div>
            </div>
            <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5" dir="ltr">
              {keysQ.data.admin.material ? (
                revealed ? (
                  <Mono className="block select-all break-all text-[11px] leading-relaxed text-amber-200">{keysQ.data.admin.material}</Mono>
                ) : (
                  <Mono className="block text-[11px] tracking-widest text-zinc-400">{keysQ.data.admin.masked}</Mono>
                )
              ) : (
                <span className="text-[11px] text-zinc-500">אין חומר-מפתח — דרוש הקצאה מחדש (רוטציה)</span>
              )}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              מקור המפתח: {chain?.account ?? "—"} (verdict בלבד — חומר-המפתח לעולם לא מוצג). ניתן לרוטציה בכל רגע (אבטחה → ביטול כל ההפעלות).
            </p>
          </div>

          {/* ── 3. מפתחות-שרשרת — verdicts only, never material ── */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <Wallet className="size-3.5 text-emerald-300" aria-hidden /> מפתחות-שרשרת (STEEM · HIVE · BLURT)
              </span>
              {chain?.reachable ? (
                <Badge tone="ok" title={chain.sealedAt ? `מעטפת נאטמה ${chain.sealedAt}` : undefined}>
                  חותם חי · {chain.account ?? "headcorner"}
                </Badge>
              ) : (
                <Badge tone="warn">חותם לא נגיש{chain?.error ? `: ${chain.error}` : ""}</Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chain?.reachable && Object.keys(networks).length > 0 ? (
                Object.entries(networks).map(([net, slots]) => (
                  <span key={net} className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1">
                    <span className="font-mono text-[10px] font-bold text-zinc-300">{net}</span>
                    <KeySlotBadge label="owner" slot={slots.owner} />
                    <KeySlotBadge label="active" slot={slots.active} />
                    <KeySlotBadge label="posting" slot={slots.posting} />
                    <KeySlotBadge label="memo" slot={slots.memo} />
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-zinc-500">אין נתוני-חריצים — הפעל את החותם החיצוני (:3033)</span>
              )}
            </div>
            {chain?.reachable && Array.isArray(chain.fleet) && chain.fleet.some((f) => f.networks && Object.keys(f.networks).length > 0) ? (
              (() => {
                // כנות: הפסק-דין לפר-סלוט-צי נגזר מסיכום-הסטיות החי (כל סלוטי-הכספת נבדקים בכל-בדיקה).
                // unmatched>0 או errors>0 ⇒ לא נוכל לטעון התאמה פר-סלוט ⇒ מוצג "טעון (לא-אומת)".
                const sum = keysQ.data.connection?.vault.summary;
                const fleetVerified = sum ? (sum.unmatched ?? 1) === 0 && (sum.errors ?? 1) === 0 : false;
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {chain.fleet.filter((f) => f.networks && Object.keys(f.networks).length > 0).map((f) => (
                      <span key={f.username} className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1">
                        <span className="font-mono text-[10px] font-bold text-zinc-300">{f.username}</span>
                        {Object.entries(f.networks ?? {}).map(([net, roles]) => (
                          <span key={net} className="flex items-center gap-1">
                            <span className="font-mono text-[10px] text-zinc-500">{net}</span>
                            <KeySlotBadge label="owner" slot={{ loaded: roles.owner, match: roles.owner ? (fleetVerified ? true : null) : false }} />
                            <KeySlotBadge label="active" slot={{ loaded: roles.active, match: roles.active ? (fleetVerified ? true : null) : false }} />
                            <KeySlotBadge label="posting" slot={{ loaded: roles.posting, match: roles.posting ? (fleetVerified ? true : null) : false }} />
                            <KeySlotBadge label="memo" slot={{ loaded: roles.memo, match: roles.memo ? (fleetVerified ? true : null) : false }} />
                          </span>
                        ))}
                      </span>
                    ))}
                  </div>
                );
              })()
            ) : null}
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              חומר-מפתח פרטי (WIF) לעולם לא מוצג — רק פסקי-דין מול רשויות-החיה בשרשרת.
            </p>
          </div>

          {/* ── 4. ארנקים — public addresses, copy-ready ── */}
          {keysQ.data.wallets && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                  <Wallet className="size-3.5 text-sky-300" aria-hidden /> כתובות ארנק (ציבורי — יתרות חיות ב&quot;קופה חיה&quot;)
                </span>
              </div>
              <div className="scroll-slim mt-2 max-h-72 space-y-3 overflow-y-auto pl-1">
                <AddressGroup label="TRON — משפחת הצירוף" rows={keysQ.data.wallets.tron} />
                <AddressGroup label="ETH" rows={keysQ.data.wallets.eth} />
                <AddressGroup label="SOL" rows={keysQ.data.wallets.sol} />
                <AddressGroup label="יעדי-יציאה שאומתו על השרשרת" rows={keysQ.data.wallets.outflows} />
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">{keysQ.data.wallets.derivation}</p>
            </div>
          )}

          {/* ── 5. קבצי-מפתח — paths only (the key itself is above) ── */}
          {keysQ.data.files && keysQ.data.files.length > 0 && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                  <FileLock2 className="size-3.5 text-zinc-400" aria-hidden /> קבצי-מפתח (נתיבים בלבד — התוכן לעולם לא נחשף)
                </span>
              </div>
              <ul className="scroll-slim mt-2 max-h-56 space-y-1.5 overflow-y-auto pl-1">
                {keysQ.data.files.map((f) => (
                  <li key={f.path} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5">
                    <Badge tone={f.exists ? "ok" : "danger"}>{f.exists ? "קיים" : "חסר"}</Badge>
                    <span className="min-w-0 flex-1 truncate" dir="ltr"><Mono className="text-[10px] text-zinc-300" title={f.path}>{f.path}</Mono></span>
                    {f.exists && f.bytes > 0 && <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{f.bytes} B</span>}
                    <span className="w-full truncate text-[10px] text-zinc-500" title={f.note}>{f.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* ── 6. חומר-הבעלים — מה נשלח, מה חובר, מה הושמד ── */}
          {keysQ.data.material && keysQ.data.material.length > 0 && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                  <FileLock2 className="size-3.5 text-zinc-400" aria-hidden /> חומר-הבעלים — מה חובר ומה נאטם
                </span>
              </div>
              <ul className="scroll-slim mt-2 max-h-56 space-y-1.5 overflow-y-auto pl-1">
                {keysQ.data.material.map((m) => (
                  <li key={m.path} className="rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={m.exists ? "ok" : "neutral"}>{m.exists ? "נשמר" : "מושמד"}</Badge>
                      <span className="min-w-0 flex-1 truncate" dir="ltr"><Mono className="text-[10px] text-zinc-300">{m.path}</Mono></span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-zinc-500">{m.role} · {m.disposition}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function AddressGroup({ label, rows }: { label: string; rows: Array<{ label: string; address: string }> }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <AddrRow key={r.address} label={r.label} address={r.address} />
        ))}
      </div>
    </div>
  );
}
